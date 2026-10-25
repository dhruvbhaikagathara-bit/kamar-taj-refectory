-- Speed up balance checks for one student and meal.
CREATE INDEX IF NOT EXISTS rebate_ledger_student_meal_idx
ON public.rebate_ledger (student_id, meal_slot_id);

-- Clients can read their permitted ledger rows through existing RLS,
-- but must not write financial entries directly.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.rebate_ledger
FROM anon, authenticated;

-- Automatically post credits/reversals when an existing
-- enrollment changes status.
CREATE OR REPLACE FUNCTION public.post_meal_choice_rebate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid;
  v_price_paise integer;
  v_cutoff_at timestamptz;
  v_meal_date date;
  v_net_credit bigint;
  v_delta_paise integer;
  v_kind text;
  v_action text;
  v_event_id uuid;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  v_actor_id := auth.uid();

  IF v_actor_id IS NULL
     OR v_actor_id <> NEW.student_id THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_actor_id
      AND role = 'STUDENT'
      AND account_status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'ACTIVE_STUDENT_REQUIRED';
  END IF;

  SELECT price_paise, cutoff_at, meal_date
  INTO v_price_paise, v_cutoff_at, v_meal_date
  FROM public.meal_slots
  WHERE id = NEW.meal_slot_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEAL_NOT_FOUND';
  END IF;

  -- Check database time after acquiring the meal lock.
  IF clock_timestamp() >= v_cutoff_at THEN
    RAISE EXCEPTION 'CUTOFF_PASSED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.meal_redemptions
    WHERE student_id = NEW.student_id
      AND meal_slot_id = NEW.meal_slot_id
  ) THEN
    RAISE EXCEPTION 'ALREADY_REDEEMED';
  END IF;

  -- The enrollment update holds its row lock.
  -- Our existing meal-choice RPC also serializes this student's changes.
  SELECT COALESCE(SUM(delta_paise), 0)
  INTO v_net_credit
  FROM public.rebate_ledger
  WHERE student_id = NEW.student_id
    AND meal_slot_id = NEW.meal_slot_id;

  IF v_net_credit < 0
     OR v_net_credit > 2147483647 THEN
    RAISE EXCEPTION 'REBATE_BALANCE_INVALID';
  END IF;

  IF OLD.status = 'OPTED_IN'
     AND NEW.status = 'OPTED_OUT' THEN

    -- An enrolled meal must not already have an outstanding rebate.
    IF v_net_credit <> 0 THEN
      RAISE EXCEPTION 'REBATE_BALANCE_INVALID';
    END IF;

    -- Free meals do not need a financial posting.
    IF v_price_paise = 0 THEN
      RETURN NEW;
    END IF;

    v_delta_paise := v_price_paise;
    v_kind := 'CREDIT';
    v_action := 'REBATE_CREDIT_POSTED';

  ELSIF OLD.status = 'OPTED_OUT'
        AND NEW.status = 'OPTED_IN' THEN

    -- A first opt-out or an older cancellation may have no credit.
    IF v_net_credit = 0 THEN
      RETURN NEW;
    END IF;

    -- Reverse the actual outstanding credit, not today's meal price.
    v_delta_paise := -(v_net_credit::integer);
    v_kind := 'REVERSAL';
    v_action := 'REBATE_REVERSAL_POSTED';

  ELSE
    RAISE EXCEPTION 'INVALID_ENROLLMENT_TRANSITION';
  END IF;

  -- Each posting has its own auditable source event.
  INSERT INTO public.audit_logs (
    actor_id,
    student_id,
    meal_slot_id,
    action,
    details
  )
  VALUES (
    v_actor_id,
    NEW.student_id,
    NEW.meal_slot_id,
    v_action,
    jsonb_build_object(
      'policy', 'FULL_MEAL_PRICE_V1',
      'previous_status', OLD.status,
      'new_status', NEW.status,
      'delta_paise', v_delta_paise,
      'meal_date', v_meal_date
    )
  )
  RETURNING id INTO v_event_id;

  INSERT INTO public.rebate_ledger (
    student_id,
    meal_slot_id,
    source_event_id,
    kind,
    delta_paise
  )
  VALUES (
    NEW.student_id,
    NEW.meal_slot_id,
    v_event_id,
    v_kind,
    v_delta_paise
  );

  RETURN NEW;
END;
$$;

-- Called automatically by the trigger, not directly through the API.
REVOKE ALL
ON FUNCTION public.post_meal_choice_rebate()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER meal_enrollment_rebate_posting
AFTER UPDATE OF status
ON public.meal_enrollments
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.post_meal_choice_rebate();

-- Preserve financial history: corrections must be new ledger entries.
CREATE OR REPLACE FUNCTION public.prevent_rebate_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION
    'REBATE_LEDGER_APPEND_ONLY: use a new correcting entry';
END;
$$;

REVOKE ALL
ON FUNCTION public.prevent_rebate_ledger_mutation()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER rebate_ledger_append_only
BEFORE UPDATE OR DELETE
ON public.rebate_ledger
FOR EACH ROW
EXECUTE FUNCTION public.prevent_rebate_ledger_mutation();