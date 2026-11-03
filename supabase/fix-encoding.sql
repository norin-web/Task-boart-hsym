-- Fix-encoding v5: repairs Russian text stored as mojibake. Pure ASCII, safe to copy/paste and to run repeatedly.
-- Run in Supabase -> SQL Editor. The LAST statement returns a table of what was fixed (or errors) - send it if anything is still broken.

drop table if exists public._fix_log;
create table public._fix_log (tbl text, col text, rows_fixed bigint, err text);

create or replace function public._fix_mojibake(t text) returns text language plpgsql as $f$
declare
  cps constant int[] := array[196,197,199,201,209,214,220,225,224,226,228,227,229,231,233,232,234,235,237,236,238,239,241,243,242,244,246,245,250,249,251,252,8224,176,162,163,167,8226,182,223,174,169,8482,180,168,8800,198,216,8734,177,8804,8805,165,181,8706,8721,8719,960,8747,170,186,937,230,248,191,161,172,8730,402,8776,8710,171,187,8230,160,192,195,213,338,339,8211,8212,8220,8221,8216,8217,247,9674,255,376,8260,8364,8249,8250,64257,64258,8225,183,8218,8222,8240,194,202,193,203,200,205,206,207,204,211,212,63743,210,218,219,217,305,710,732,175,728,729,730,184,733,731,711];
  tbl text;
  hx text;
begin
  if t is null or t !~ '[\u2013\u2014]' then return t; end if;
  select string_agg(chr(c), '' order by o) into tbl from unnest(cps) with ordinality as x(c, o);
  select string_agg(lpad(to_hex(case when ascii(substr(t, i, 1)) < 128 then ascii(substr(t, i, 1)) else 127 + position(substr(t, i, 1) in tbl) end), 2, '0'), '' order by i)
    into hx from generate_series(1, char_length(t)) i;
  -- if some non-ASCII char is not in the table, position() gives 0 and the byte becomes 7f: leave such strings alone
  if exists (select 1 from generate_series(1, char_length(t)) i where ascii(substr(t, i, 1)) >= 128 and position(substr(t, i, 1) in tbl) = 0) then return t; end if;
  return convert_from(decode(hx, 'hex'), 'UTF8');
exception when others then
  insert into public._fix_log values ('function', left(t, 40), 0, sqlerrm);
  return t;
end $f$;

-- direct fix of settings (statuses, fields, ...) without any dynamic SQL
update public.app_settings set value = public._fix_mojibake(value::text)::jsonb
  where public._fix_mojibake(value::text) is distinct from value::text;
insert into public._fix_log select 'app_settings', 'value (direct)', 0, null;

do $$
declare c record; n bigint;
begin
  for c in
    select table_name t, column_name col, data_type dt from information_schema.columns
     where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json')
       and table_name not in ('tasks', 'comments', 'activity', 'notifications', '_fix_log', 'app_settings')
       and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
  loop
    begin
      if c.dt in ('jsonb', 'json') then
        execute format('update public.%I set %I = public._fix_mojibake(%I::text)::%s where public._fix_mojibake(%I::text) is distinct from %I::text', c.t, c.col, c.col, c.dt, c.col, c.col);
      else
        execute format('update public.%I set %I = public._fix_mojibake(%I) where public._fix_mojibake(%I) is distinct from %I', c.t, c.col, c.col, c.col, c.col);
      end if;
      get diagnostics n = row_count;
      if n > 0 then insert into public._fix_log values (c.t, c.col, n, null); end if;
    exception when others then
      insert into public._fix_log values (c.t, c.col, 0, sqlerrm);
    end;
  end loop;
end $$;

drop function public._fix_mojibake(text);

select * from public._fix_log
union all
select 'appStatuses now:', left(value::text, 300), 0, null from public.app_settings where key = 'appStatuses';
