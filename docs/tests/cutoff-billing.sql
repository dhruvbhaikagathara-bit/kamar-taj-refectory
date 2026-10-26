begin;

-- Create three temporary meals and select the test student.
do $$
declare
  v_student uuid;
  v_meal uuid;
  v_day date :=
    (now() at time zone 'Asia/Kolkata')::date + 1;
  i integer;
begin
  select p.id
  into v_student
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(u.email) = 'student1@example.com'
    and p.role = 'STUDENT'
    and p.account_status = 'ACTIVE';

  if v_student is null then
    raise exception 'Active student1@example.com account not found';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    v_student::text,
    true
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_student,
      'role', 'authenticated'
    )::text,
    true
  );

  for i in 1..3 loop
    while exists (
      select 1
      from public.meal_slots
      where meal_date = v_day
        and meal_type = 'BREAKFAST'
    ) loop
      v_day := v_day + 1;
    end loop;

    insert into public.meal_slots (
      meal_date,
      meal_type,
      menu,
      cutoff_at,
      serve_start,
      serve_end,
      price_paise
    )
    values (
      v_day,
      'BREAKFAST',
      'Temporary cutoff test ' || i,
      (v_day + time '07:00') at time zone 'Asia/Kolkata',
      (v_day + time '08:00') at time zone 'Asia/Kolkata',
      (v_day + time '09:00') at time zone 'Asia/Kolkata',
      5000
    )
    returning id into v_meal;

    perform set_config(
      'test.cutoff_meal_' || i,
      v_meal::text,
      true
    );

    v_day := v_day + 1;
  end loop;
end;
$$;

-- Use the same database role as a signed-in app user.
set local role authenticated;

do $$
declare
  v_meal uuid;
  i integer;
begin
  -- Initially enroll in all three meals.
  for i in 1..3 loop
    v_meal :=
      current_setting('test.cutoff_meal_' || i)::uuid;

    perform public.set_my_meal_choice(
      v_meal,
      'OPTED_IN'
    );
  end loop;

  -- Meal 1: valid cancellation before cutoff.
  perform public.set_my_meal_choice(
    current_setting('test.cutoff_meal_1')::uuid,
    'OPTED_OUT'
  );

  -- Meal 3: cancel now, then attempt to rejoin after cutoff.
  perform public.set_my_meal_choice(
    current_setting('test.cutoff_meal_3')::uuid,
    'OPTED_OUT'
  );
end;
$$;

reset role;

-- Move ONLY the two temporary test meals past cutoff.
-- This avoids waiting for real time to pass.
do $$
declare
  v_meal uuid;
  v_audit_count bigint;
  i integer;
begin
  for i in 2..3 loop
    v_meal :=
      current_setting('test.cutoff_meal_' || i)::uuid;

    select count(*)
    into v_audit_count
    from public.audit_logs
    where meal_slot_id = v_meal;

    perform set_config(
      'test.cutoff_audit_' || i,
      v_audit_count::text,
      true
    );

    update public.meal_slots
    set cutoff_at = clock_timestamp() - interval '1 second'
    where id = v_meal;
  end loop;
end;
$$;

set local role authenticated;

-- Attempt the two forbidden changes.
do $$
declare
  v_meal uuid;
  v_status text;
  v_rejected boolean;
  i integer;
begin
  for i in 2..3 loop
    v_meal :=
      current_setting('test.cutoff_meal_' || i)::uuid;

    v_status := case
      when i = 2 then 'OPTED_OUT'
      else 'OPTED_IN'
    end;

    v_rejected := false;

    begin
      perform public.set_my_meal_choice(
        v_meal,
        v_status
      );
    exception
      when others then
        if position('CUTOFF_PASSED' in sqlerrm) > 0 then
          v_rejected := true;
        else
          -- An unrelated error must not count as a pass.
          raise;
        end if;
    end;

    if not v_rejected then
      raise exception
        'FAIL: meal % accepted a change after cutoff',
        i;
    end if;
  end loop;
end;
$$;

reset role;

-- Verify the actual stored enrollment and financial records.
do $$
declare
  v_meal uuid;
  v_status text;
  v_expected_status text;

  v_ledger_count bigint;
  v_rebate bigint;
  v_expected_rebate bigint;

  v_charge_count bigint;
  v_base bigint;

  v_audit_count bigint;
  i integer;
begin
  for i in 1..3 loop
    v_meal :=
      current_setting('test.cutoff_meal_' || i)::uuid;

    v_expected_status := case
      when i = 2 then 'OPTED_IN'
      else 'OPTED_OUT'
    end;

    v_expected_rebate := case
      when i = 2 then 0
      else 5000
    end;

    select e.status
    into v_status
    from public.meal_enrollments e
    where e.student_id = auth.uid()
      and e.meal_slot_id = v_meal;

    if v_status is distinct from v_expected_status then
      raise exception
        'FAIL: incorrect enrollment status for meal %',
        i;
    end if;

    select count(*), coalesce(sum(delta_paise), 0)
    into v_ledger_count, v_rebate
    from public.rebate_ledger
    where student_id = auth.uid()
      and meal_slot_id = v_meal;

    if v_rebate <> v_expected_rebate then
      raise exception
        'FAIL: incorrect rebate balance for meal %',
        i;
    end if;

    if v_ledger_count <> (
      case when i = 2 then 0 else 1 end
    ) then
      raise exception
        'FAIL: unexpected rebate posting for meal %',
        i;
    end if;

    select count(*), coalesce(sum(amount_paise), 0)
    into v_charge_count, v_base
    from public.meal_charges
    where student_id = auth.uid()
      and meal_slot_id = v_meal;

    if v_charge_count <> 1 or v_base <> 5000 then
      raise exception
        'FAIL: base charge changed for meal %',
        i;
    end if;

    if i >= 2 then
      select count(*)
      into v_audit_count
      from public.audit_logs
      where meal_slot_id = v_meal;

      if v_audit_count <> current_setting(
        'test.cutoff_audit_' || i
      )::bigint then
        raise exception
          'FAIL: rejected choice left an audit entry for meal %',
          i;
      end if;
    end if;
  end loop;
end;
$$;

select
  'PASS: before-cutoff cancellation earns one credit'
    as before_cutoff,
  'PASS: late cancellation rejected without changes'
    as late_cancellation,
  'PASS: late re-enrollment rejected without changes'
    as late_reenrollment;

-- Remove all temporary meals and their test records.
rollback;