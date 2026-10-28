begin;

create schema meal_planner_private;

revoke all on schema meal_planner_private
from public, anon, authenticated;

alter default privileges in schema meal_planner_private
revoke execute on functions from public;

-- Saved plans.
create table public.meal_plans (
  id uuid primary key default gen_random_uuid(),
  sequence_no bigint generated always as identity unique,
  student_id uuid not null references public.profiles(id),
  start_date date not null,
  end_date date not null,
  desired_status text not null
    check (desired_status in ('OPTED_IN', 'OPTED_OUT')),
  meal_types text[] not null,
  created_at timestamptz not null default clock_timestamp(),
  stopped_at timestamptz,
  initial_result jsonb not null default '{}'::jsonb,

  check (
    end_date >= start_date
    and end_date - start_date < 90
  ),

  check (cardinality(meal_types) between 1 and 3),

  check (
    meal_types <@
    array['BREAKFAST', 'LUNCH', 'DINNER']::text[]
  )
);

create index meal_plans_student_history
on public.meal_plans(student_id, sequence_no desc);

-- Effective choice for each student, date, and meal type.
create table public.meal_plan_days (
  student_id uuid not null references public.profiles(id),
  meal_date date not null,
  meal_type text not null
    check (meal_type in ('BREAKFAST', 'LUNCH', 'DINNER')),
  plan_id uuid not null references public.meal_plans(id),

  primary key (student_id, meal_date, meal_type)
);

create index meal_plan_days_publication
on public.meal_plan_days(meal_date, meal_type);

create index meal_plan_days_plan
on public.meal_plan_days(plan_id);

-- Track changes applied by each plan.
create table public.meal_plan_applications (
  plan_id uuid not null references public.meal_plans(id),
  student_id uuid not null references public.profiles(id),
  meal_slot_id uuid not null
    references public.meal_slots(id) on delete cascade,
  origin text not null
    check (origin in ('EXISTING', 'FUTURE')),
  outcome text not null
    check (outcome in ('UPDATED', 'UNCHANGED', 'LOCKED')),
  applied_at timestamptz not null default clock_timestamp(),

  primary key (plan_id, meal_slot_id)
);

alter table public.meal_plans
enable row level security;

alter table public.meal_plan_days
enable row level security;

alter table public.meal_plan_applications
enable row level security;

revoke all
on public.meal_plans,
   public.meal_plan_days,
   public.meal_plan_applications
from public, anon, authenticated;

grant select
on public.meal_plans,
   public.meal_plan_days,
   public.meal_plan_applications
to authenticated;

create policy own_plans
on public.meal_plans
for select to authenticated
using (student_id = (select auth.uid()));

create policy own_plan_days
on public.meal_plan_days
for select to authenticated
using (student_id = (select auth.uid()));

create policy own_plan_applications
on public.meal_plan_applications
for select to authenticated
using (student_id = (select auth.uid()));

-- Private authorization context for automatic billing.
create table meal_planner_private.choice_context (
  transaction_id bigint not null,
  student_id uuid not null,
  meal_slot_id uuid not null,
  desired_status text not null,
  plan_id uuid not null references public.meal_plans(id),

  primary key (
    transaction_id,
    student_id,
    meal_slot_id
  )
);

revoke all
on meal_planner_private.choice_context
from public, anon, authenticated;

-- Added protection: RLS enabled with no client policies.
-- Internal SECURITY DEFINER functions use owner access.
alter table meal_planner_private.choice_context
enable row level security;

create function meal_planner_private.assert_billing_actor(
  p_student uuid,
  p_meal uuid,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where id = p_student
      and role = 'STUDENT'
      and account_status = 'ACTIVE'
  ) then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  if auth.uid() = p_student then
    return p_student;
  end if;

  if exists (
    select 1
    from meal_planner_private.choice_context c
    join public.meal_plans p
      on p.id = c.plan_id
      and p.student_id = c.student_id
    where c.transaction_id = pg_catalog.txid_current()
      and c.student_id = p_student
      and c.meal_slot_id = p_meal
      and c.desired_status = p_status
      and p.desired_status = p_status
  ) then
    return coalesce(auth.uid(), p_student);
  end if;

  raise exception 'AUTH_REQUIRED';
end;
$$;

create function meal_planner_private.validate_plan(
  p_start date,
  p_end date,
  p_status text,
  p_types text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_today date :=
    (clock_timestamp() at time zone 'Asia/Kolkata')::date;
begin
  if v_student is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform 1
  from public.profiles
  where id = v_student
    and role = 'STUDENT'
    and account_status = 'ACTIVE';

  if not found then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  if p_start is null
     or p_end is null
     or p_start < v_today
     or p_end < p_start
     or p_end - p_start >= 90
     or p_end > v_today + 365 then
    raise exception 'INVALID_PLAN_DATES';
  end if;

  if p_status is null
     or p_status not in ('OPTED_IN', 'OPTED_OUT') then
    raise exception 'INVALID_MEAL_STATUS';
  end if;

  if p_types is null
     or cardinality(p_types) not between 1 and 3
     or array_position(p_types, null) is not null
     or not (
       p_types <@
       array['BREAKFAST', 'LUNCH', 'DINNER']::text[]
     )
     or cardinality(p_types) <> (
       select count(distinct x)
       from unnest(p_types) x
     ) then
    raise exception 'INVALID_MEAL_TYPES';
  end if;

  return v_student;
end;
$$;

-- Shared mutation function.
create function meal_planner_private.apply_choice(
  p_student uuid,
  p_meal uuid,
  p_status text,
  p_plan uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meal public.meal_slots%rowtype;
  v_previous text;
  v_actor uuid;
begin
  if p_status is null
     or p_status not in ('OPTED_IN', 'OPTED_OUT') then
    raise exception 'INVALID_MEAL_STATUS';
  end if;

  perform 1
  from public.profiles
  where id = p_student
    and role = 'STUDENT'
    and account_status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  select *
  into v_meal
  from public.meal_slots
  where id = p_meal
  for share;

  if not found then
    raise exception 'MEAL_NOT_FOUND';
  end if;

  if p_plan is null then
    if auth.uid() is null or auth.uid() <> p_student then
      raise exception 'AUTH_REQUIRED';
    end if;
  else
    perform 1
    from public.meal_plans p
    join public.meal_plan_days d on d.plan_id = p.id
    where p.id = p_plan
      and p.student_id = p_student
      and p.desired_status = p_status
      and p.stopped_at is null
      and d.student_id = p_student
      and d.meal_date = v_meal.meal_date
      and d.meal_type = v_meal.meal_type::text;

    if not found then
      raise exception 'PLAN_AUTHORIZATION_FAILED';
    end if;
  end if;

  select status
  into v_previous
  from public.meal_enrollments
  where student_id = p_student
    and meal_slot_id = p_meal
  for update;

  if clock_timestamp() >= v_meal.cutoff_at then
    raise exception 'MEAL_CUTOFF_PASSED';
  end if;

  if exists (
    select 1
    from public.meal_redemptions
    where student_id = p_student
      and meal_slot_id = p_meal
  ) then
    raise exception 'MEAL_ALREADY_REDEEMED';
  end if;

  if v_previous = p_status then
    return 'UNCHANGED';
  end if;

  if p_plan is not null then
    insert into meal_planner_private.choice_context
    values (
      pg_catalog.txid_current(),
      p_student,
      p_meal,
      p_status,
      p_plan
    );
  end if;

  insert into public.meal_enrollments (
    student_id,
    meal_slot_id,
    status,
    updated_at
  )
  values (
    p_student,
    p_meal,
    p_status,
    clock_timestamp()
  )
  on conflict (student_id, meal_slot_id)
  do update set
    status = excluded.status,
    updated_at = excluded.updated_at;

  v_actor := coalesce(auth.uid(), p_student);

  insert into public.audit_logs (
    actor_id,
    student_id,
    meal_slot_id,
    action,
    details
  )
  values (
    v_actor,
    p_student,
    p_meal,
    case
      when p_status = 'OPTED_IN' then 'MEAL_OPTED_IN'
      else 'MEAL_OPTED_OUT'
    end,
    jsonb_build_object(
      'previous_status', v_previous,
      'new_status', p_status,
      'source',
        case
          when p_plan is null then 'MANUAL'
          else 'MEAL_PLANNER'
        end,
      'plan_id', p_plan
    )
  );

  if p_plan is not null then
    delete from meal_planner_private.choice_context
    where transaction_id = pg_catalog.txid_current()
      and student_id = p_student
      and meal_slot_id = p_meal;
  end if;

  return 'UPDATED';
end;
$$;

-- Existing manual-choice RPC keeps the same signature.
create or replace function public.set_my_meal_choice(
  p_meal_slot_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform meal_planner_private.apply_choice(
    auth.uid(),
    p_meal_slot_id,
    p_status,
    null
  );

  return p_status;
end;
$$;

-- Preserve rebate calculations.
create or replace function public.post_meal_choice_rebate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_price_paise integer;
  v_cutoff_at timestamptz;
  v_meal_date date;
  v_net_credit bigint;
  v_delta_paise integer;
  v_kind text;
  v_action text;
  v_event_id uuid;
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  v_actor_id :=
    meal_planner_private.assert_billing_actor(
      new.student_id,
      new.meal_slot_id,
      new.status
    );

  select price_paise, cutoff_at, meal_date
  into v_price_paise, v_cutoff_at, v_meal_date
  from public.meal_slots
  where id = new.meal_slot_id
  for share;

  if not found then
    raise exception 'MEAL_NOT_FOUND';
  end if;

  if clock_timestamp() >= v_cutoff_at then
    raise exception 'CUTOFF_PASSED';
  end if;

  if exists (
    select 1
    from public.meal_redemptions
    where student_id = new.student_id
      and meal_slot_id = new.meal_slot_id
  ) then
    raise exception 'ALREADY_REDEEMED';
  end if;

  select coalesce(sum(delta_paise), 0)
  into v_net_credit
  from public.rebate_ledger
  where student_id = new.student_id
    and meal_slot_id = new.meal_slot_id;

  if v_net_credit < 0
     or v_net_credit > 2147483647 then
    raise exception 'REBATE_BALANCE_INVALID';
  end if;

  if old.status = 'OPTED_IN'
     and new.status = 'OPTED_OUT' then

    if v_net_credit <> 0 then
      raise exception 'REBATE_BALANCE_INVALID';
    end if;

    if v_price_paise = 0 then
      return new;
    end if;

    v_delta_paise := v_price_paise;
    v_kind := 'CREDIT';
    v_action := 'REBATE_CREDIT_POSTED';

  elsif old.status = 'OPTED_OUT'
        and new.status = 'OPTED_IN' then

    if v_net_credit = 0 then
      return new;
    end if;

    v_delta_paise := -(v_net_credit::integer);
    v_kind := 'REVERSAL';
    v_action := 'REBATE_REVERSAL_POSTED';

  else
    raise exception 'INVALID_ENROLLMENT_TRANSITION';
  end if;

  insert into public.audit_logs (
    actor_id,
    student_id,
    meal_slot_id,
    action,
    details
  )
  values (
    v_actor_id,
    new.student_id,
    new.meal_slot_id,
    v_action,
    jsonb_build_object(
      'policy', 'FULL_MEAL_PRICE_V1',
      'previous_status', old.status,
      'new_status', new.status,
      'delta_paise', v_delta_paise,
      'meal_date', v_meal_date
    )
  )
  returning id into v_event_id;

  insert into public.rebate_ledger (
    student_id,
    meal_slot_id,
    source_event_id,
    kind,
    delta_paise
  )
  values (
    new.student_id,
    new.meal_slot_id,
    v_event_id,
    v_kind,
    v_delta_paise
  );

  return new;
end;
$$;

-- Preserve one base charge per student per meal.
create or replace function public.record_first_meal_charge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price integer;
  v_meal_date date;
  v_charge_id uuid;
begin
  if new.status <> 'OPTED_IN' then
    return new;
  end if;

  perform meal_planner_private.assert_billing_actor(
    new.student_id,
    new.meal_slot_id,
    new.status
  );

  select m.price_paise, m.meal_date
  into v_price, v_meal_date
  from public.meal_slots m
  where m.id = new.meal_slot_id
  for share;

  if not found then
    raise exception 'MEAL_NOT_FOUND';
  end if;

  insert into public.meal_charges (
    student_id,
    meal_slot_id,
    amount_paise,
    meal_date,
    origin
  )
  values (
    new.student_id,
    new.meal_slot_id,
    v_price,
    v_meal_date,
    'FIRST_OPT_IN'
  )
  on conflict (student_id, meal_slot_id) do nothing
  returning id into v_charge_id;

  if v_charge_id is not null then
    insert into public.audit_logs (
      actor_id,
      student_id,
      meal_slot_id,
      action,
      details
    )
    values (
      coalesce(auth.uid(), new.student_id),
      new.student_id,
      new.meal_slot_id,
      'MEAL_BASE_CHARGE_POSTED',
      jsonb_build_object(
        'charge_id', v_charge_id,
        'amount_paise', v_price,
        'meal_date', v_meal_date,
        'policy', 'FIRST_OPT_IN_FULL_PRICE_V1'
      )
    );
  end if;

  return new;
end;
$$;

-- Preview without saving changes.
create function public.preview_my_meal_plan(
  p_start_date date,
  p_end_date date,
  p_status text,
  p_meal_types text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_counts jsonb;
  v_slots integer;
  v_overlap integer;
begin
  v_student := meal_planner_private.validate_plan(
    p_start_date,
    p_end_date,
    p_status,
    p_meal_types
  );

  v_slots :=
    (p_end_date - p_start_date + 1) *
    cardinality(p_meal_types);

  select count(*)
  into v_overlap
  from public.meal_plan_days
  where student_id = v_student
    and meal_date between p_start_date and p_end_date
    and meal_type = any(p_meal_types);

  with choices as (
    select
      m.id,
      m.price_paise,
      e.status,
      (
        clock_timestamp() >= m.cutoff_at
        or exists (
          select 1
          from public.meal_redemptions r
          where r.student_id = v_student
            and r.meal_slot_id = m.id
        )
      ) as locked,
      exists (
        select 1
        from public.meal_charges c
        where c.student_id = v_student
          and c.meal_slot_id = m.id
      ) as charged,
      coalesce(
        (
          select sum(l.delta_paise)
          from public.rebate_ledger l
          where l.student_id = v_student
            and l.meal_slot_id = m.id
        ),
        0
      ) as credit
    from public.meal_slots m
    left join public.meal_enrollments e
      on e.meal_slot_id = m.id
      and e.student_id = v_student
    where m.meal_date between p_start_date and p_end_date
      and m.meal_type::text = any(p_meal_types)
  )
  select jsonb_build_object(
    'published', count(*),

    'locked',
      count(*) filter (where locked),

    'unchanged',
      count(*) filter (
        where not locked and status = p_status
      ),

    'updates',
      count(*) filter (
        where not locked
          and status is distinct from p_status
      ),

    'unpublished', v_slots - count(*),
    'overlap_slots', v_overlap,

    'new_charges_paise',
      coalesce(sum(
        case
          when not locked
            and p_status = 'OPTED_IN'
            and status is distinct from p_status
            and not charged
          then price_paise
          else 0
        end
      ), 0),

    'credits_paise',
      coalesce(sum(
        case
          when not locked
            and p_status = 'OPTED_OUT'
            and status = 'OPTED_IN'
          then price_paise
          else 0
        end
      ), 0),

    'reversals_paise',
      coalesce(sum(
        case
          when not locked
            and p_status = 'OPTED_IN'
            and status = 'OPTED_OUT'
          then credit
          else 0
        end
      ), 0)
  )
  into v_counts
  from choices;

  return v_counts;
end;
$$;

-- Save a plan and update eligible existing meals.
create function public.save_my_meal_plan(
  p_start_date date,
  p_end_date date,
  p_status text,
  p_meal_types text[],
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid;
  v_plan public.meal_plans%rowtype;
  v_meal record;
  v_outcome text;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_locked integer := 0;
  v_total integer := 0;
  v_result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(729104, 1);

  v_student := meal_planner_private.validate_plan(
    p_start_date,
    p_end_date,
    p_status,
    p_meal_types
  );

  if p_request_id is null then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;

  perform 1
  from public.profiles
  where id = v_student
    and role = 'STUDENT'
    and account_status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  select *
  into v_plan
  from public.meal_plans
  where id = p_request_id;

  if found then
    if v_plan.student_id <> v_student
       or v_plan.start_date <> p_start_date
       or v_plan.end_date <> p_end_date
       or v_plan.desired_status <> p_status
       or v_plan.meal_types <> p_meal_types then
      raise exception 'REQUEST_ID_REUSED';
    end if;

    return v_plan.initial_result ||
      jsonb_build_object('replayed', true);
  end if;

  insert into public.meal_plans (
    id,
    student_id,
    start_date,
    end_date,
    desired_status,
    meal_types
  )
  values (
    p_request_id,
    v_student,
    p_start_date,
    p_end_date,
    p_status,
    p_meal_types
  );

  insert into public.meal_plan_days (
    student_id,
    meal_date,
    meal_type,
    plan_id
  )
  select
    v_student,
    p_start_date + day_offset,
    t,
    p_request_id
  from generate_series(
    0,
    p_end_date - p_start_date
  ) day_offset
  cross join unnest(p_meal_types) t
  on conflict (student_id, meal_date, meal_type)
  do update set plan_id = excluded.plan_id;

  for v_meal in
    select id
    from public.meal_slots
    where meal_date between p_start_date and p_end_date
      and meal_type::text = any(p_meal_types)
    order by id
  loop
    v_total := v_total + 1;

    begin
      v_outcome := meal_planner_private.apply_choice(
        v_student,
        v_meal.id,
        p_status,
        p_request_id
      );
    exception
      when raise_exception then
        if sqlerrm in (
          'MEAL_CUTOFF_PASSED',
          'CUTOFF_PASSED',
          'MEAL_ALREADY_REDEEMED',
          'ALREADY_REDEEMED'
        ) then
          v_outcome := 'LOCKED';
        else
          raise;
        end if;
    end;

    if v_outcome = 'UPDATED' then
      v_updated := v_updated + 1;
    elsif v_outcome = 'UNCHANGED' then
      v_unchanged := v_unchanged + 1;
    else
      v_locked := v_locked + 1;
    end if;

    insert into public.meal_plan_applications (
      plan_id,
      student_id,
      meal_slot_id,
      origin,
      outcome
    )
    values (
      p_request_id,
      v_student,
      v_meal.id,
      'EXISTING',
      v_outcome
    );
  end loop;

  v_result := jsonb_build_object(
    'plan_id', p_request_id,
    'updated', v_updated,
    'unchanged', v_unchanged,
    'locked', v_locked,
    'unpublished',
      (p_end_date - p_start_date + 1) *
      cardinality(p_meal_types) - v_total
  );

  update public.meal_plans
  set initial_result = v_result
  where id = p_request_id;

  return v_result;
end;
$$;

-- Stop future coverage without changing existing choices.
create function public.stop_my_meal_plan(
  p_plan_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_removed integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(729104, 1);

  if v_student is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  perform 1
  from public.profiles
  where id = v_student
    and role = 'STUDENT'
    and account_status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  perform 1
  from public.meal_plans
  where id = p_plan_id
    and student_id = v_student
  for update;

  if not found then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  delete from public.meal_plan_days
  where student_id = v_student
    and plan_id = p_plan_id;

  get diagnostics v_removed = row_count;

  update public.meal_plans
  set stopped_at = coalesce(
    stopped_at,
    clock_timestamp()
  )
  where id = p_plan_id;

  return jsonb_build_object(
    'removed_slots',
    v_removed
  );
end;
$$;

-- Serialize publication with plan changes.
create function meal_planner_private.lock_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(729104, 1);
  return null;
end;
$$;

create trigger meal_planner_publication_lock
before insert on public.meal_slots
for each statement
execute function meal_planner_private.lock_publication();

-- Automatically apply plans to newly published meals.
create function meal_planner_private.apply_published_meal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rule record;
  v_outcome text;
begin
  for v_rule in
    select
      d.student_id,
      d.plan_id,
      p.desired_status
    from public.meal_plan_days d
    join public.meal_plans p
      on p.id = d.plan_id
      and p.student_id = d.student_id
    join public.profiles s
      on s.id = d.student_id
      and s.role = 'STUDENT'
      and s.account_status = 'ACTIVE'
    where d.meal_date = new.meal_date
      and d.meal_type = new.meal_type::text
      and p.stopped_at is null
    order by d.student_id
  loop
    if exists (
      select 1
      from public.meal_enrollments
      where student_id = v_rule.student_id
        and meal_slot_id = new.id
    ) then
      v_outcome := 'UNCHANGED';
    else
      begin
        v_outcome :=
          meal_planner_private.apply_choice(
            v_rule.student_id,
            new.id,
            v_rule.desired_status,
            v_rule.plan_id
          );
      exception
        when raise_exception then
          if sqlerrm in (
            'MEAL_CUTOFF_PASSED',
            'CUTOFF_PASSED',
            'MEAL_ALREADY_REDEEMED',
            'ALREADY_REDEEMED'
          ) then
            v_outcome := 'LOCKED';
          elsif sqlerrm = 'ACTIVE_STUDENT_REQUIRED' then
            continue;
          else
            raise;
          end if;
      end;
    end if;

    insert into public.meal_plan_applications (
      plan_id,
      student_id,
      meal_slot_id,
      origin,
      outcome
    )
    values (
      v_rule.plan_id,
      v_rule.student_id,
      new.id,
      'FUTURE',
      v_outcome
    )
    on conflict do nothing;
  end loop;

  return new;
end;
$$;

create trigger meal_planner_apply_after_publish
after insert on public.meal_slots
for each row
execute function meal_planner_private.apply_published_meal();

-- Protect covered meals from date/type reassignment.
create function meal_planner_private.protect_covered_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    old.meal_date is distinct from new.meal_date
    or old.meal_type is distinct from new.meal_type
  )
  and (
    exists (
      select 1
      from public.meal_enrollments
      where meal_slot_id = old.id
    )
    or exists (
      select 1
      from public.meal_plan_days
      where (
        meal_date = old.meal_date
        and meal_type = old.meal_type::text
      )
      or (
        meal_date = new.meal_date
        and meal_type = new.meal_type::text
      )
    )
  ) then
    raise exception 'PLANNED_MEAL_IDENTITY_LOCKED';
  end if;

  return new;
end;
$$;

create trigger meal_planner_identity_lock
before update of meal_date, meal_type
on public.meal_slots
for each statement
execute function meal_planner_private.lock_publication();

create trigger meal_planner_protect_identity
before update of meal_date, meal_type
on public.meal_slots
for each row
execute function meal_planner_private.protect_covered_identity();

-- Restrict function access.
revoke all
on all functions in schema meal_planner_private
from public, anon, authenticated;

revoke execute
on function public.preview_my_meal_plan(date, date, text, text[])
from public, anon, authenticated;

revoke execute
on function public.save_my_meal_plan(date, date, text, text[], uuid)
from public, anon, authenticated;

revoke execute
on function public.stop_my_meal_plan(uuid)
from public, anon, authenticated;

revoke execute
on function public.set_my_meal_choice(uuid, text)
from public, anon, authenticated;

grant execute
on function public.preview_my_meal_plan(date, date, text, text[])
to authenticated;

grant execute
on function public.save_my_meal_plan(date, date, text, text[], uuid)
to authenticated;

grant execute
on function public.stop_my_meal_plan(uuid)
to authenticated;

grant execute
on function public.set_my_meal_choice(uuid, text)
to authenticated;

revoke execute
on function public.post_meal_choice_rebate()
from public, anon, authenticated;

revoke execute
on function public.record_first_meal_charge()
from public, anon, authenticated;

-- Load the student's latest 50 plans.
create function public.get_my_meal_plans()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := auth.uid();
  v_result jsonb;
begin
  if v_student is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = v_student
      and role = 'STUDENT'
      and account_status = 'ACTIVE'
  ) then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(q)
      order by q.sequence_no desc
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      p.id,
      p.sequence_no,
      p.start_date,
      p.end_date,
      p.desired_status,
      p.meal_types,
      p.created_at,
      p.stopped_at,
      p.initial_result,

      (
        select count(*)
        from public.meal_plan_days d
        where d.plan_id = p.id
          and d.meal_date >= (
            clock_timestamp()
            at time zone 'Asia/Kolkata'
          )::date
      ) as scheduled_slots,

      (
        select count(*)
        from public.meal_plan_applications a
        where a.plan_id = p.id
          and origin = 'FUTURE'
          and outcome = 'UPDATED'
      ) as future_updated,

      (
        select count(*)
        from public.meal_plan_applications a
        where a.plan_id = p.id
          and origin = 'FUTURE'
          and outcome = 'LOCKED'
      ) as future_locked

    from public.meal_plans p
    where p.student_id = v_student
    order by p.sequence_no desc
    limit 50
  ) q;

  return v_result;
end;
$$;

revoke execute
on function public.get_my_meal_plans()
from public, anon, authenticated;

grant execute
on function public.get_my_meal_plans()
to authenticated;

notify pgrst, 'reload schema';

commit;