begin;

create function public.get_admin_meal_forecasts(
  p_meal_date date
)
returns table (
  meal_slot_id uuid,
  meal_type text,
  expected_count bigint,
  historical_meals bigint,
  historical_expected bigint,
  historical_collected bigint,
  collection_rate numeric,
  predicted_collections bigint,
  forecast_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'ADMIN'
      and p.account_status = 'ACTIVE'
  ) then
    raise exception 'ACTIVE_ADMIN_REQUIRED';
  end if;

  if p_meal_date is null
     or p_meal_date < date '2000-01-01'
     or p_meal_date > date '2099-12-31' then
    raise exception 'INVALID_DATE';
  end if;

  return query
  with targets as (
    select
      m.id,
      m.meal_type,
      m.meal_date,
      m.serve_start,
      m.cutoff_at
    from public.meal_slots m
    where m.meal_date = p_meal_date
  ),

  -- Historical expected counts use the same definition
  -- as the existing analytics function.
  history_counts as (
    select
      h.id,
      h.meal_type,
      h.meal_date,
      h.serve_start,

      (
        select count(*)
        from public.meal_enrollments en
        join public.profiles p
          on p.id = en.student_id
         and p.role = 'STUDENT'
         and p.account_status = 'ACTIVE'
        where en.meal_slot_id = h.id
          and en.status = 'OPTED_IN'
      ) as expected,

      (
        select count(*)
        from public.meal_redemptions mr
        where mr.meal_slot_id = h.id
      ) as collected

    from public.meal_slots h

    -- Use meals with a completed kitchen report.
    -- Missing reports are excluded, not treated as zero.
    join public.meal_waste_reports w
      on w.meal_slot_id = h.id
     and w.prepared_portions > 0

    where h.meal_date >= p_meal_date - 90
      and h.meal_date < p_meal_date

      -- Leave time for delayed offline scans to sync.
      and h.serve_end <= v_now - interval '24 hours'

      and exists (
        select 1
        from targets t
        where t.meal_type = h.meal_type
      )
  ),

  usable_history as (
    select hc.*
    from history_counts hc
    where hc.expected > 0

      -- Do not silently clamp inconsistent historical ratios.
      and hc.collected <= hc.expected
  ),

  target_counts as (
    select
      t.*,

      (
        select count(*)
        from public.meal_enrollments en
        join public.profiles p
          on p.id = en.student_id
         and p.role = 'STUDENT'
         and p.account_status = 'ACTIVE'
        where en.meal_slot_id = t.id
          and en.status = 'OPTED_IN'
      ) as expected

    from targets t
  ),

  summaries as (
    select
      t.*,
      stats.sample_count,
      stats.total_expected,
      stats.total_collected

    from target_counts t

    cross join lateral (
      select
        count(*) as sample_count,
        coalesce(sum(recent.expected), 0)::bigint
          as total_expected,
        coalesce(sum(recent.collected), 0)::bigint
          as total_collected

      from (
        select
          u.expected,
          u.collected
        from usable_history u
        where u.meal_type = t.meal_type
        order by
          u.meal_date desc,
          u.serve_start desc,
          u.id
        limit 28
      ) recent
    ) stats
  ),

  estimates as (
    select
      s.*,

      case
        when s.sample_count >= 7
         and s.total_expected > 0
        then
          s.total_collected::numeric /
          s.total_expected::numeric
        else null
      end as rate

    from summaries s
  )

  select
    e.id,
    e.meal_type::text,
    e.expected,
    e.sample_count,
    e.total_expected,
    e.total_collected,
    e.rate,

    case
      when e.serve_start <= v_now then null::bigint
      when e.expected = 0 then null::bigint
      when e.rate is null then null::bigint
      else pg_catalog.round(
        e.expected::numeric * e.rate
      )::bigint
    end as predicted,

    case
      when e.serve_start <= v_now
        then 'SERVING_STARTED'
      when e.expected = 0
        then 'NO_EXPECTED_DINERS'
      when e.rate is null
        then 'INSUFFICIENT_HISTORY'
      when e.cutoff_at > v_now
        then 'PROVISIONAL'
      else 'READY'
    end::text

  from estimates e
  order by e.serve_start;
end;
$$;

revoke all
on function public.get_admin_meal_forecasts(date)
from public, anon, authenticated;

grant execute
on function public.get_admin_meal_forecasts(date)
to authenticated;

notify pgrst, 'reload schema';

commit;