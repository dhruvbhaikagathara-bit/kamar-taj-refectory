CREATE OR REPLACE FUNCTION public.get_my_monthly_rebates(
  p_month text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_student_id uuid;
  v_start date;
  v_end date;
  v_result jsonb;
BEGIN
  v_student_id := auth.uid();

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = v_student_id
      AND role = 'STUDENT'
      AND account_status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'ACTIVE_STUDENT_REQUIRED';
  END IF;

  IF p_month IS NULL
     OR p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'INVALID_MONTH';
  END IF;

  v_start := (p_month || '-01')::date;
  v_end := (v_start + INTERVAL '1 month')::date;

  WITH matching AS (
    SELECT
      l.id,
      l.kind,
      l.delta_paise,
      l.created_at,
      m.meal_date,
      m.meal_type,
      m.menu
    FROM public.rebate_ledger AS l
    JOIN public.meal_slots AS m
      ON m.id = l.meal_slot_id
    WHERE l.student_id = v_student_id
      AND m.meal_date >= v_start
      AND m.meal_date < v_end
  ),
  recent AS (
    SELECT *
    FROM matching
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  )
  SELECT jsonb_build_object(
    'month', p_month,

    'total_credit_paise',
      COALESCE(
        SUM(delta_paise::bigint)
          FILTER (WHERE kind = 'CREDIT'),
        0
      )::text,

    'total_reversal_paise',
      COALESCE(
        SUM(-(delta_paise::bigint))
          FILTER (WHERE kind = 'REVERSAL'),
        0
      )::text,

    'net_rebate_paise',
      COALESCE(SUM(delta_paise::bigint), 0)::text,

    'transaction_count', COUNT(*),

    'transactions',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', r.id,
              'kind', r.kind,
              'delta_paise', r.delta_paise::text,
              'created_at', r.created_at,
              'meal_date', r.meal_date,
              'meal_type', r.meal_type,
              'menu', r.menu
            )
            ORDER BY r.created_at DESC, r.id DESC
          )
          FROM recent AS r
        ),
        '[]'::jsonb
      )
  )
  INTO v_result
  FROM matching;

  RETURN v_result;
END;
$$;

REVOKE ALL
ON FUNCTION public.get_my_monthly_rebates(text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.get_my_monthly_rebates(text)
TO authenticated;