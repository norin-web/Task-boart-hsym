-- Починка кодировки: русские данные, которые попали в базу «кракозябрами» (–ü—Ä–∏–æ—Ä–∏—Ç–µ—Ç вместо «Приоритет»).
-- Так бывает, когда схему копируют в SQL Editor через pbcopy без UTF-8 (текст читается как MacRoman).
-- Безопасно: меняются только строки, которые целиком разбираются обратно в корректный UTF-8; нормальный текст не трогается.
-- Можно запускать повторно. Запускать в Supabase → SQL Editor (вставлять из редактора, не через pbcopy).

create or replace function pg_temp.fix_mojibake(t text) returns text language plpgsql immutable as $f$
declare
  tbl constant text := 'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ';
  buf bytea := ''::bytea;
  ch text;
  p int;
begin
  if t is null or t !~ '[–—]' then return t; end if;
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
        execute format('update public.%I set %I = pg_temp.fix_mojibake(%I::text)::jsonb where %I::text ~ ''[–—]'' and pg_temp.fix_mojibake(%I::text) is distinct from %I::text', c.t, c.col, c.col, c.col, c.col, c.col);
      else
        execute format('update public.%I set %I = pg_temp.fix_mojibake(%I) where %I ~ ''[–—]'' and pg_temp.fix_mojibake(%I) is distinct from %I', c.t, c.col, c.col, c.col, c.col, c.col);
      end if;
      get diagnostics n = row_count;
      if n > 0 then total := total + n; raise notice 'исправлено: %.% — % строк', c.t, c.col, n; end if;
    exception when others then raise notice 'пропущено %.%: %', c.t, c.col, sqlerrm;
    end;
  end loop;
  raise notice 'всего исправлено строк: %', total;
end $$;
