/**
 * Пакетное чтение: все выборки, начатые в одном такте (Promise.all экрана и соседние вызовы API), уходят в базу
 * одним запросом — функцией read_batch (schema.sql). Права те же: функция работает от имени пользователя, RLS в силе.
 * Записи (insert/update/upsert/delete) и rpc идут как раньше, напрямую.
 * Если функции в базе нет или пакет упал — каждая выборка повторяется отдельно, как без пакета.
 *
 * Интерфейс — подмножество supabase-js, ровно то, что использует backend.js:
 * select/eq/neq/lt/gt/gte/lte/in/is(null)/order/limit/range/maybeSingle.
 */
const WRITES = new Set(['insert', 'upsert', 'update', 'delete']);
const MAX = 60; // выборок в одном пакете

class BatchQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.calls = [];
  }
  record(name, args) { this.calls.push([name, args]); return this; }
  select(...a) { return this.record('select', a); }
  insert(...a) { return this.record('insert', a); }
  upsert(...a) { return this.record('upsert', a); }
  update(...a) { return this.record('update', a); }
  delete(...a) { return this.record('delete', a); }
  eq(...a) { return this.record('eq', a); }
  neq(...a) { return this.record('neq', a); }
  lt(...a) { return this.record('lt', a); }
  gt(...a) { return this.record('gt', a); }
  gte(...a) { return this.record('gte', a); }
  lte(...a) { return this.record('lte', a); }
  in(...a) { return this.record('in', a); }
  is(...a) { return this.record('is', a); }
  order(...a) { return this.record('order', a); }
  limit(...a) { return this.record('limit', a); }
  range(...a) { return this.record('range', a); }
  maybeSingle(...a) { return this.record('maybeSingle', a); }

  /** Тот же запрос — напрямую через исходный клиент. */
  direct() {
    let q = this.client.db.from(this.table);
    for (const [name, args] of this.calls) q = q[name](...args);
    return q;
  }

  /** Описание выборки для read_batch; null — не выборка или что-то, чего пакет не умеет. */
  spec() {
    const s = { t: this.table, c: '*', f: [], o: [], l: null, s: null, one: false };
    for (const [name, a] of this.calls) {
      if (WRITES.has(name)) return null;
      switch (name) {
        case 'select': if (a[1]) return null; s.c = a[0] || '*'; break;
        case 'eq': case 'neq': case 'lt': case 'gt': case 'gte': case 'lte': {
          const v = a[1];
          if (v === null || v === undefined || typeof v === 'object') return null;
          s.f.push([a[0], name, String(v)]);
          break;
        }
        case 'in': if (!Array.isArray(a[1]) || a[1].some(v => v === null || typeof v === 'object')) return null; s.f.push([a[0], 'in', a[1].map(String)]); break;
        case 'is': if (a[1] !== null) return null; s.f.push([a[0], 'is', null]); break;
        case 'order': s.o.push([a[0], !(a[1] && a[1].ascending === false)]); if (a[1] && Object.keys(a[1]).some(k => k !== 'ascending')) return null; break;
        case 'limit': s.l = Number(a[0]); break;
        case 'range': s.s = Number(a[0]); s.l = Number(a[1]) - Number(a[0]) + 1; break;
        case 'maybeSingle': s.one = true; break;
        default: return null;
      }
    }
    return s;
  }

  then(resolve, reject) {
    const spec = this.client.on ? this.spec() : null;
    const p = spec ? this.client.enqueue(spec, this) : Promise.resolve(this.direct());
    return p.then(resolve, reject);
  }
}

export function batchClient(db) {
  const client = {
    db,
    on: true,
    queue: [],
    timer: null,
    enqueue(spec, query) {
      return new Promise(resolve => {
        client.queue.push({ spec, query, resolve });
        if (client.queue.length >= MAX) client.flush();
        else if (!client.timer) client.timer = setTimeout(() => client.flush(), 0);
      });
    },
    async flush() {
      clearTimeout(client.timer);
      client.timer = null;
      const items = client.queue.splice(0);
      if (!items.length) return;
      // одна выборка — без пакета; иначе одинаковые выборки — один раз
      if (items.length === 1) { items[0].resolve(items[0].query.direct()); return; }
      const keys = [], uniq = new Map();
      for (const it of items) {
        const k = JSON.stringify(it.spec);
        if (!uniq.has(k)) uniq.set(k, uniq.size);
        keys.push(uniq.get(k));
      }
      const specs = [...uniq.keys()].map(k => JSON.parse(k));
      let res = null;
      try {
        const { data, error } = await db.rpc('read_batch', { p_queries: specs });
        if (!error && Array.isArray(data) && data.length === specs.length) res = data;
        // функции ещё нет в базе — больше не пробуем до перезагрузки
        else if (error && (error.code === 'PGRST202' || error.code === '42883' || /read_batch/.test(error.message || '') && /not find|does not exist/i.test(error.message || ''))) client.on = false;
      } catch { /* сеть — повторим поштучно */ }
      items.forEach((it, i) => {
        if (!res) { it.resolve(it.query.direct()); return; }
        const rows = Array.isArray(res[keys[i]]) ? res[keys[i]] : [];
        if (!it.spec.one) it.resolve({ data: rows, error: null });
        else it.resolve(rows.length > 1 ? { data: null, error: { message: 'multiple rows' } } : { data: rows[0] || null, error: null });
      });
    },
    from: table => new BatchQuery(client, table),
    rpc: (fn, args) => db.rpc(fn, args),
  };
  return client;
}
