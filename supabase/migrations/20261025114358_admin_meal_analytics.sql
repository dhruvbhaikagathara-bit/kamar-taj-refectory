CREATE INDEX IF NOT EXISTS meal_enrollments_slot_idx
ON public.meal_enrollments (meal_slot_id);

CREATE INDEX IF NOT EXISTS meal_redemptions_slot_idx
ON public.meal_redemptions (meal_slot_id);

CREATE OR REPLACE FUNCTION public.get_admin_meal_analytics(
  p_meal_date date
)
RETURNS TABLE (
  id uuid,
  meal_type text,
  menu text,
  cutoff_at timestamptz,
  serve_start timestamptz,
  serve_end timestamptz,
  expected_count bigint,
  collected_count bigint,
  opted_out_count bigint,
  vegetarian_count bigint,
  nonvegetarian_count bigint,
  vegan_count bigint,
  jain_count bigint,
  unspecified_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = auth.uid()
      AND p.role = 'ADMIN'
      AND p.account_status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'ACTIVE_ADMIN_REQUIRED';
  END IF;

  IF p_meal_date IS NULL
     OR p_meal_date < DATE '2000-01-01'
     OR p_meal_date > DATE '2099-12-31' THEN
    RAISE EXCEPTION 'INVALID_DATE';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.meal_type,
    m.menu,
    m.cutoff_at,
    m.serve_start,
    m.serve_end,
    e.expected_count,
    r.collected_count,
    e.opted_out_count,
    e.vegetarian_count,
    e.nonvegetarian_count,
    e.vegan_count,
    e.jain_count,
    e.unspecified_count
  FROM public.meal_slots AS m
  CROSS JOIN LATERAL (
    SELECT
      COUNT(*) FILTER (
        WHERE en.status = 'OPTED_IN'
      ) AS expected_count,

      COUNT(*) FILTER (
        WHERE en.status = 'OPTED_OUT'
      ) AS opted_out_count,

      COUNT(*) FILTER (
        WHERE en.status = 'OPTED_IN'
          AND d.preference = 'VEGETARIAN'
      ) AS vegetarian_count,

      COUNT(*) FILTER (
        WHERE en.status = 'OPTED_IN'
          AND d.preference = 'NON_VEGETARIAN'
      ) AS nonvegetarian_count,

      COUNT(*) FILTER (
        WHERE en.status = 'OPTED_IN'
          AND d.preference = 'VEGAN'
      ) AS vegan_count,

      COUNT(*) FILTER (
        WHERE en.status = 'OPTED_IN'
          AND d.preference = 'JAIN'
      ) AS jain_count,

      COUNT(*) FILTER (
        WHERE en.status = 'OPTED_IN'
          AND d.preference IS NULL
      ) AS unspecified_count

    FROM public.meal_enrollments AS en
    JOIN public.profiles AS p
      ON p.id = en.student_id
     AND p.role = 'STUDENT'
     AND p.account_status = 'ACTIVE'
    LEFT JOIN public.dietary_preferences AS d
      ON d.student_id = en.student_id
    WHERE en.meal_slot_id = m.id
  ) AS e
  CROSS JOIN LATERAL (
    SELECT COUNT(*) AS collected_count
    FROM public.meal_redemptions AS mr
    WHERE mr.meal_slot_id = m.id
  ) AS r
  WHERE m.meal_date = p_meal_date
  ORDER BY m.serve_start;
END;
$$;

REVOKE ALL
ON FUNCTION public.get_admin_meal_analytics(date)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.get_admin_meal_analytics(date)
TO authenticated;