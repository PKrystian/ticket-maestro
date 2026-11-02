# REST API

The full OpenAPI document is [`apps/api/openapi.json`](../apps/api/openapi.json) and is served at `/openapi.json`. API routes are under `/api`. Authenticated endpoints require `Authorization: Bearer <Firebase ID token>`.

## Main endpoints

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/auth/profile` | Authenticated | Create the server-owned default `USER` profile if missing. |
| `GET` | `/me` | Authenticated | Return user ID, email, and current Firestore role. |
| `GET` | `/events` | Public | Prefix search, category, date range, sort, cursor page (max 48). |
| `GET` | `/events/:id` | Public | Published event detail. |
| `GET` | `/events/:id/availability` | Public | Current capacity and authoritative available counter. |
| `POST` | `/events` | Manager/admin | Create event. |
| `PUT` / `DELETE` | `/events/:id` | Owner-manager/admin | Update or delete with reservation safeguards. |
| `GET` | `/manager/events` | Manager/admin | Cursor-page manager-owned events; admin sees all. |
| `POST` | `/events/:id/reservations` | Authenticated | Reserve 1–5 tickets; requires `Idempotency-Key`. |
| `GET` | `/reservations` | Authenticated | Own most recent reservations. |
| `POST` | `/reservations/:id/checkout` | Owner | Simulated purchase verification. |
| `POST` | `/reservations/:id/cancel` | Owner | Cancel an eligible reservation atomically. |
| `GET` | `/reservations/:id/tickets` | Owner | Ticket details for confirmed purchase. |
| `POST` | `/reservations/:id/email/retry` | Owner | Retry confirmation email and return delivery state. |
| `GET` | `/admin/stats` | Admin | Live dashboard metrics. |

An insufficient inventory or invalid state returns `409`. Quantity/schema errors return `400`; ownership is checked server-side. A reservation response is `201` on creation and `200` for a valid idempotent replay. The replay must match the original event and quantity.

## Cursor pagination

The event endpoints accept `page`, `pageSize`, and an opaque `cursor`. First request page 1 without a cursor. When `hasMore` is true, pass `nextCursor` into the next request and increment `page`. A previous page uses the cursor saved for that page by the client. The Firestore query starts after that document rather than reading and discarding every preceding document.

## Email and purchase state

Checkout does not charge a payment method. It confirms tickets and queues an outbox job in the same transaction. `emailStatus` can be `QUEUED`, `SENT`, `SIMULATED`, or `FAILED`. `SENT` means SMTP accepted the message; it does not prove recipient delivery. `SIMULATED` means no SMTP send occurred. Local Docker connects SMTP to Mailpit. In production an optional Cloud Tasks queue calls a single authenticated worker endpoint; without Cloud Tasks the owner can trigger a retry from the confirmation view.

## Health and test-only routes

- `/healthz`: process liveness.
- `/readyz`: Firestore readiness.
- `PUT /api/admin/failure-injection`: available only when `ENABLE_FAILURE_INJECTION=true` and the process is not production; requires admin. Modes are `none`, `latency`, or `error`.
- `/api/internal/email-jobs/:id`: registered only when the complete optional Cloud Tasks configuration is present; verifies the Cloud Tasks OIDC service account before processing.
