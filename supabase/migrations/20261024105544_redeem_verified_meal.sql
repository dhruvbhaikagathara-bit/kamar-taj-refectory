create or replace function public.redeem_verified_meal(
  p_scanner_id uuid,
  p_student_id uuid,
  p_meal_slot_id uuid,
  p_token_jti uuid,
  p_token_issued_at bigint,
  p_token_expires_at bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_name text;
  v_serve_start timestamptz;
  v_serve_end timestamptz;
  v_enrollment_status text;
  v_now timestamptz;
  v_now_epoch numeric;
  v_redemption_id uuid;
begin
  -- These arguments must come from the trusted server,
  -- after it verifies the scanner session and QR signature.
  if p_scanner_id is null
     or p_student_id is null
     or p_meal_slot_id is null
     or p_token_jti is null
     or p_token_issued_at is null
     or p_token_expires_at is null then
    raise exception 'INVALID_TOKEN';
  end if;

  if p_token_issued_at < 0
     or p_token_expires_at <= p_token_issued_at
     or (
       p_token_expires_at::numeric
       - p_token_issued_at::numeric
     ) > 30 then
    raise exception 'INVALID_TOKEN';
  end if;

  -- Match the student-profile -> meal -> enrollment lock order
  -- used by enrollment changes.
  select full_name
  into v_student_name
  from public.profiles
  where id = p_student_id
    and role = 'STUDENT'
    and account_status = 'ACTIVE'
  for update;

  if not found then
    raise exception 'ACTIVE_STUDENT_REQUIRED';
  end if;

  -- Keep scanner authorization stable during this operation.
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

  if not found then
    raise exception 'NOT_OPTED_IN';
  end if;

  if v_enrollment_status <> 'OPTED_IN' then
    raise exception 'NOT_OPTED_IN';
  end if;

  -- Evaluate time AFTER acquiring all required locks.
  v_now := clock_timestamp();
  v_now_epoch := extract(epoch from v_now);

  if p_token_issued_at > v_now_epoch then
    raise exception 'INVALID_TOKEN';
  end if;

  if p_token_expires_at <= v_now_epoch then
    raise exception 'TOKEN_EXPIRED';
  end if;

  if v_now < v_serve_start then
    raise exception 'SERVING_NOT_STARTED';
  end if;

  if v_now >= v_serve_end then
    raise exception 'SERVING_WINDOW_CLOSED';
  end if;

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
    v_now
  )
  on conflict (student_id, meal_slot_id) do nothing
  returning id into v_redemption_id;

  if not found then
    raise exception 'ALREADY_REDEEMED';
  end if;

  -- The redemption and audit entry succeed or fail together.
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
      'redemption_id', v_redemption_id,
      'token_jti', p_token_jti
    )
  );

  return jsonb_build_object(
    'code', 'CHECKIN_ACCEPTED',
    'redemption_id', v_redemption_id,
    'student_name', v_student_name,
    'meal_slot_id', p_meal_slot_id,
    'redeemed_at', v_now
  );
end;
$$;

-- Browser clients must never call this function directly.
revoke execute
on function public.redeem_verified_meal(
  uuid, uuid, uuid, uuid, bigint, bigint
)
from public, anon, authenticated, service_role;

-- Only the trusted backend can submit verified token claims.
grant execute
on function public.redeem_verified_meal(
  uuid, uuid, uuid, uuid, bigint, bigint
)
to service_role;