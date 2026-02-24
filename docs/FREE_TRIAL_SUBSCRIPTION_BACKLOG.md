# Free Trial + Subscription Backlog

## Goal
Ship a secure free-trial + paid-subscription gate for OpenClaw Desktop (Windows flow), so users can sign in, start a trial, and must have an active entitlement to continue after trial expiry.

## Scope
- Auth + billing source of truth lives in `auth-web`.
- Desktop app enforces entitlement before key actions.
- Polar powers subscription billing.
- Clerk remains identity provider.

## Non-goals (MVP)
- Team/org billing.
- Multiple plans.
- In-app card management UI beyond "Open billing portal".

## Product Rules (MVP)
- Trial length: 7 days.
- Trial starts on first successful desktop sign-in handoff.
- Entitled states:
  - `trial_active`
  - `active_subscription`
  - `grace_period`
- Blocked states:
  - `trial_ended`
  - `past_due`
  - `canceled`
  - `blocked`
- Grace period: 3 days after payment failure.

## Architecture
- Identity: Clerk user ID (`clerk_user_id`).
- Billing: Polar checkout + webhooks.
- Persistence: Postgres table(s) in `auth-web` backend.
- Enforcement:
  - Server-side entitlement API is source of truth.
  - Desktop UI blocks actions.
  - Main-process IPC adds guardrails for key commands.

## Data Model
Create these tables in the billing database:

1. `users`
- `id` (uuid pk)
- `clerk_user_id` (text unique not null)
- `email` (text)
- `created_at`, `updated_at`

2. `entitlements`
- `id` (uuid pk)
- `user_id` (uuid fk users.id unique not null)
- `state` (text not null)
- `trial_start_at` (timestamptz)
- `trial_end_at` (timestamptz)
- `current_period_end_at` (timestamptz)
- `grace_end_at` (timestamptz)
- `provider` (text default `polar`)
- `provider_customer_id` (text)
- `provider_subscription_id` (text)
- `last_event_at` (timestamptz)
- `updated_at` (timestamptz)

3. `billing_events`
- `id` (uuid pk)
- `provider` (text not null)
- `provider_event_id` (text unique not null)
- `event_type` (text not null)
- `payload_json` (jsonb not null)
- `received_at` (timestamptz)
- `processed_at` (timestamptz)
- `status` (text)
- `error` (text)

## API Contract (auth-web)
Add routes:

1. `GET /api/billing/status`
- Auth required.
- Returns:
```json
{
  "ok": true,
  "state": "trial_active",
  "entitled": true,
  "trialDaysLeft": 5,
  "trialEndAt": "2026-03-01T12:00:00.000Z",
  "graceEndAt": null,
  "currentPeriodEndAt": null,
  "manageUrl": null,
  "checkoutRequired": false
}
```

2. `POST /api/billing/checkout`
- Auth required.
- Creates checkout session/link in Polar for current user.
- Returns `checkoutUrl`.

3. `POST /api/billing/portal`
- Auth required.
- Returns Polar customer portal URL for the user.

4. `POST /api/billing/webhook`
- Public endpoint with signature verification.
- Upserts entitlement state from subscription lifecycle events.
- Idempotent by `provider_event_id`.

## Repo Task Breakdown

### Phase 0: Foundation (1-2 days)
- [ ] Add billing env vars to `auth-web/.env.example`:
  - `DATABASE_URL`
  - `POLAR_API_KEY`
  - `POLAR_WEBHOOK_SECRET`
  - `BILLING_TRIAL_DAYS=7`
  - `BILLING_GRACE_DAYS=3`
  - `BILLING_GATE_ENABLED=true`
- [ ] Add DB client module `auth-web/app/lib/billing/db.ts`.
- [ ] Add entitlement domain helpers:
  - `auth-web/app/lib/billing/types.ts`
  - `auth-web/app/lib/billing/entitlement-service.ts`
- [ ] Add migration SQL under `auth-web/db/migrations/`.

Acceptance:
- [ ] Can query/create user and entitlement records locally.
- [ ] Trial calculations work from server clock.

### Phase 1: Billing APIs (2-3 days)
- [ ] Implement `auth-web/app/api/billing/status/route.ts`.
- [ ] Implement `auth-web/app/api/billing/checkout/route.ts`.
- [ ] Implement `auth-web/app/api/billing/portal/route.ts`.
- [ ] Implement Polar client util `auth-web/app/lib/billing/polar.ts`.
- [ ] Add request auth guard helper using Clerk user in `auth-web/app/lib/billing/auth.ts`.

Acceptance:
- [ ] Signed-in user gets deterministic status JSON.
- [ ] Checkout URL creation works for signed-in user.
- [ ] Portal URL endpoint works for existing customer.

### Phase 2: Webhook + Entitlement Sync (2-3 days)
- [ ] Implement `auth-web/app/api/billing/webhook/route.ts`.
- [ ] Verify webhook signatures.
- [ ] Store incoming event in `billing_events`.
- [ ] Idempotency check on `provider_event_id`.
- [ ] Map provider events to entitlement state transitions.
- [ ] Update `entitlements.last_event_at` and period/grace dates.

Acceptance:
- [ ] Replayed webhook does not duplicate side effects.
- [ ] Subscription activate/cancel/payment-failed transitions update state correctly.

### Phase 3: Desktop Integration (2-4 days)
- [ ] Extend types in `src/shared/types.ts`:
  - `BillingStatus`
  - `BillingState`
- [ ] Add billing IPC handlers in `src/main/main.ts`:
  - `billing:get-status`
  - `billing:create-checkout`
  - `billing:create-portal`
- [ ] Expose preload APIs in `src/preload/preload.ts`.
- [ ] Add renderer client calls and UI state in `src/renderer-react/src/App.tsx`.
- [ ] Add blocking paywall view in desktop onboarding:
  - show trial days left
  - button: `Start subscription`
  - button: `Manage billing`
  - button: `Refresh access`

Acceptance:
- [ ] Expired user cannot proceed to onboarding completion/chat/control.
- [ ] Active subscription unlocks flow without restart.
- [ ] Trial countdown is visible and accurate.

### Phase 4: Guardrails in Main Process (1-2 days)
- [ ] Add entitlement check before sensitive handlers in `src/main/main.ts`:
  - `setup:run-guided`
  - `setup:complete-onboarding`
  - `gateway:start`
  - `gateway:start-stream`
- [ ] Return explicit error payload when blocked.

Acceptance:
- [ ] UI bypass attempts via renderer console still blocked.

### Phase 5: Website Alignment (1 day)
- [ ] Update `website/src/App.jsx` copy to match trial/subscription truth.
- [ ] Decide one source for checkout (desktop only or website + desktop).
- [ ] If strict paywall needed, enforce in `website/api/download.js` via entitlement token check before redirect.

Acceptance:
- [ ] Marketing copy matches actual behavior.
- [ ] Download route policy is intentional and enforced.

### Phase 6: Rollout + Ops (1-2 days)
- [ ] Feature flag by env: `BILLING_GATE_ENABLED`.
- [ ] Add admin script for manual entitlement overrides.
- [ ] Add structured logs for billing API + webhook failures.
- [ ] Add runbook doc for support cases:
  - trial ended unexpectedly
  - webhook outage
  - payment failure recovery

Acceptance:
- [ ] Can disable gate quickly without redeploying desktop.
- [ ] Support can diagnose user state in under 5 minutes.

## Test Plan

### Unit Tests
- [ ] Trial date arithmetic.
- [ ] State transition mapping from webhook events.
- [ ] Entitlement decision function (`entitled` true/false).

### Integration Tests
- [ ] `GET /api/billing/status` for:
  - new user (starts trial)
  - trial active
  - trial ended
  - active subscription
  - grace period
- [ ] Webhook signature validation and idempotency.

### Manual E2E
- [ ] Sign in from desktop.
- [ ] Start trial and verify countdown.
- [ ] Complete checkout and verify unlock.
- [ ] Simulate past_due and verify block.
- [ ] Restore payment and verify unblock.

## Suggested Implementation Order
1. Phase 0 + Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5 + Phase 6

## Risks and Mitigations
- Risk: webhook delays cause stale access.
  - Mitigation: allow temporary `grace_period`, add manual refresh button.
- Risk: client-side only enforcement bypass.
  - Mitigation: main-process entitlement checks on key actions.
- Risk: environment mismatch between Clerk/Polar projects.
  - Mitigation: explicit env validation at app start, log project IDs in non-prod.

## Definition of Done
- [ ] Trial starts automatically on first sign-in.
- [ ] Users with inactive entitlement are blocked from proceeding.
- [ ] Active subscribers can continue uninterrupted.
- [ ] Webhook updates are idempotent and auditable.
- [ ] UI, website copy, and enforcement behavior match.
