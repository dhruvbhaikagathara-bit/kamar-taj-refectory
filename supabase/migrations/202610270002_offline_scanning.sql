begin;

-- An offline session belongs to one scanner, device,
-- and meal. The server creates it after checking access.
create table public.offline_scan_sessions (
  id uuid primary key default gen_random_uuid(),

  scanner_id uuid not null
    references public.profiles(id),

  device_id uuid not null,

  meal_slot_id uuid not null
    references public.meal_slots(id),

  signing_key_id text not null
    check (char_length(signing_key_id) between 1 and 80),

  prepared_at timestamptz not null
    default clock_timestamp(),

  -- Snapshot of the serving window at preparation time.
  serve_start timestamptz not null,
  serve_end timestamptz not null,

  -- Period during which offline scans may be captured.
  capture_start timestamptz not null,
  capture_expires_at timestamptz not null,

  -- Deadline for uploading queued scans.
  sync_deadline timestamptz not null,

  revoked_at timestamptz,

  check (serve_end > serve_start),

  check (capture_start >= prepared_at),

  check (capture_start >= serve_start),

  check (capture_expires_at > capture_start),

  check (capture_expires_at <= serve_end),

  -- First version permits at most 15 minutes offline
  -- per preparation session.
  check (
    capture_expires_at <=
    capture_start + interval '15 minutes'
  ),

  check (sync_deadline >= capture_expires_at),

  check (
    sync_deadline <=
    capture_expires_at + interval '24 hours'
  ),

  check (
    revoked_at is null
    or revoked_at >= prepared_at
  )
);

create index offline_scan_sessions_scanner
on public.offline_scan_sessions(
  scanner_id,
  meal_slot_id,
  prepared_at desc
);

-- Students eligible when the server prepared this session.
-- Students already redeemed will be excluded by the
-- preparation operation.
create table public.offline_scan_eligibility (
  session_id uuid not null
    references public.offline_scan_sessions(id),

  student_id uuid not null
    references public.profiles(id),

  primary key (session_id, student_id)
);

-- Final server results for uploaded offline scans.
-- Pending scans remain in the browser's IndexedDB.
create table public.offline_scan_receipts (
  scan_id uuid primary key,

  session_id uuid not null
    references public.offline_scan_sessions(id),

  student_id uuid not null
    references public.profiles(id),

  token_jti uuid not null,

  token_issued_at bigint not null,
  token_expires_at bigint not null,

  -- Browser-reported time, not independently proven time.
  observed_at timestamptz not null,

  received_at timestamptz not null
    default clock_timestamp(),

  -- Used to detect reuse of a scan ID with different data.
  request_sha256 text not null
    check (request_sha256 ~ '^[0-9a-f]{64}$'),

  outcome text not null
    check (
      outcome in ('CONFIRMED', 'CONFLICT', 'REJECTED')
    ),

  result_code text not null
    check (char_length(result_code) between 1 and 100),

  redemption_id uuid
    references public.meal_redemptions(id),

  check (token_issued_at >= 0),

  check (
    token_expires_at::numeric >
    token_issued_at::numeric
  ),

  check (
    token_expires_at::numeric -
    token_issued_at::numeric <= 30
  ),

  check (
    outcome <> 'CONFIRMED'
    or redemption_id is not null
  )
);

create index offline_scan_receipts_session
on public.offline_scan_receipts(
  session_id,
  received_at
);

create index offline_scan_receipts_token
on public.offline_scan_receipts(token_jti);

-- All three tables are server-managed.
alter table public.offline_scan_sessions
enable row level security;

alter table public.offline_scan_eligibility
enable row level security;

alter table public.offline_scan_receipts
enable row level security;

-- Browsers cannot directly read or write these tables.
revoke all
on public.offline_scan_sessions,
   public.offline_scan_eligibility,
   public.offline_scan_receipts
from public, anon, authenticated;

-- Trusted backend access only.
grant select, insert, update
on public.offline_scan_sessions
to service_role;

grant select, insert
on public.offline_scan_eligibility
to service_role;

grant select, insert
on public.offline_scan_receipts
to service_role;

-- Your existing redemption function accepts trusted
-- server arguments, so restrict execution accordingly.
revoke execute
on function public.redeem_verified_meal(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint
)
from public, anon, authenticated;

grant execute
on function public.redeem_verified_meal(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint
)
to service_role;

notify pgrst, 'reload schema';

commit;