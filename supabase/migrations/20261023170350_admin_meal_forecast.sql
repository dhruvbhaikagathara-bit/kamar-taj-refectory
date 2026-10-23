create function public.get_meal_forecast()
returns table (
  meal_slot_id uuid,
  meal_date date,
  meal_type text,
  menu text,
  cutoff_at timestamptz,
  serve_start timestamptz,
  serve_end timestamptz,
  price_paise integer,
  opted_in bigint,
  opted_out bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only active administrators can access the kitchen forecast.
  if not exists (
    select 1
    from public.profiles as p
    where p.id = auth.uid()
      and p.role = 'ADMIN'
      and p.account_status = 'ACTIVE'
  ) then
    raise exception 'ACTIVE_ADMIN_REQUIRED';
  end if;

  return query
  select
    m.id as meal_slot_id,
    m.meal_date,
    m.meal_type,
    m.menu,
    m.cutoff_at,
    m.serve_start,
    m.serve_end,
    m.price_paise,
    count(e.student_id) filter (
      where e.status = 'OPTED_IN'
    ) as opted_in,
    count(e.student_id) filter (
      where e.status = 'OPTED_OUT'
    ) as opted_out
  from public.meal_slots as m
  left join public.meal_enrollments as e
    on e.meal_slot_id = m.id
  where m.serve_end > pg_catalog.clock_timestamp()
  group by m.id
  order by m.serve_start, m.id
  limit 21;
end;
$$;

revoke execute
on function public.get_meal_forecast()
from public, anon, authenticated;

grant execute
on function public.get_meal_forecast()
to authenticated;