# Architecture

## Runtime boundaries

- `apps/web` contains the Polish React single-page app. Firebase Auth owns password handling and issues ID tokens; the SPA sends the token as a bearer header to the API.
- `apps/api` is the only application layer with Firestore Admin access. Express routes validate input with Zod, authenticate Firebase ID tokens, resolve current roles from `users/{uid}`, and call service functions.
- `packages/shared` contains DTO interfaces, role/status unions, and shared Zod schemas.
- Cloud Run serves `apps/web/dist` and `/api` from one stateless Node process. The container binds `0.0.0.0:$PORT` and stores no durable local files.
- `emailJobs` is a transactional outbox. Local Compose has a separate polling worker; an optional Cloud Tasks task invokes one authenticated job in Cloud Run. The Cloud Run request process itself has no background polling loop.

## Reservation transaction

The transaction reads the event and the hash of `(userId, idempotencyKey)`. If the key exists, it returns the original reservation when event and quantity match or returns a conflict when they differ. Otherwise it verifies `PUBLISHED`, date, and authoritative `available >= quantity`, then creates the reservation/key and decrements `available` while incrementing `reserved`.

Firestore may retry this transaction after contention. Since inventory decrement and reservation creation commit together, two successful transactions cannot consume the same ticket. A retry with the same key cannot create a second reservation. API `409` means an event/inventory conflict; validation errors are `400`, unauthenticated requests `401`, ownership/role failures `403`, missing records `404`, and simulated or infrastructure failures are separately identified.

Checkout is deliberately simulated. Its transaction creates ticket IDs and codes once, confirms the reservation, and inserts an email outbox job. No payment method or card information is collected. If verification is simulated as failed, another transaction marks `PAYMENT_FAILED` and restores the held inventory.

Cancellation reads the reservation and event, checks ownership and event time, marks the reservation/tickets cancelled, and restores the quantity in the same transaction. Repeated cancellation sees `CANCELLED` and does not touch the event counter again. A confirmation email currently being sent blocks cancellation briefly so a canceled ticket is not mailed as valid.

## Firestore contention and scale

The model stores an event counter, not one document per available ticket. It supports the target capacity range while generating ticket documents only after checkout. Public event reads are bounded and cursor-paginated. Title search is a normalized prefix query; it is not an arbitrary substring search. Admin occupancy aggregation reads at most 10,000 event summaries, matching the stated target catalog size.

For one very popular event, every successful reservation updates the same event document. That is a serialized contention point by design. Transactions retry within SDK limits; users can see a 409 when inventory is exhausted and an operational error if the database cannot complete a transaction. No throughput or latency guarantee is inferred from emulator results. A sharded counter would complicate exact inventory and still needs a coordination rule for the final ticket; this project keeps the invariant explicit for the academic experiment.

## Identity and authorization

Firebase Auth verifies identity; Firebase Admin verifies each ID token. The API reads the role from the server-owned Firestore user document. Public profile creation can create a `USER` record only. Firestore rules deny direct client data access, so every protected business operation checks role or ownership in Express.

## Failure handling

Failure injection is disabled unless `ENABLE_FAILURE_INJECTION=true` and `NODE_ENV` is not `production`. Only an administrator token can change its process-local mode. Modes model API-boundary database latency and a database-unavailable response; they do not alter Firestore itself. This is suitable for endpoint recovery checks, not for claiming emulator/storage fault behavior. No injected latency is used to meet performance targets.

## Observability

The API emits structured request logs with authorization headers redacted. `/healthz` is a liveness endpoint. `/readyz` issues a bounded Firestore read and returns 503 when the database is unavailable. k6 summaries include request duration distributions, error rate, HTTP status counters, and the oversale consistency checks.
