begin;

-- Prevent meal choices from changing while opening charges are recorded.
lock table public.meal_slots,
           public.meal_enrollments,
           public.rebate_ledger
in share row exclusive mode;

-- One permanent base charge per student and meal.
create table public.meal_charges (
  id uuid primary key default gen_random_uuid(),

  student_id uuid not null,
  meal_slot_id uuid not null,

  amount_paise integer not null check (amount_paise >= 0),
  meal_date date not null,

  origin text not null
    check (origin in ('FIRST_OPT_IN', 'OPENING_SNAPSHOT')),

  created_at timestamptz not null default now(),

  constraint meal_charges_student_meal_unique
    unique (student_id, meal_slot_id),

  constraint meal_charges_enrollment_fk
    foreign key (student_id, meal_slot_id)
    references public.meal_enrollments (student_id, meal_slot_id)
);

create index meal_charges_student_month_idx
  on public.meal_charges (student_id, meal_date);

alter table public.meal_charges enable row level security;

revoke all on table public.meal_charges
  from public, anon, authenticated;

grant select on table public.meal_charges to authenticated;

create policy "Students read their own meal charges"
on public.meal_charges
for select
to authenticated
using (
  student_id = (select auth.uid())
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'STUDENT'
      and p.account_status = 'ACTIVE'
  )
);

-- Import known existing commitments and meals with rebate history.
-- Older opted-out choices with no rebate history are not charged.
insert into public.meal_charges (
  student_id,
  meal_slot_id,
  amount_paise,
  meal_date,
  origin
)
select
  e.student_id,
  e.meal_slot_id,
  m.price_paise,
  m.meal_date,
  'OPENING_SNAPSHOT'
from public.meal_enrollments e
join public.meal_slots m on m.id = e.meal_slot_id
where e.status = 'OPTED_IN'
   or exists (
     select 1
     from public.rebate_ledger r
     where r.student_id = e.student_id
       and r.meal_slot_id = e.meal_slot_id
   );

-- Stop rather than import an inconsistent rebate balance.
do $$
begin
  if exists (
    select 1
    from public.meal_charges c
    join public.rebate_ledger r
      on r.student_id = c.student_id
     and r.meal_slot_id = c.meal_slot_id
    group by c.id, c.amount_paise
    having sum(r.delta_paise) < 0
        or sum(r.delta_paise) > c.amount_paise
  ) then
    raise exception 'BILLING_OPENING_BALANCE_INVALID';
  end if;
end;
$$;

insert into public.audit_logs (
  student_id,
  meal_slot_id,
  action,
  details
)
select
  c.student_id,
  c.meal_slot_id,
  'BILLING_OPENING_CHARGE_RECORDED',
  jsonb_build_object(
    'charge_id', c.id,
    'amount_paise', c.amount_paise,
    'meal_date', c.meal_date,
    'basis', 'CURRENT_SAVED_MEAL_PRICE',
    'policy', 'FIRST_OPT_IN_FULL_PRICE_V1'
  )
from public.meal_charges c
where c.origin = 'OPENING_SNAPSHOT';

-- Charges are append-only.
create function public.protect_meal_charge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'MEAL_CHARGE_APPEND_ONLY';
end;
$$;

create trigger prevent_meal_charge_changes
before update or delete on public.meal_charges
for each row execute function public.protect_meal_charge();

revoke execute on function public.protect_meal_charge()
from public, anon, authenticated, service_role;

-- Once a meal has enrollments, keep its billing price/date fixed.
-- Menu-only changes are still allowed.
create function public.protect_enrolled_meal_billing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    new.price_paise is distinct from old.price_paise
    or new.meal_date is distinct from old.meal_date
  ) and exists (
    select 1
    from public.meal_enrollments e
    where e.meal_slot_id = old.id
  ) then
    raise exception 'ENROLLED_MEAL_BILLING_FIELDS_LOCKED';
  end if;

  return new;
end;
$$;

create trigger protect_enrolled_meal_billing_fields
before update of price_paise, meal_date on public.meal_slots
for each row
execute function public.protect_enrolled_meal_billing();

revoke execute on function public.protect_enrolled_meal_billing()
from public, anon, authenticated, service_role;

-- Add the charge when a student first opts in.
-- Repeated opt-ins cannot add another charge.
create function public.record_first_meal_charge()
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

  if auth.uid() is null
     or auth.uid() <> new.student_id
     or not exists (
       select 1
       from public.profiles p
       where p.id = auth.uid()
         and p.role = 'STUDENT'
         and p.account_status = 'ACTIVE'
     )
  then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

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
      auth.uid(),
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

create trigger record_meal_charge
after insert or update of status on public.meal_enrollments
for each row
execute function public.record_first_meal_charge();

revoke execute on function public.record_first_meal_charge()
from public, anon, authenticated, service_role;

-- Read-only live monthly summary for the signed-in student.
-- This does not issue or finalize an invoice.
create function public.get_my_monthly_bill(p_month text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_student_id uuid := auth.uid();
  v_start date;
  v_end date;

  v_base bigint;
  v_rebate bigint;
  v_count bigint;
  v_opening_count bigint;
  v_unpriced_count bigint;
  v_invalid boolean;
  v_items jsonb;
begin
  if v_student_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_student_id
      and p.role = 'STUDENT'
      and p.account_status = 'ACTIVE'
  ) then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  if p_month is null
     or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
  then
    raise exception 'INVALID_MONTH';
  end if;

  v_start := (p_month || '-01')::date;
  v_end := (v_start + interval '1 month')::date;

  -- Every rebate in this month must have a corresponding charge.
  if exists (
    select 1
    from public.rebate_ledger r
    join public.meal_slots m on m.id = r.meal_slot_id
    where r.student_id = v_student_id
      and m.meal_date >= v_start
      and m.meal_date < v_end
      and not exists (
        select 1
        from public.meal_charges c
        where c.student_id = r.student_id
          and c.meal_slot_id = r.meal_slot_id
      )
  ) then
    raise exception 'BILLING_RECONCILIATION_REQUIRED';
  end if;

  with items as (
    select
      c.id,
      c.meal_slot_id,
      c.meal_date,
      c.amount_paise,
      c.origin,
      m.meal_type,
      m.menu,
      coalesce((
        select sum(r.delta_paise)
        from public.rebate_ledger r
        where r.student_id = c.student_id
          and r.meal_slot_id = c.meal_slot_id
      ), 0)::bigint as rebate_paise
    from public.meal_charges c
    join public.meal_slots m on m.id = c.meal_slot_id
    where c.student_id = v_student_id
      and c.meal_date >= v_start
      and c.meal_date < v_end
  )
  select
    coalesce(sum(i.amount_paise), 0)::bigint,
    coalesce(sum(i.rebate_paise), 0)::bigint,
    count(*),
    count(*) filter (where i.origin = 'OPENING_SNAPSHOT'),
    coalesce(bool_or(
      i.rebate_paise < 0
      or i.rebate_paise > i.amount_paise
    ), false),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'charge_id', i.id,
          'meal_slot_id', i.meal_slot_id,
          'meal_date', i.meal_date,
          'meal_type', i.meal_type,
          'menu', i.menu,
          'origin', i.origin,
          'base_charge_paise', i.amount_paise::text,
          'net_rebate_paise', i.rebate_paise::text,
          'amount_due_paise',
            (i.amount_paise - i.rebate_paise)::text
        )
        order by i.meal_date, i.meal_slot_id
      ),
      '[]'::jsonb
    )
  into
    v_base,
    v_rebate,
    v_count,
    v_opening_count,
    v_invalid,
    v_items
  from items i;

  if v_invalid then
    raise exception 'BILLING_RECONCILIATION_REQUIRED';
  end if;

  select count(*)
  into v_unpriced_count
  from public.meal_enrollments e
  join public.meal_slots m on m.id = e.meal_slot_id
  where e.student_id = v_student_id
    and m.meal_date >= v_start
    and m.meal_date < v_end
    and e.status = 'OPTED_OUT'
    and not exists (
      select 1
      from public.meal_charges c
      where c.student_id = e.student_id
        and c.meal_slot_id = e.meal_slot_id
    );

  return jsonb_build_object(
    'month', p_month,
    'status', 'LIVE_SUMMARY',
    'policy', 'FIRST_OPT_IN_FULL_PRICE_V1',
    'base_charges_paise', v_base::text,
    'net_rebate_paise', v_rebate::text,
    'amount_due_paise', greatest(0, v_base - v_rebate)::text,
    'charged_meal_count', v_count,
    'opening_snapshot_count', v_opening_count,
    'uncharged_opted_out_count', v_unpriced_count,
    'items', v_items
  );
end;
$$;

revoke execute on function public.get_my_monthly_bill(text)
from public, anon, authenticated, service_role;

grant execute on function public.get_my_monthly_bill(text)
to authenticated;

commit;