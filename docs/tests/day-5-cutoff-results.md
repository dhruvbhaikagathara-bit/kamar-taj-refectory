# Cutoff and billing regression test

Test date: 2026-10-26
Environment: Supabase SQL Editor
Script: docs/tests/cutoff-billing.sql

Results:
- PASS: cancellation before cutoff creates one ₹50 credit.
- PASS: cancellation after cutoff is rejected.
- PASS: re-enrollment after cutoff is rejected.
- PASS: rejected changes preserve enrollment, base charges and rebates.
- PASS: rejected changes leave no additional audit entries.

Scope:
Tests before-cutoff and past-cutoff behavior.
Exact-instant cutoff and concurrent requests are separate tests.

All temporary test data was rolled back.