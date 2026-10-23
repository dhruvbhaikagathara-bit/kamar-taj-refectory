-- Allow signed-in users to attempt inserting these meal fields.
-- The RLS policy below restricts successful inserts to active admins.
grant insert (
  meal_date,
  meal_type,
  menu,
  cutoff_at,
  serve_start,
  serve_end,
  price_paise
)
on public.meal_slots
to authenticated;

-- Only an active ADMIN can create a meal slot.
create policy "meal_slots_insert_active_admin"
on public.meal_slots
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.role = 'ADMIN'
      and p.account_status = 'ACTIVE'
  )
);