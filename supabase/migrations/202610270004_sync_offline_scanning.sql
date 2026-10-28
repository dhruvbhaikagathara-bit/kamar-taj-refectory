begin;

create function public.sync_verified_offline_scan(
  p_scanner_id uuid,
  p_device_id uuid,
  p_session_id uuid,
  p_scan_id uuid,
  p_meal_slot_id uuid,
  p_student_id uuid,
  p_token_jti uuid,
  p_token_issued_at bigint,
  p_token_expires_at bigint,
  p_signing_key_id text,
  p_observed_at timestamptz,
  p_request_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.offline_scan_sessions%rowtype;
  v_receipt public.offline_scan_receipts%rowtype;

  v_student_active boolean;
  v_enrollment_status text;

  v_serve_start timestamptz;
  v_serve_end timestamptz;

  v_now timestamptz;
  v_observed_epoch numeric;

  v_redemption_id uuid;
  v_existing_token uuid;
  v_existing_scanner uuid;

  v_outcome text := 'REJECTED';
  v_code text;
begin
  -- Identity and token claims must come from the
  -- authenticated backend and verified ES256 token.
  if p_scanner_id is null
     or p_device_id is null
     or p_session_id is null
     or p_scan_id is null
     or p_meal_slot_id is null
     or p_student_id is null
     or p_token_jti is null
     or p_token_issued_at is null
     or p_token_expires_at is null
     or p_observed_at is null
     or p_signing_key_id is null
     or p_request_sha256 is null then
    raise exception 'INVALID_SYNC_REQUEST';
  end if;

  if p_request_sha256 !~ '^[0-9a-f]{64}$'
     or p_signing_key_id !~ '^[A-Za-z0-9_-]{1,80}$'
     or p_signing_key_id = 'qr-key-v1'
     or not isfinite(p_observed_at)
     or p_token_issued_at < 0
     or p_token_expires_at <= p_token_issued_at
     or (
       p_token_expires_at::numeric
       - p_token_issued_at::numeric
     ) > 30 then
    raise exception 'INVALID_SYNC_REQUEST';
  end if;

  -- Serialize retries using the same scan ID.
  -- Hash collisions only cause additional serialization.
  perform pg_catalog.pg_advisory_xact_lock(
    729105,
    pg_catalog.hashtext(p_scan_id::text)
  );

  select *
  into v_session
  from public.offline_scan_sessions
  where id = p_session_id;

  if not found then
    raise exception 'OFFLINE_SESSION_NOT_FOUND';
  end if;

  if v_session.scanner_id <> p_scanner_id
     or v_session.device_id <> p_device_id
     or v_session.meal_slot_id <> p_meal_slot_id
     or v_session.signing_key_id <> p_signing_key_id then
    raise exception 'OFFLINE_SESSION_MISMATCH';
  end if;

  -- Match the online redemption lock order:
  -- student profile -> scanner profile -> meal -> enrollment.
  select (
    role = 'STUDENT'
    and account_status = 'ACTIVE'
  )
  into v_student_active
  from public.profiles
  where id = p_student_id
  for update;

  if not found then
    raise exception 'STUDENT_NOT_FOUND';
  end if;

  perform 1
  from public.profiles
  where id = p_scanner_id
    and role = 'SCANNER_STAFF'
    and account_status = 'ACTIVE'
  for share;

  if not found then
    raise exception 'ACTIVE_SCANNER_REQUIRED';
  end if;

  select serve_start, serve_end
  into v_serve_start, v_serve_end
  from public.meal_slots
  where id = p_meal_slot_id
  for share;

  if not found then
    raise exception 'MEAL_NOT_FOUND';
  end if;

  select status
  into v_enrollment_status
  from public.meal_enrollments
  where student_id = p_student_id
    and meal_slot_id = p_meal_slot_id
  for update;

  -- Lock and reread the session before using its limits.
  select *
  into v_session
  from public.offline_scan_sessions
  where id = p_session_id
  for share;

  if not found then
    raise exception 'OFFLINE_SESSION_NOT_FOUND';
  end if;

  if v_session.scanner_id <> p_scanner_id
     or v_session.device_id <> p_device_id
     or v_session.meal_slot_id <> p_meal_slot_id
     or v_session.signing_key_id <> p_signing_key_id then
    raise exception 'OFFLINE_SESSION_MISMATCH';
  end if;

  -- Return an already committed result even if the
  -- upload deadline has since passed.
  select *
  into v_receipt
  from public.offline_scan_receipts
  where scan_id = p_scan_id;

  if found then
    if v_receipt.session_id <> p_session_id
       or v_receipt.student_id <> p_student_id
       or v_receipt.token_jti <> p_token_jti
       or v_receipt.token_issued_at <> p_token_issued_at
       or v_receipt.token_expires_at <> p_token_expires_at
       or v_receipt.observed_at <> p_observed_at
       or v_receipt.request_sha256 <> p_request_sha256 then
      raise exception 'SCAN_ID_REUSED';
    end if;

    return jsonb_build_object(
      'scan_id', v_receipt.scan_id,
      'outcome', v_receipt.outcome,
      'code', v_receipt.result_code,
      'redemption_id', v_receipt.redemption_id,
      'replayed', true
    );
  end if;

  v_now := clock_timestamp();
  v_observed_epoch := extract(epoch from p_observed_at);

  -- Offline capture time is an assertion from staff's
  -- device. These checks bound it; they do not prove it.
  if v_session.revoked_at is not null then
    v_code := 'OFFLINE_SESSION_REVOKED';

  elsif v_now >= v_session.sync_deadline then
    v_code := 'OFFLINE_SYNC_DEADLINE_PASSED';

  elsif p_observed_at > v_now then
    -- Leave this pending rather than permanently rejecting
    -- a small conservative clock offset during quick sync.
    return jsonb_build_object(
      'scan_id', p_scan_id,
      'outcome', 'RETRY',
      'code', 'SCAN_TIME_AHEAD',
      'redemption_id', null,
      'replayed', false
    );

  elsif p_observed_at < v_session.capture_start
     or p_observed_at >= v_session.capture_expires_at then
    v_code := 'OUTSIDE_OFFLINE_WINDOW';

  elsif p_observed_at < v_session.serve_start
     or p_observed_at >= v_session.serve_end then
    v_code := 'OUTSIDE_SERVING_WINDOW';

  elsif v_serve_start is distinct from v_session.serve_start
     or v_serve_end is distinct from v_session.serve_end then
    v_code := 'MEAL_SCHEDULE_CHANGED';

  elsif p_token_issued_at > v_observed_epoch
     or p_token_expires_at <= v_observed_epoch then
    v_code := 'TOKEN_INVALID_AT_SCAN';

  elsif p_token_expires_at::numeric >
        extract(epoch from v_session.serve_end) then
    v_code := 'INVALID_TOKEN';

  elsif not exists (
    select 1
    from public.offline_scan_eligibility
    where session_id = p_session_id
      and student_id = p_student_id
  ) then
    v_code := 'NOT_IN_OFFLINE_ROSTER';

  elsif v_student_active is distinct from true then
    v_code := 'ACTIVE_STUDENT_REQUIRED';

  elsif v_enrollment_status is distinct from 'OPTED_IN' then
    v_code := 'NOT_OPTED_IN';
  end if;

  if v_code is null then
    select id, token_jti, scanner_id
    into
      v_redemption_id,
      v_existing_token,
      v_existing_scanner
    from public.meal_redemptions
    where student_id = p_student_id
      and meal_slot_id = p_meal_slot_id;

    if found then
      if v_existing_token = p_token_jti
         and v_existing_scanner = p_scanner_id then
        -- Reconcile an online request whose successful
        -- response may have been lost.
        v_outcome := 'CONFIRMED';
        v_code := 'CHECKIN_ALREADY_RECORDED';
      else
        v_outcome := 'CONFLICT';
        v_code := 'ALREADY_REDEEMED';
      end if;
    else
      insert into public.meal_redemptions (
        student_id,
        meal_slot_id,
        scanner_id,
        token_jti,
        redeemed_at
      )
      values (
        p_student_id,
        p_meal_slot_id,
        p_scanner_id,
        p_token_jti,
        p_observed_at
      )
      on conflict (student_id, meal_slot_id)
      do nothing
      returning id into v_redemption_id;

      if found then
        v_outcome := 'CONFIRMED';
        v_code := 'CHECKIN_ACCEPTED';

        insert into public.audit_logs (
          actor_id,
          student_id,
          meal_slot_id,
          action,
          details
        )
        values (
          p_scanner_id,
          p_student_id,
          p_meal_slot_id,
          'MEAL_REDEEMED',
          jsonb_build_object(
            'source', 'OFFLINE_SYNC',
            'redemption_id', v_redemption_id,
            'token_jti', p_token_jti,
            'scan_id', p_scan_id,
            'session_id', p_session_id,
            'device_id', p_device_id,
            'observed_at', p_observed_at,
            'received_at', v_now,
            'capture_time_source', 'DEVICE_ASSERTED'
          )
        );
      else
        -- The unique constraint remains the final guard.
        select id
        into v_redemption_id
        from public.meal_redemptions
        where student_id = p_student_id
          and meal_slot_id = p_meal_slot_id;

        v_outcome := 'CONFLICT';
        v_code := 'ALREADY_REDEEMED';
      end if;
    end if;
  end if;

  -- Receipt, redemption, and audit commit together.
  insert into public.offline_scan_receipts (
    scan_id,
    session_id,
    student_id,
    token_jti,
    token_issued_at,
    token_expires_at,
    observed_at,
    received_at,
    request_sha256,
    outcome,
    result_code,
    redemption_id
  )
  values (
    p_scan_id,
    p_session_id,
    p_student_id,
    p_token_jti,
    p_token_issued_at,
    p_token_expires_at,
    p_observed_at,
    v_now,
    p_request_sha256,
    v_outcome,
    v_code,
    v_redemption_id
  );

  return jsonb_build_object(
    'scan_id', p_scan_id,
    'outcome', v_outcome,
    'code', v_code,
    'redemption_id', v_redemption_id,
    'replayed', false
  );
end;
$$;

revoke execute
on function public.sync_verified_offline_scan(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint,
  text,
  timestamptz,
  text
)
from public, anon, authenticated;

grant execute
on function public.sync_verified_offline_scan(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint,
  text,
  timestamptz,
  text
)
to service_role;

notify pgrst, 'reload schema';

commit;