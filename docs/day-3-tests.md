# Day 3 — QR and check-in tests

Updated: 25 October 2026

| Check | Observed result |
|---|---|
| Valid pass submitted manually | Accepted |
| Duplicate submission | Already redeemed |
| Expired token | Rejected |
| Modified signature | Invalid token |
| 50 parallel requests from one browser | 1 accepted, 49 already redeemed |
| Database after parallel requests | One redemption for the student and meal |
| Phone displaying live QR, laptop camera scanning | Accepted |
| Opted-out student requests QR | NOT_OPTED_IN; no token issued |
| Valid token submitted with a different meal ID | WRONG_MEAL |
| Direct redemption function permissions | anon/authenticated denied; service_role allowed |

Development network access was configured with allowedDevOrigins.

Deployment and scanning with a phone's camera over HTTPS remain to be tested.