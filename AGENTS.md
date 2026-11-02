# TicketMaestro engineering notes

- This is a pnpm TypeScript workspace. Keep runtime contracts in `packages/shared` and build that workspace package before running API scripts directly.
- The API is the only Firestore data access layer. Keep Firestore rules deny-by-default and verify roles from `users/{uid}` documents on the server.
- Inventory changes must remain in Firestore transactions that read and update the event counter together with the reservation state. Preserve idempotency and cancellation behavior.
- Do not add real payment collection. Checkout is a test verification step only.
- Local performance targets default to localhost. Never point load scripts at remote targets without explicit opt-in; do not run high-load scenarios in CI.
- Do not run public Cloud Run deployments or create cloud resources as part of routine development.
- Do not claim performance numbers unless a repeatable benchmark was executed and its result saved.
