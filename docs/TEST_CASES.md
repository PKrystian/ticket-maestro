# Test cases and validation

## Automated coverage

### Shared/API unit tests

- Supported roles and invalid role labels.
- Ticket quantity range 1–5 and integer validation.
- Event capacity, date, and HTTP(S)-only image URL validation.
- API input contract rejects missing/malformed data.

### Firebase emulator integration tests

Run after starting local Auth and Firestore emulators (`pnpm dev` in one terminal, or `pnpm emulators` then seed in another), then:

```bash
pnpm test:integration
```

The Supertest cases cover unauthorized admin access, 12 simultaneous requests against a 10-ticket event, two requests competing for the final ticket, final inventory consistency, idempotency replay, cancellation ownership/repeat safety, invalid quantity, simulated checkout failure/inventory restoration, email retry failure, and active-event deletion protection. The suite is skipped when either emulator host variable is absent.

Additional behavior exercised by the API and browser paths includes manager/admin route guards, event CRUD safeguards, confirmation job outbox, unique ticket creation, and email delivery status/retry. Run the browser suite for an end-to-end check:

```bash
pnpm test:e2e
```

Playwright starts the local emulator/app stack using `pnpm dev` if no app is already running. Set `E2E_BASE_URL=http://localhost:8080` to use an already-running Docker Compose stack. Tests cover discovery/search, normal-role registration, sign-in, simulated purchase and printable ticket view, and admin dashboard access.

### Concurrency and delivery tests

The k6 oversale test is the 500-distinct-user scenario. It requires explicit seeding/reset and is intentionally not in ordinary CI. The purchase k6 scenario and local Mailpit UI can be used to inspect generated tickets, `emailStatus`, and message arrival. SMTP failures can be exercised by pointing the local test adapter at an unavailable local SMTP port; no real email service should be used for load testing.

## Manual acceptance matrix

| Case | Expected result |
| --- | --- |
| Unauthenticated user calls `/api/admin/stats` | 401 |
| Regular `USER` calls admin/manager endpoints | 403 |
| User submits `quantity: 0`, `6`, string, or fraction | 400 |
| Two requests contend for one final ticket | At most one succeeds; inventory never negative |
| Same user retries same event/quantity/key | 200 replay with original reservation ID |
| Same key used for another event/quantity | 409 idempotency conflict |
| Different user tries cancellation | 403 |
| Same owner repeats cancellation | 200 cancelled record; counter restored exactly once |
| Failed simulated checkout | 402 and held inventory is restored |
| Email send fails | Purchase remains confirmed; delivery state becomes FAILED and is retryable |
| Email adapter simulation | State is SIMULATED; UI does not claim delivery |
| Delete/cancel event with active reservations | 409 |
| Capacity lowered below active inventory | 409 |

## Validation record

The project README should be updated with actual command results after a local run. Do not infer a 500-user result from unit tests or an emulator build. A passing frontend/API build only proves compilation and bundle generation.
