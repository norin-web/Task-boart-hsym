-- Full cleanup of demo/test data (pure ASCII, safe to paste). Run in Supabase -> SQL Editor.
-- Deletes: all test tasks and apps (is_test), the "Demo" unit (key DEMO) with its tasks/fields/members,
-- and the demo people (names that start with the Russian word for "Demo", a space, a middle dot and a space).
-- Real data is not touched. The last query shows what is left (all zeros = clean).

do $$
declare demo_prefix text := chr(1044) || chr(1077) || chr(1084) || chr(1086) || ' ' || chr(183) || ' %';
begin
  delete from activity where task_id in (select id from tasks where is_test);
  delete from tasks where is_test;
  delete from apps where is_test;
  delete from activity where unit_id in (select id from units where key = 'DEMO');
  delete from units where key = 'DEMO';
  delete from people where name like demo_prefix;
end $$;

select
  (select count(*) from tasks where is_test) as test_tasks,
  (select count(*) from apps where is_test) as test_apps,
  (select count(*) from units where key = 'DEMO') as demo_units,
  (select count(*) from people where name like (chr(1044) || chr(1077) || chr(1084) || chr(1086) || ' ' || chr(183) || ' %')) as demo_people;
