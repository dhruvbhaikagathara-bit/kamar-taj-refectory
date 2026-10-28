begin;

-- One surplus batch for each meal.
create table public.meal_surplus_reports (
  meal_slot_id uuid primary key
    references public.meal_slots(id),

  portions integer not null
    check (portions between 1 and 100000),

  collect_by timestamptz not null
    check (pg_catalog.isfinite(collect_by)),

  status text not null default 'AVAILABLE'
    check (
      status in (
        'AVAILABLE',
        'ASSIGNED',
        'COLLECTED',
        'DISCARDED',
        'CANCELLED'
      )
    ),

  recipient text not null default ''
    check (char_length(recipient) <= 200),

  notes text not null default ''
    check (char_length(notes) <= 1000),

  version integer not null default 1
    check (version > 0),

  created_by uuid not null
    references public.profiles(id),

  updated_by uuid not null
    references public.profiles(id),

  created_at timestamptz not null
    default pg_catalog.clock_timestamp(),

  updated_at timestamptz not null
    default pg_catalog.clock_timestamp(),

  constraint surplus_recipient_required check (
    status not in ('ASSIGNED', 'COLLECTED')
    or char_length(btrim(recipient)) > 0
  ),

  constraint surplus_available_without_recipient check (
    status <> 'AVAILABLE' or recipient = ''
  ),

  constraint surplus_deadline_after_creation check (
    collect_by > created_at
  )
);

create index meal_surplus_reports_status_deadline_idx
  on public.meal_surplus_reports(status, collect_by);

-- An immutable snapshot of every saved revision.
create table public.meal_surplus_history (
  meal_slot_id uuid not null
    references public.meal_surplus_reports(meal_slot_id),

  version integer not null,
  actor_id uuid not null references public.profiles(id),
  recorded_at timestamptz not null
    default pg_catalog.clock_timestamp(),

  snapshot jsonb not null,

  primary key (meal_slot_id, version)
);

alter table public.meal_surplus_reports
  enable row level security;

alter table public.meal_surplus_history
  enable row level security;

-- Check only the currently authenticated user's role.
create function public.can_manage_meal_surplus()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'ADMIN'
      and account_status = 'ACTIVE'
  );
$$;

revoke all
on function public.can_manage_meal_surplus()
from public, anon, authenticated;

grant execute
on function public.can_manage_meal_surplus()
to authenticated;

create policy surplus_reports_admin_read
on public.meal_surplus_reports
for select
to authenticated
using (
  (select public.can_manage_meal_surplus())
);

create policy surplus_history_admin_read
on public.meal_surplus_history
for select
to authenticated
using (
  (select public.can_manage_meal_surplus())
);

-- Clients can read through RLS.
-- All writes must go through the checked function below.
revoke all
on public.meal_surplus_reports,
   public.meal_surplus_history
from public, anon, authenticated;

grant select
on public.meal_surplus_reports,
   public.meal_surplus_history
to authenticated;

create function public.save_meal_surplus(
  p_meal_slot_id uuid,
  p_portions integer,
  p_collect_by timestamptz,
  p_status text,
  p_recipient text,
  p_notes text,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_start timestamptz;
  v_now timestamptz;

  v_recipient text := btrim(coalesce(p_recipient, ''));
  v_notes text := btrim(coalesce(p_notes, ''));

  v_existing public.meal_surplus_reports%rowtype;
  v_saved public.meal_surplus_reports%rowtype;
  v_exists boolean;
begin
  v_actor := auth.uid();

  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Keep admin authorization stable during the operation.
  perform 1
  from public.profiles
  where id = v_actor
    and role = 'ADMIN'
    and account_status = 'ACTIVE'
  for share;

  if not found then
    raise exception 'ACTIVE_ADMIN_REQUIRED';
  end if;

  if p_meal_slot_id is null then
    raise exception 'INVALID_MEAL_ID';
  end if;

  if p_portions is null
     or p_portions < 1
     or p_portions > 100000 then
    raise exception 'INVALID_SURPLUS_PORTIONS';
  end if;

  if p_collect_by is null
     or not pg_catalog.isfinite(p_collect_by) then
    raise exception 'INVALID_COLLECTION_DEADLINE';
  end if;

  if p_status is null
     or p_status not in (
       'AVAILABLE',
       'ASSIGNED',
       'COLLECTED',
       'DISCARDED',
       'CANCELLED'
     ) then
    raise exception 'INVALID_SURPLUS_STATUS';
  end if;

  if char_length(v_recipient) > 200
     or char_length(v_notes) > 1000 then
    raise exception 'SURPLUS_TEXT_TOO_LONG';
  end if;

  if p_expected_version is null
     or p_expected_version < 0 then
    raise exception 'INVALID_SURPLUS_VERSION';
  end if;

  if p_status in ('ASSIGNED', 'COLLECTED')
     and v_recipient = '' then
    raise exception 'RECIPIENT_REQUIRED';
  end if;

  if p_status = 'AVAILABLE' then
    v_recipient := '';
  end if;

  -- Serializes competing creations for the same meal.
  -- Also keeps the meal schedule stable.
  select serve_start
  into v_start
  from public.meal_slots
  where id = p_meal_slot_id
  for update;

  if not found then
    raise exception 'MEAL_NOT_FOUND';
  end if;

  select *
  into v_existing
  from public.meal_surplus_reports
  where meal_slot_id = p_meal_slot_id
  for update;

  v_exists := found;

  -- Use database time after acquiring locks.
  v_now := pg_catalog.clock_timestamp();

  if v_start is null or v_now < v_start then
    raise exception 'SURPLUS_SERVING_NOT_STARTED';
  end if;

  if not v_exists then
    if p_expected_version <> 0 then
      raise exception 'SURPLUS_VERSION_CONFLICT';
    end if;

    if p_status <> 'AVAILABLE' then
      raise exception 'SURPLUS_MUST_START_AVAILABLE';
    end if;

    if p_collect_by <= v_now then
      raise exception 'COLLECTION_DEADLINE_PASSED';
    end if;

    insert into public.meal_surplus_reports (
      meal_slot_id,
      portions,
      collect_by,
      status,
      recipient,
      notes,
      created_by,
      updated_by,
      created_at,
      updated_at
    )
    values (
      p_meal_slot_id,
      p_portions,
      p_collect_by,
      'AVAILABLE',
      '',
      v_notes,
      v_actor,
      v_actor,
      v_now,
      v_now
    )
    returning * into v_saved;

  else
    -- Repeating an identical save creates no extra history.
    if v_existing.portions = p_portions
       and v_existing.collect_by = p_collect_by
       and v_existing.status = p_status
       and v_existing.recipient = v_recipient
       and v_existing.notes = v_notes then
      return pg_catalog.to_jsonb(v_existing);
    end if;

    if v_existing.version <> p_expected_version then
      raise exception 'SURPLUS_VERSION_CONFLICT';
    end if;

    -- Closed batches cannot be reopened or rewritten.
    if v_existing.status in (
      'COLLECTED',
      'DISCARDED',
      'CANCELLED'
    ) then
      raise exception 'SURPLUS_ALREADY_CLOSED';
    end if;

    -- An expired batch may only be closed.
    -- Changing its deadline cannot reactivate it.
    if v_existing.collect_by <= v_now
       and p_status not in ('DISCARDED', 'CANCELLED') then
      raise exception 'COLLECTION_DEADLINE_PASSED';
    end if;

    if p_status in ('AVAILABLE', 'ASSIGNED', 'COLLECTED')
       and p_collect_by <= v_now then
      raise exception 'COLLECTION_DEADLINE_PASSED';
    end if;

    if p_status = 'COLLECTED'
       and v_existing.status <> 'ASSIGNED' then
      raise exception 'SURPLUS_ASSIGN_FIRST';
    end if;

    -- Edit quantity/deadline only while remaining AVAILABLE.
    -- State changes keep the original batch measurements.
    if (
      v_existing.status <> 'AVAILABLE'
      or p_status <> 'AVAILABLE'
    ) and (
      p_portions <> v_existing.portions
      or p_collect_by <> v_existing.collect_by
    ) then
      raise exception 'SURPLUS_BATCH_DETAILS_LOCKED';
    end if;

    -- Collection must match the assigned recipient.
    if p_status = 'COLLECTED'
       and v_recipient <> v_existing.recipient then
      raise exception 'SURPLUS_RECIPIENT_CHANGED';
    end if;

    if p_status in ('DISCARDED', 'CANCELLED')
       and v_notes = '' then
      raise exception 'SURPLUS_CLOSURE_REASON_REQUIRED';
    end if;

    update public.meal_surplus_reports
    set
      portions = p_portions,
      collect_by = p_collect_by,
      status = p_status,
      recipient = v_recipient,
      notes = v_notes,
      version = version + 1,
      updated_by = v_actor,
      updated_at = v_now
    where meal_slot_id = p_meal_slot_id
    returning * into v_saved;
  end if;

  -- Report and revision history commit together.
  insert into public.meal_surplus_history (
    meal_slot_id,
    version,
    actor_id,
    recorded_at,
    snapshot
  )
  values (
    v_saved.meal_slot_id,
    v_saved.version,
    v_actor,
    v_now,
    pg_catalog.to_jsonb(v_saved)
  );

  return pg_catalog.to_jsonb(v_saved);
end;
$$;

revoke all
on function public.save_meal_surplus(
  uuid, integer, timestamptz, text, text, text, integer
)
from public, anon, authenticated;

grant execute
on function public.save_meal_surplus(
  uuid, integer, timestamptz, text, text, text, integer
)
to authenticated;

notify pgrst, 'reload schema';

commit;