begin;

create function public.prepare_offline_scan_session(
  p_scanner_id uuid,
  p_device_id uuid,
  p_meal_slot_id uuid,
  p_signing_key_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz;
  v_serve_start timestamptz;
  v_serve_end timestamptz;
  v_now timestamptz;

  v_session public.offline_scan_sessions%rowtype;

  v_student_ids jsonb;
  v_eligible_count integer;
  v_recent_count integer;
begin
  -- These arguments come from the trusted backend.
  -- Scanner identity must come from the verified login.
  if p_scanner_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if p_device_id is null then
    raise exception 'INVALID_DEVICE_ID';
  end if;

  if p_meal_slot_id is null then
    raise exception 'MEAL_NOT_FOUND';
  end if;

  if p_signing_key_id is null
     or p_signing_key_id !~ '^[A-Za-z0-9_-]{1,80}$'
     or p_signing_key_id = 'qr-key-v1' then
    raise exception 'INVALID_SIGNING_KEY';
  end if;

  -- Serialize preparations for this scanner and keep
  -- their authorization stable during the operation.
  perform 1
  from public.profiles
  where id = p_scanner_id
    and role = 'SCANNER_STAFF'
    and account_status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'ACTIVE_SCANNER_REQUIRED';
  end if;

  select cutoff_at, serve_start, serve_end
  into v_cutoff, v_serve_start, v_serve_end
  from public.meal_slots
  where id = p_meal_slot_id
  for share;

  if not found then
    raise exception 'MEAL_NOT_FOUND';
  end if;

  v_now := clock_timestamp();

  if v_cutoff is null
     or v_serve_start is null
     or v_serve_end is null
     or v_serve_end <= v_serve_start then
    raise exception 'INVALID_MEAL_WINDOW';
  end if;

  if v_now < v_cutoff then
    raise exception 'MEAL_CHOICES_STILL_OPEN';
  end if;

  if v_now < v_serve_start then
    raise exception 'SERVING_NOT_STARTED';
  end if;

  if v_now >= v_serve_end then
    raise exception 'SERVING_WINDOW_CLOSED';
  end if;

  -- Limit repeated preparation requests.
  select count(*)
  into v_recent_count
  from public.offline_scan_sessions
  where scanner_id = p_scanner_id
    and prepared_at >= v_now - interval '1 minute';

  if v_recent_count >= 5 then
    raise exception 'PREPARATION_RATE_LIMITED';
  end if;

  insert into public.offline_scan_sessions (
    scanner_id,
    device_id,
    meal_slot_id,
    signing_key_id,
    prepared_at,
    serve_start,
    serve_end,
    capture_start,
    capture_expires_at,
    sync_deadline
  )
  values (
    p_scanner_id,
    p_device_id,
    p_meal_slot_id,
    p_signing_key_id,
    v_now,
    v_serve_start,
    v_serve_end,
    v_now,
    least(
      v_now + interval '15 minutes',
      v_serve_end
    ),
    least(
      v_now + interval '15 minutes',
      v_serve_end
    ) + interval '24 hours'
  )
  returning * into v_session;

  -- Capture eligibility in one statement.
  -- No student names or email addresses are downloaded.
  insert into public.offline_scan_eligibility (
    session_id,
    student_id
  )
  select
    v_session.id,
    e.student_id
  from public.meal_enrollments e
  join public.profiles p
    on p.id = e.student_id
  where e.meal_slot_id = p_meal_slot_id
    and e.status = 'OPTED_IN'
    and p.role = 'STUDENT'
    and p.account_status = 'ACTIVE'
    and not exists (
      select 1
      from public.meal_redemptions r
      where r.student_id = e.student_id
        and r.meal_slot_id = p_meal_slot_id
    );

  get diagnostics v_eligible_count = row_count;

  -- Bound the downloaded snapshot for this implementation.
  -- Raising an exception rolls back the entire preparation.
  if v_eligible_count > 10000 then
    raise exception 'OFFLINE_ROSTER_TOO_LARGE';
  end if;

  select coalesce(
    jsonb_agg(student_id order by student_id),
    '[]'::jsonb
  )
  into v_student_ids
  from public.offline_scan_eligibility
  where session_id = v_session.id;

  -- Do not return a session that expired during preparation.
  v_now := clock_timestamp();

  if v_now >= v_session.capture_expires_at then
    raise exception 'OFFLINE_SESSION_EXPIRED';
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'scanner_id', v_session.scanner_id,
    'device_id', v_session.device_id,
    'meal_slot_id', v_session.meal_slot_id,
    'signing_key_id', v_session.signing_key_id,
    'prepared_at', v_session.prepared_at,
    'serve_start', v_session.serve_start,
    'serve_end', v_session.serve_end,
    'capture_start', v_session.capture_start,
    'capture_expires_at', v_session.capture_expires_at,
    'sync_deadline', v_session.sync_deadline,
    'server_now', v_now,
    'eligible_student_ids', v_student_ids,
    'eligible_count', v_eligible_count
  );
end;
$$;

-- Only the trusted backend can call this function.
revoke execute
on function public.prepare_offline_scan_session(
  uuid,
  uuid,
  uuid,
  text
)
from public, anon, authenticated;

grant execute
on function public.prepare_offline_scan_session(
  uuid,
  uuid,
  uuid,
  text
)
to service_role;

notify pgrst, 'reload schema';

commit;