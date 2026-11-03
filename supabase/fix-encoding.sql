-- Fix-encoding: repairs Russian text stored as mojibake (e.g. the status "V razrabotke" shown as garbage).
-- This file is pure ASCII on purpose: it survives any copy/paste (pbcopy, browsers) without being corrupted itself.
-- Safe to run repeatedly: only strings that decode back into valid UTF-8 are changed; normal text is untouched.
-- Run in Supabase -> SQL Editor.

create or replace function pg_temp.fix_mojibake(t text) returns text language plpgsql immutable as $f$
declare
  cps constant int[] := array[196,197,199,201,209,214,220,225,224,226,228,227,229,231,233,232,234,235,237,236,238,239,241,243,242,244,246,245,250,249,251,252,8224,176,162,163,167,8226,182,223,174,169,8482,180,168,8800,198,216,8734,177,8804,8805,165,181,8706,8721,8719,960,8747,170,186,937,230,248,191,161,172,8730,402,8776,8710,171,187,8230,160,192,195,213,338,339,8211,8212,8220,8221,8216,8217,247,9674,255,376,8260,8364,8249,8250,64257,64258,8225,183,8218,8222,8240,194,202,193,203,200,205,206,207,204,211,212,63743,210,218,219,217,305,710,732,175,728,729,730,184,733,731,711];
  tbl text;
  buf bytea := ''::bytea;
  ch text;
  p int;
begin
  if t is null or t !~ '[\u2013\u2014]' then return t; end if;
  select string_agg(chr(c), '' order by o) into tbl from unnest(cps) with ordinality as x(c, o);
  for i in 1..char_length(t) loop
    ch := substr(t, i, 1);
    p := position(ch in tbl);
    if p > 0 then buf := buf || set_byte('\x00'::bytea, 0, 127 + p);
    elsif ascii(ch) < 128 then buf := buf || set_byte('\x00'::bytea, 0, ascii(ch));
    else return t;
    end if;
  end loop;
  return convert_from(buf, 'UTF8');
exception when others then return t;
end $f$;

do $$
declare c record; n bigint; total bigint := 0;
begin
  for c in
    select table_name t, column_name col, data_type dt from information_schema.columns
     where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb')
       and table_name not in ('tasks', 'comments', 'activity', 'notifications')
       and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
  loop
    begin
      if c.dt = 'jsonb' then
        execute format('update public.%I set %I = pg_temp.fix_mojibake(%I::text)::jsonb where %I::text ~ ''[\u2013\u2014]'' and pg_temp.fix_mojibake(%I::text) is distinct from %I::text', c.t, c.col, c.col, c.col, c.col, c.col);
      else
        execute format('update public.%I set %I = pg_temp.fix_mojibake(%I) where %I ~ ''[\u2013\u2014]'' and pg_temp.fix_mojibake(%I) is distinct from %I', c.t, c.col, c.col, c.col, c.col, c.col);
      end if;
      get diagnostics n = row_count;
      if n > 0 then total := total + n; raise notice 'fixed: %.% - % rows', c.t, c.col, n; end if;
    exception when others then raise notice 'skipped %.%: %', c.t, c.col, sqlerrm;
    end;
  end loop;
  raise notice 'total rows fixed: %', total;
end $$;
