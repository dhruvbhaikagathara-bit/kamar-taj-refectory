create function public.set_my_meal_choice(
  p_meal_slot_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_cutoff timestamptz;
  v_previous_status text;
begin
  -- Identify the student from the authenticated session.
  -- The caller cannot provide another student's ID.
  v_student_id := auth.uid();

  if v_student_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_status is null
     or p_status not in ('OPTED_IN', 'OPTED_OUT') then
    raise exception 'INVALID_MEAL_STATUS';
  end if;

  -- Check the student's role and account status.
  -- This lock also makes simultaneous requests from this
  -- student run one at a time.
  perform 1
  from public.profiles
  where id = v_student_id
    and role = 'STUDENT'
    and account_status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  -- Keep the meal's cutoff unchanged during this transaction.
  select cutoff_at
  into v_cutoff
  from public.meal_slots
  where id = p_meal_slot_id
  for share;

  if not found then
    raise exception 'MEAL_NOT_FOUND';
  end if;

  select status
  into v_previous_status
  from public.meal_enrollments
  where student_id = v_student_id
    and meal_slot_id = p_meal_slot_id
  for update;

  -- Check the actual database time after acquiring locks.
  -- Changes are blocked at the cutoff and afterward.
  if pg_catalog.clock_timestamp() >= v_cutoff then
    raise exception 'MEAL_CUTOFF_PASSED';
  end if;

  if exists (
    select 1
    from public.meal_redemptions
    where student_id = v_student_id
      and meal_slot_id = p_meal_slot_id
  ) then
    raise exception 'MEAL_ALREADY_REDEEMED';
  end if;

  -- Repeating the same choice does not create another audit entry.
  if v_previous_status = p_status then
    return p_status;
  end if;

  insert into public.meal_enrollments (
    student_id,
    meal_slot_id,
    status,
    updated_at
  )
  values (
    v_student_id,
    p_meal_slot_id,
    p_status,
    pg_catalog.clock_timestamp()
  )
  on conflict (student_id, meal_slot_id)
  do update set
    status = excluded.status,
    updated_at = excluded.updated_at;

  -- Save the choice and its audit record in the same transaction.
  insert into public.audit_logs (
    actor_id,
    student_id,
    meal_slot_id,
    action,
    details
  )
  values (
    v_student_id,
    v_student_id,
    p_meal_slot_id,
    case
      when p_status = 'OPTED_IN' then 'MEAL_OPTED_IN'
      else 'MEAL_OPTED_OUT'
    end,
    pg_catalog.jsonb_build_object(
      'previous_status', v_previous_status,
      'new_status', p_status
    )
  );

  return p_status;
end;
$$;

-- Remove default execution permissions.
revoke execute
on function public.set_my_meal_choice(uuid, text)
from public, anon, authenticated;

-- Signed-in users can call the function.
-- Its internal checks permit only active students.
grant execute
on function public.set_my_meal_choice(uuid, text)
to authenticated;