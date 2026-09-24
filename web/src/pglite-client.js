/**
 * Минимальный клиент с интерфейсом supabase-js поверх PGlite (Postgres в WebAssembly) — для тестов.
 * Поддерживает ровно то, что использует web/src/backend.js:
 * from().select/insert/update/upsert/delete + eq/neq/lt/in/order/limit/range/maybeSingle, rpc().
 */
const ident = c => '"' + String(c).replace(/"/g, '""') + '"';
const cols = list => (list === '*' ? '*' : list.split(',').map(s => ident(s.trim())).join(', '));
const value = v => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

class Query {
  constructor(pg, table) {
    this.pg = pg;
    this.table = table;
    this.op = 'select';
    this.columns = '*';
    this.returning = null;
    this.filters = [];
    this.orders = [];
    this.lim = null;
    this.off = null;
    this.single = false;
  }

  select(list = '*') {
    if (this.op === 'select') this.columns = list; else this.returning = list;
    return this;
  }
  insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(row, { onConflict }) { this.op = 'upsert'; this.rows = [row]; this.conflict = onConflict; return this; }
  update(obj) { this.op = 'update'; this.obj = obj; return this; }
  delete() { this.op = 'delete'; return this; }

  eq(c, v) { this.filters.push([c, '=', v]); return this; }
  neq(c, v) { this.filters.push([c, '<>', v]); return this; }
  lt(c, v) { this.filters.push([c, '<', v]); return this; }
  in(c, list) { this.filters.push([c, 'in', list]); return this; }
  order(c, { ascending = true } = {}) { this.orders.push(`${ident(c)} ${ascending ? 'asc' : 'desc'}`); return this; }
  limit(n) { this.lim = n; return this; }
  range(a, b) { this.off = a; this.lim = b - a + 1; return this; }
  maybeSingle() { this.single = true; return this; }

  build() {
    const params = [];
    const p = v => { params.push(value(v)); return '$' + params.length; };
    const where = () => {
      if (!this.filters.length) return '';
      return ' where ' + this.filters.map(([c, op, v]) => {
        if (op === 'in') return v.length ? `${ident(c)} in (${v.map(p).join(', ')})` : 'false';
        return `${ident(c)} ${op} ${p(v)}`;
      }).join(' and ');
    };
    const ret = this.returning ? ' returning ' + cols(this.returning) : '';
    const t = ident(this.table);
    switch (this.op) {
      case 'select': {
        let sql = `select ${cols(this.columns)} from ${t}` + where();
        if (this.orders.length) sql += ' order by ' + this.orders.join(', ');
        if (this.lim != null) sql += ' limit ' + Number(this.lim);
        if (this.off != null) sql += ' offset ' + Number(this.off);
        return [sql, params];
      }
      case 'insert':
      case 'upsert': {
        const keys = Object.keys(this.rows[0]);
        const values = this.rows.map(r => '(' + keys.map(k => p(r[k])).join(', ') + ')').join(', ');
        let sql = `insert into ${t} (${keys.map(ident).join(', ')}) values ${values}`;
        if (this.op === 'upsert') {
          const conflict = this.conflict.split(',').map(s => s.trim());
          const rest = keys.filter(k => !conflict.includes(k));
          sql += ` on conflict (${conflict.map(ident).join(', ')}) do update set ` + rest.map(k => `${ident(k)} = excluded.${ident(k)}`).join(', ');
        }
        return [sql + ret, params];
      }
      case 'update': {
        const set = Object.entries(this.obj).map(([k, v]) => `${ident(k)} = ${p(v)}`).join(', ');
        return [`update ${t} set ${set}` + where() + ret, params];
      }
      case 'delete':
        return [`delete from ${t}` + where() + ret, params];
    }
  }

  async exec() {
    try {
      const [sql, params] = this.build();
      const r = await this.pg.query(sql, params);
      if (this.single) {
        if (r.rows.length > 1) return { data: null, error: { message: 'multiple rows' } };
        return { data: r.rows[0] || null, error: null };
      }
      const returns = this.op === 'select' || this.returning;
      return { data: returns ? r.rows : null, error: null };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  }

  then(resolve, reject) { return this.exec().then(resolve, reject); }
}

export function pgliteClient(pg) {
  return {
    from: table => new Query(pg, table),
    async rpc(fn, args = {}) {
      const keys = Object.keys(args);
      try {
        const r = await pg.query(`select * from ${ident(fn)}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, keys.map(k => args[k]));
        const names = r.fields.map(f => f.name);
        // скалярная функция → значение, как в supabase-js
        if (names.length === 1 && names[0] === fn) return { data: r.rows[0] ? r.rows[0][fn] : null, error: null };
        if (names.length === 1 && r.rows.every(x => x[names[0]] === '')) return { data: null, error: null }; // void
        return { data: r.rows, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
  };
}
