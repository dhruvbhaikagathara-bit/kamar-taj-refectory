create function public.set_my_dietary_preference(
  p_preference text,
  p_notes text default ''
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_notes text;
  v_previous_preference text;
  v_previous_notes text;
begin
  -- Always use the identity from the login session.
  v_student_id := auth.uid();

  if v_student_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_preference is null
     or p_preference not in (
       'VEGETARIAN',
       'NON_VEGETARIAN',
       'VEGAN',
       'JAIN'
     ) then
    raise exception 'INVALID_DIETARY_PREFERENCE';
  end if;

  v_notes := pg_catalog.btrim(coalesce(p_notes, ''));

  if pg_catalog.char_length(v_notes) > 500 then
    raise exception 'DIETARY_NOTES_TOO_LONG';
  end if;

  -- Only active students can change their own preference.
  -- Serialize simultaneous updates from the same student.
  perform 1
  from public.profiles
  where id = v_student_id
    and role = 'STUDENT'
    and account_status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  select preference, notes
  into v_previous_preference, v_previous_notes
  from public.dietary_preferences
  where student_id = v_student_id
  for update;

  -- Repeated identical saves do not create extra audit records.
  if v_previous_preference = p_preference
     and coalesce(v_previous_notes, '') = v_notes then
    return p_preference;
  end if;

  insert into public.dietary_preferences (
    student_id,
    preference,
    notes,
    updated_at
  )
  values (
    v_student_id,
    p_preference,
    v_notes,
    pg_catalog.clock_timestamp()
  )
  on conflict (student_id)
  do update set
    preference = excluded.preference,
    notes = excluded.notes,
    updated_at = excluded.updated_at;

  insert into public.audit_logs (
    actor_id,
    student_id,
    action,
    details
  )
  values (
    v_student_id,
    v_student_id,
    'DIETARY_PREFERENCE_UPDATED',
    pg_catalog.jsonb_build_object(
      'previous_preference', v_previous_preference,
      'new_preference', p_preference,
      'notes_changed',
        coalesce(v_previous_notes, '') is distinct from v_notes
    )
  );

  return p_preference;
end;
$$;

revoke execute
on function public.set_my_dietary_preference(text, text)
from public, anon, authenticated;

grant execute
on function public.set_my_dietary_preference(text, text)
to authenticated;