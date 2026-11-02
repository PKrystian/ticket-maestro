# Database model

All collections are accessed by the Express API through Firebase Admin. `firestore.rules` denies direct browser reads and writes.

| Collection | Document ID | Important fields | Notes |
| --- | --- | --- | --- |
| `users` | Firebase Auth UID | `email`, `role`, `createdAt` | Role is server-resolved; self-registration writes `USER`. |
| `events` | Firestore ID | `title`, `titleNormalized`, `description`, `category`, `date`, `location`, `imageUrl`, `capacity`, `available`, `reserved`, `status`, `managerId` | One document per event; capacity 10–20,000. |
| `reservations` | Firestore ID | `eventId`, `eventTitle`, `eventDate`, `userId`, `quantity`, `status`, `ticketIds`, `emailStatus`, `idempotencyKey` | Quantity 1–5. User listing is capped at 100 most recent records. |
| `idempotencyKeys` | SHA-256 of `uid:key` | `userId`, `reservationId`, `eventId`, `quantity` | Raw keys are not used as document IDs. Records are retained to protect retries. |
| `tickets` | Random UUID | `reservationId`, `eventId`, `ownerId`, unique `code`, `status` | Created only after simulated checkout succeeds. |
| `emailJobs` | Reservation ID | `status`, `attempts`, `retryVersion`, `nextAttemptAt`, `leaseUntil`, `lastError` | Transactional outbox for asynchronous delivery/retry. |

## Invariants

- `0 <= available <= capacity` and `reserved = capacity - available` for a healthy event.
- Reserving `q` requires `available >= q`; one Firestore transaction creates the reservation and moves `(available, reserved)` by `(-q, +q)`.
- A confirmed reservation has a unique ticket code per ticket; tickets are not pre-created for unsold capacity.
- Cancellation marks the reservation before releasing inventory in the same transaction. Repeated cancellation returns the existing cancelled record.
- Event capacity cannot be reduced below reserved tickets. An event cannot be deleted or moved to cancelled status while it has pending/confirmed reservations.
- A Firestore idempotency record binds the user, event, and quantity to the original reservation.

## Indexes

`firestore.indexes.json` lists event catalog, organizer, reservation, ticket, and outbox composites. Emulator queries do not validate production index requirements, so deploy indexes to a non-production Firebase project and verify the actual query plans before production use. Firestore may suggest additional indexes for combinations introduced by future filters.

## Local setup

The Firebase emulator project ID is `ticket-maestro-local`. Auth listens on 9099 and Firestore on 8081. `pnpm dev` and Docker Compose seed three demo users and a small event list. `pnpm seed:load-users`, `pnpm reset:oversale`, and `pnpm seed:large` are explicit local-only actions. Seed scripts require both emulator host variables and refuse to write to a cloud project.
