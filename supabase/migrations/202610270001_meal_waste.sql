begin;

-- One current waste report per meal.
create table public.meal_waste_reports (
  meal_slot_id uuid primary key
    references public.meal_slots(id),

  prepared_portions integer not null
    check (prepared_portions between 0 and 100000),

  leftover_portions integer not null
    check (leftover_portions between 0 and 100000),

  -- Actual weighed food discarded, including plate waste.
  -- Stored in grams; the form will accept kilograms.
  waste_grams integer not null
    check (waste_grams between 0 and 100000000),

  notes text not null default ''
    check (char_length(notes) <= 1000),

  version integer not null default 1
    check (version > 0),

  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),

  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),

  check (leftover_portions <= prepared_portions),

  check (
    prepared_portions > 0
    or waste_grams = 0
  )
);

-- Keep every saved revision for accountability.
create table public.meal_waste_report_history (
  id uuid primary key default gen_random_uuid(),

  meal_slot_id uuid not null
    references public.meal_waste_reports(meal_slot_id),

  version integer not null,

  actor_id uuid not null references public.profiles(id),

  previous_report jsonb,
  new_report jsonb not null,

  recorded_at timestamptz not null default clock_timestamp(),

  unique (meal_slot_id, version)
);

alter table public.meal_waste_reports
enable row level security;

alter table public.meal_waste_report_history
enable row level security;

-- Clients may read authorized records.
-- All writes go through the validated function below.
revoke all
on public.meal_waste_reports,
   public.meal_waste_report_history
from public, anon, authenticated;

grant select
on public.meal_waste_reports,
   public.meal_waste_report_history
to authenticated;

create policy active_admin_read_waste_reports
on public.meal_waste_reports
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'ADMIN'
      and p.account_status = 'ACTIVE'
  )
);

create policy active_admin_read_waste_history
on public.meal_waste_report_history
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'ADMIN'
      and p.account_status = 'ACTIVE'
  )
);

create function public.save_meal_waste_report(
  p_meal_slot_id uuid,
  p_prepared_portions integer,
  p_leftover_portions integer,
  p_waste_grams integer,
  p_notes text,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_serve_end timestamptz;

  v_previous public.meal_waste_reports%rowtype;
  v_saved public.meal_waste_reports%rowtype;

  v_previous_json jsonb;
  v_current_version integer;
  v_notes text := btrim(coalesce(p_notes, ''));
begin
  if v_admin is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Keep authorization stable during this transaction.
  perform 1
  from public.profiles
  where id = v_admin
    and role = 'ADMIN'
    and account_status = 'ACTIVE'
  for share;

  if not found then
    raise exception 'ACTIVE_ADMIN_REQUIRED';
  end if;

  if p_meal_slot_id is null then
    raise exception 'MEAL_NOT_FOUND';
  end if;

  if p_prepared_portions is null
     or p_prepared_portions < 0
     or p_prepared_portions > 100000 then
    raise exception 'INVALID_PREPARED_PORTIONS';
  end if;

  if p_leftover_portions is null
     or p_leftover_portions < 0
     or p_leftover_portions > p_prepared_portions then
    raise exception 'INVALID_LEFTOVER_PORTIONS';
  end if;

  if p_waste_grams is null
     or p_waste_grams < 0
     or p_waste_grams > 100000000 then
    raise exception 'INVALID_WASTE_WEIGHT';
  end if;

  if p_prepared_portions = 0
     and p_waste_grams > 0 then
    raise exception 'WASTE_WITHOUT_PREPARATION';
  end if;

  if char_length(v_notes) > 1000 then
    raise exception 'WASTE_NOTES_TOO_LONG';
  end if;

  if p_expected_version is null
     or p_expected_version < 0 then
    raise exception 'INVALID_REPORT_VERSION';
  end if;

  -- Serialize report saves for this meal, including the
  -- first save when no report row exists yet.
  select serve_end
  into v_serve_end
  from public.meal_slots
  where id = p_meal_slot_id
  for update;

  if not found then
    raise exception 'MEAL_NOT_FOUND';
  end if;

  -- Final measurements are recorded after serving ends.
  if v_serve_end is null
     or clock_timestamp() < v_serve_end then
    raise exception 'MEAL_STILL_SERVING';
  end if;

  select *
  into v_previous
  from public.meal_waste_reports
  where meal_slot_id = p_meal_slot_id
  for update;

  if found then
    v_current_version := v_previous.version;
    v_previous_json := to_jsonb(v_previous);

    -- A repeated save with identical values is harmless.
    if v_previous.prepared_portions = p_prepared_portions
       and v_previous.leftover_portions = p_leftover_portions
       and v_previous.waste_grams = p_waste_grams
       and v_previous.notes = v_notes then
      return to_jsonb(v_previous);
    end if;
  else
    v_current_version := 0;
    v_previous_json := null;
  end if;

  -- Avoid silently overwriting another admin's changes.
  if p_expected_version <> v_current_version then
    raise exception 'WASTE_REPORT_CHANGED';
  end if;

  insert into public.meal_waste_reports (
    meal_slot_id,
    prepared_portions,
    leftover_portions,
    waste_grams,
    notes,
    version,
    created_by,
    updated_by
  )
  values (
    p_meal_slot_id,
    p_prepared_portions,
    p_leftover_portions,
    p_waste_grams,
    v_notes,
    1,
    v_admin,
    v_admin
  )
  on conflict (meal_slot_id)
  do update set
    prepared_portions = excluded.prepared_portions,
    leftover_portions = excluded.leftover_portions,
    waste_grams = excluded.waste_grams,
    notes = excluded.notes,
    version = v_current_version + 1,
    updated_by = v_admin,
    updated_at = clock_timestamp()
  returning * into v_saved;

  insert into public.meal_waste_report_history (
    meal_slot_id,
    version,
    actor_id,
    previous_report,
    new_report
  )
  values (
    p_meal_slot_id,
    v_saved.version,
    v_admin,
    v_previous_json,
    to_jsonb(v_saved)
  );

  return to_jsonb(v_saved);
end;
$$;

revoke execute
on function public.save_meal_waste_report(
  uuid,
  integer,
  integer,
  integer,
  text,
  integer
)
from public, anon, authenticated;

grant execute
on function public.save_meal_waste_report(
  uuid,
  integer,
  integer,
  integer,
  text,
  integer
)
to authenticated;

notify pgrst, 'reload schema';

commit;