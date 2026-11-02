// Supabase Edge Function «admin-users»: аккаунты для входа. Вызывают только модераторы и супер-админы.
//   create   — аккаунт (email + временный пароль) и привязанный профиль
//   password — новый временный пароль
//   active   — заблокировать / разблокировать вход
//   deleteAuth — удалить аккаунт входа уже удалённого из people человека (только супер-админ)
// Секретный ключ (SUPABASE_SERVICE_ROLE_KEY) Supabase передаёт функции сам — в коде и в браузере его нет.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const ACCESS = ['superadmin', 'moderator', 'rm', 'lead', 'member']; // CEO, PM, RM, Lead, сотрудник
const nowIso = () => new Date().toISOString();
const newId = () => 'p_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Кто вызывает: проверяем токен и роль в таблице people
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'Нужно войти заново' }, 401);
    const { data: caller } = await admin.from('people').select('id, access').eq('user_id', auth.user.id).eq('active', true).maybeSingle();
    if (!caller || caller.access !== 'superadmin') return json({ error: 'Недостаточно прав: входы и пароли настраивает только CEO' }, 403);
    const isSuper = caller.access === 'superadmin';

    const body = await req.json();
    // deno-lint-ignore no-explicit-any
    const findPerson = async (id: string): Promise<any> => {
      const { data } = await admin.from('people').select('*').eq('id', id).maybeSingle();
      return data;
    };
    // deno-lint-ignore no-explicit-any
    const guardTarget = (person: any) => {
      if (!person) return json({ error: 'Человек не найден' }, 404);
      if (person.access === 'superadmin' && !isSuper) return json({ error: 'Супер-админа меняет только супер-админ' }, 403);
      return null;
    };

    if (body.action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const access = ACCESS.includes(body.access) ? body.access : 'member';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Некорректный email' }, 400);
      if (password.length < 8) return json({ error: 'Временный пароль — от 8 символов' }, 400);
      if (access !== 'member' && !isSuper) return json({ error: 'Роли назначает только супер-админ' }, 403);

      // Профиль: указанный, либо свободный с тем же email, либо новый. Права на него проверяем
      // до любых изменений аккаунта — иначе модератор успел бы сменить пароль чужому аккаунту.
      let personId: string | null = body.personId || null;
      if (!personId) {
        const { data: free } = await admin.from('people').select('id').is('user_id', null).ilike('email', email).limit(1);
        personId = free && free.length ? free[0].id : null;
      }
      if (personId) {
        const denied = guardTarget(await findPerson(personId));
        if (denied) return denied;
      }

      // Аккаунт: новый или уже существующий (например, созданный раньше в панели Supabase)
      let userId: string;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) {
        if (!/already|registered|exists/i.test(created.error.message)) return json({ error: created.error.message }, 400);
        const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
        const existing = list?.users.find(u => (u.email || '').toLowerCase() === email);
        if (!existing) return json({ error: 'Аккаунт с этим email уже есть, но найти его не удалось' }, 400);
        const { data: linked } = await admin.from('people').select('id').eq('user_id', existing.id).maybeSingle();
        if (linked && linked.id !== personId) return json({ error: 'Этот email уже привязан к другому человеку' }, 400);
        await admin.auth.admin.updateUserById(existing.id, { password, ban_duration: 'none' });
        userId = existing.id;
      } else {
        userId = created.data.user.id;
      }

      const fields: Record<string, unknown> = { email, user_id: userId, active: true };
      if (personId) {
        if (body.name) fields.name = String(body.name).slice(0, 80);
        const { error } = await admin.from('people').update(fields).eq('id', personId);
        if (error) return json({ error: error.message }, 400);
      } else {
        personId = newId();
        const { error } = await admin.from('people').insert({
          id: personId, name: String(body.name || email.split('@')[0]).slice(0, 80), role: String(body.role || '').slice(0, 80),
          access, position_id: String(body.positionId || '') || 'd_other',
          extra_positions: Array.isArray(body.extraPositionIds) ? body.extraPositionIds.map(String).slice(0, 10) : [],
          team_ids: Array.isArray(body.teamIds) && body.teamIds.length ? body.teamIds.map(String).slice(0, 10) : ['t_other'],
          created_at: nowIso(), ...fields,
        });
        if (error) return json({ error: error.message }, 400);
      }
      return json({ person: await findPerson(personId) });
    }

    if (body.action === 'password' || body.action === 'active') {
      const target = await findPerson(String(body.personId || ''));
      const denied = guardTarget(target);
      if (denied) return denied;
      if (!target.user_id) return json({ error: 'У человека нет аккаунта для входа' }, 400);
      if (body.action === 'password') {
        const password = String(body.password || '');
        if (password.length < 8) return json({ error: 'Временный пароль — от 8 символов' }, 400);
        const { error } = await admin.auth.admin.updateUserById(target.user_id, { password });
        if (error) return json({ error: error.message }, 400);
      } else {
        const { error } = await admin.auth.admin.updateUserById(target.user_id, { ban_duration: body.active ? 'none' : '876000h' });
        if (error) return json({ error: error.message }, 400);
      }
      return json({ ok: true });
    }

    if (body.action === 'deleteAuth') {
      if (!isSuper) return json({ error: 'Удалять людей может только супер-админ' }, 403);
      const userId = String(body.userId || '');
      if (!userId || userId === auth.user.id) return json({ error: 'Нельзя удалить этот аккаунт' }, 400);
      // Удаляем только «осиротевший» аккаунт: профиль уже удалён в базе (там проверены права и последний супер-админ)
      const { data: still } = await admin.from('people').select('id').eq('user_id', userId).maybeSingle();
      if (still) return json({ error: 'Аккаунт ещё привязан к человеку' }, 400);
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Неизвестное действие' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
