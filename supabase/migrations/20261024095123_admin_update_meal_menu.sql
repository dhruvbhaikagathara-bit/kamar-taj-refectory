create or replace function public.admin_update_meal_menu(
  p_meal_slot_id uuid,
  p_menu text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_menu text := btrim(coalesce(p_menu, ''));
  v_previous_menu text;
  v_cutoff_at timestamptz;
begin
  if v_actor_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Verify the caller's current role in the database.
  perform 1
  from public.profiles
  where id = v_actor_id
    and role = 'ADMIN'
    and account_status = 'ACTIVE'
  for share;

  if not found then
    raise exception 'ACTIVE_ADMIN_REQUIRED';
  end if;

  if char_length(v_menu) < 3
     or char_length(v_menu) > 1000 then
    raise exception 'INVALID_MENU_LENGTH';
  end if;

  -- Lock this meal while checking and updating it.
  select menu, cutoff_at
  into v_previous_menu, v_cutoff_at
  from public.meal_slots
  where id = p_meal_slot_id
  for update;

  if not found then
    raise exception 'MEAL_NOT_FOUND';
  end if;

  -- Check the actual database time after acquiring the lock.
  if clock_timestamp() >= v_cutoff_at then
    raise exception 'MEAL_CUTOFF_PASSED';
  end if;

  -- Repeated submissions of the same menu need no new audit entry.
  if v_previous_menu = v_menu then
    return p_meal_slot_id;
  end if;

  update public.meal_slots
  set menu = v_menu
  where id = p_meal_slot_id;

  insert into public.audit_logs (
    actor_id,
    meal_slot_id,
    action,
    details
  )
  values (
    v_actor_id,
    p_meal_slot_id,
    'MEAL_MENU_UPDATED',
    jsonb_build_object(
      'previous_menu', v_previous_menu,
      'new_menu', v_menu
    )
  );

  return p_meal_slot_id;
end;
$$;

revoke execute
on function public.admin_update_meal_menu(uuid, text)
from public, anon, authenticated;

grant execute
on function public.admin_update_meal_menu(uuid, text)
to authenticated;