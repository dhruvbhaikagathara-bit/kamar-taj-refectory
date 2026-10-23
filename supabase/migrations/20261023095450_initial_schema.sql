-- 1. USER PROFILES
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  hostel text,
  role text not null default 'STUDENT'
    check (role in ('STUDENT', 'ADMIN', 'SCANNER_STAFF')),
  account_status text not null default 'ACTIVE'
    check (account_status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now()
);

-- 2. MEAL SLOTS
create table public.meal_slots (
  id uuid primary key default gen_random_uuid(),
  meal_date date not null,
  meal_type text not null
    check (meal_type in ('BREAKFAST', 'LUNCH', 'DINNER')),
  menu text not null default '',
  cutoff_at timestamptz not null,
  serve_start timestamptz not null,
  serve_end timestamptz not null,
  price_paise integer not null check (price_paise >= 0),
  created_at timestamptz not null default now(),

  constraint valid_meal_times
    check (cutoff_at <= serve_start and serve_start < serve_end),

  constraint one_meal_type_per_day
    unique (meal_date, meal_type)
);

-- 3. STUDENT MEAL ENROLLMENTS
create table public.meal_enrollments (
  student_id uuid not null references public.profiles(id),
  meal_slot_id uuid not null references public.meal_slots(id),
  status text not null default 'OPTED_IN'
    check (status in ('OPTED_IN', 'OPTED_OUT')),
  updated_at timestamptz not null default now(),

  primary key (student_id, meal_slot_id)
);

-- 4. DIETARY PREFERENCES
create table public.dietary_preferences (
  student_id uuid primary key references public.profiles(id),
  preference text not null default 'VEGETARIAN'
    check (
      preference in (
        'VEGETARIAN',
        'NON_VEGETARIAN',
        'VEGAN',
        'JAIN'
      )
    ),
  notes text not null default '',
  updated_at timestamptz not null default now()
);

-- 5. SUCCESSFUL MEAL CHECK-INS
create table public.meal_redemptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  meal_slot_id uuid not null,
  scanner_id uuid not null references public.profiles(id),
  token_jti uuid not null,
  redeemed_at timestamptz not null default now(),

  constraint redemption_requires_enrollment
    foreign key (student_id, meal_slot_id)
    references public.meal_enrollments(student_id, meal_slot_id),

  constraint one_redemption_per_student_meal
    unique (student_id, meal_slot_id)
);

-- 6. AUDIT HISTORY
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  student_id uuid references public.profiles(id),
  meal_slot_id uuid references public.meal_slots(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 7. REBATE LEDGER
-- Positive delta = credit. Negative delta = reversal.
create table public.rebate_ledger (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  meal_slot_id uuid not null,
  source_event_id uuid not null unique
    references public.audit_logs(id),
  kind text not null check (kind in ('CREDIT', 'REVERSAL')),
  delta_paise integer not null,
  created_at timestamptz not null default now(),

  constraint rebate_requires_enrollment
    foreign key (student_id, meal_slot_id)
    references public.meal_enrollments(student_id, meal_slot_id),

  constraint valid_ledger_amount
    check (
      (kind = 'CREDIT' and delta_paise > 0)
      or
      (kind = 'REVERSAL' and delta_paise < 0)
    )
);

-- INDEXES FOR COMMON QUERIES
create index enrollment_meal_status_idx
  on public.meal_enrollments (meal_slot_id, status);

create index redemption_meal_time_idx
  on public.meal_redemptions (meal_slot_id, redeemed_at);

create index rebate_student_time_idx
  on public.rebate_ledger (student_id, created_at);

create index audit_meal_time_idx
  on public.audit_logs (meal_slot_id, created_at);

-- ENABLE ROW LEVEL SECURITY
alter table public.profiles enable row level security;
alter table public.meal_slots enable row level security;
alter table public.meal_enrollments enable row level security;
alter table public.dietary_preferences enable row level security;
alter table public.meal_redemptions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rebate_ledger enable row level security;

-- REMOVE DIRECT CLIENT PERMISSIONS, THEN GRANT READ ACCESS
revoke all on table
  public.profiles,
  public.meal_slots,
  public.meal_enrollments,
  public.dietary_preferences,
  public.meal_redemptions,
  public.audit_logs,
  public.rebate_ledger
from anon, authenticated;

grant select on table
  public.profiles,
  public.meal_slots,
  public.meal_enrollments,
  public.dietary_preferences,
  public.meal_redemptions,
  public.audit_logs,
  public.rebate_ledger
to authenticated;

-- ROW LEVEL READ POLICIES
create policy "Read own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "Signed in users read meal slots"
on public.meal_slots for select to authenticated
using (true);

create policy "Read own enrollments"
on public.meal_enrollments for select to authenticated
using (student_id = (select auth.uid()));

create policy "Read own dietary preferences"
on public.dietary_preferences for select to authenticated
using (student_id = (select auth.uid()));

create policy "Read own redemptions"
on public.meal_redemptions for select to authenticated
using (student_id = (select auth.uid()));

create policy "Read own audit history"
on public.audit_logs for select to authenticated
using (student_id = (select auth.uid()));

create policy "Read own rebate ledger"
on public.rebate_ledger for select to authenticated
using (student_id = (select auth.uid()));

-- CREATE A STUDENT PROFILE WHEN A USER SIGNS UP
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'STUDENT'
  );

  return new;
end;
$$;

revoke execute on function public.handle_new_user()
from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- CREATE PROFILES FOR USERS WHO SIGNED UP BEFORE THIS MIGRATION
insert into public.profiles (id, full_name, role)
select
  id,
  coalesce(raw_user_meta_data ->> 'full_name', ''),
  'STUDENT'
from auth.users
on conflict (id) do nothing;    