# Deployment and cost safety

No cloud resource is created by these instructions automatically. Do not deploy publicly until the Firebase project, IAM, and billing configuration have been reviewed. The repository does not start paid billing, provision services, or run `gcloud`.

## Local containers

```bash
docker compose up --build
```

The local stack includes the app, Auth/Firestore emulators, a one-shot seed container, Mailpit, and a separate local outbox worker. Firestore data lives in the named Docker volume. No cloud credentials are required.

## Production Firebase prerequisites

1. Create/select a Firebase project and enable email/password Authentication and Cloud Firestore in the console.
2. Configure Firebase Auth authorized domains for the final application domain.
3. Deploy `firestore.rules` and `firestore.indexes.json` to the selected project using the Firebase CLI after review. The rules deny direct client Firestore access; the backend uses Admin SDK credentials.
4. Assign a dedicated Cloud Run service identity the minimum required Firebase/Firestore access. Prefer Application Default Credentials. Do not download or commit a service-account key.
5. Set the Vite public config at image build time: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, and `VITE_FIREBASE_PROJECT_ID`. Set `VITE_FIREBASE_AUTH_EMULATOR_URL` to an empty value for production. The Firebase web API key is public configuration; it is not an Admin credential.

## Build and Cloud Run configuration

The Dockerfile produces a multi-stage Node 24 image containing the compiled API, frontend assets, shared runtime package, and production dependencies. It listens on `0.0.0.0:$PORT` (default 8080), serves the SPA and API from one container, uses no persistent local state, and handles SIGTERM.

The requested controlled experiment configuration is:

| Setting | Value |
| --- | --- |
| Region | `europe-west1` (Belgium) |
| CPU / memory | 1 vCPU / 512 MiB |
| Minimum / maximum instances | 0 / 1 |
| Concurrency | 10 |
| Billing | Request-based |
| Ingress | Public HTTPS, if explicitly approved |

Example commands below only describe the deployment; they have not been executed. Build images with the production Vite config (empty Auth emulator URL) and publish to a registry only after considering build/storage/network charges. Configure Cloud Run environment with the real Firebase project ID, `WEB_ORIGIN`, and `EMAIL_MODE=simulation` until an email adapter is deliberately configured.

```bash
gcloud run deploy ticket-maestro \
  --image REGION-docker.pkg.dev/PROJECT/REPOSITORY/ticket-maestro:TAG \
  --region europe-west1 --cpu 1 --memory 512Mi \
  --min 0 --max 1 --concurrency 10 --port 8080 \
  --service-account ticket-maestro-runtime@PROJECT.iam.gserviceaccount.com \
  --set-env-vars NODE_ENV=production,FIREBASE_PROJECT_ID=PROJECT,EMAIL_MODE=simulation \
  --allow-unauthenticated
```

For `--allow-unauthenticated`, all public paths still have application-level limits; protected endpoints require Firebase ID tokens. Review whether public invocation matches the project’s threat model before using the flag. Set `WEB_ORIGIN` to the final origin if cross-origin access is needed. Cloud Run’s request-based CPU allocation is compatible with the stateless app; do not run the local polling worker as a Cloud Run sidecar/background loop.

## Optional Cloud Tasks email delivery

When asynchronous email delivery is required, configure a Cloud Tasks queue and a task identity in the same project, then set:

- `CLOUD_TASKS_QUEUE`
- `CLOUD_TASKS_LOCATION` (for example `europe-west1`)
- `CLOUD_TASKS_SERVICE_ACCOUNT` (identity included in task OIDC tokens)
- `EMAIL_WORKER_SERVICE_ACCOUNT` (expected task identity verified by the API)
- `SERVICE_BASE_URL` (the service HTTPS origin used as the OIDC audience)
- `EMAIL_MODE=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` (or keep simulation)

The API writes the outbox job in the checkout transaction and then enqueues a named Cloud Task. Cloud Tasks invokes one API task endpoint with an OIDC token; duplicate attempts are deduplicated by job lease/state, and failed SMTP results are retryable. Configure a bounded queue retry policy and monitor exhausted tasks. The runtime service identity needs Cloud Tasks enqueue permission. Cloud Tasks’ service agent must be able to mint the configured task identity token; the API verifies its email and audience. Do not expose worker credentials in the browser.

Cloud Tasks, Cloud Run, SMTP, and network usage can add cost. This integration is opt-in and is not needed for local development. If Cloud Tasks is not configured, the outbox remains visible as `QUEUED` until the user retries, or a separately operated worker handles it.

## GitHub Actions

The default CI workflow runs on pushes and pull requests and does not deploy. The separate `workflow_dispatch` deployment workflow requires the user to set its confirmation input and configure `GCP_PROJECT_ID`, `GCP_REGION`, `WIF_PROVIDER`, and `WIF_SERVICE_ACCOUNT` secrets/variables. It uses Workload Identity Federation; no service-account key is stored in Git. The workflow is not enabled by push events.

## Billing and budgets

- A Google Cloud Free Trial has credit and time limits. Do not assume this application or its supporting services will permanently cost 0 PLN.
- Cloud Run may have low usage with zero minimum instances, but builds, Artifact Registry storage, Firestore, Cloud Tasks, logs, network egress, and SMTP can also incur charges.
- Before deploying, verify the project’s billing account/trial state in Google Cloud Console. Do not upgrade billing automatically.
- Configure a budget and alert thresholds in Cloud Billing for the project. Budget alerts notify; **they are not hard spending caps** and do not prevent resources from accruing charges.
- Set Firestore quotas/alerts, Cloud Run max instances, request concurrency, and queue retry limits deliberately. Remove resources/data when the academic experiment ends.

## Why max instances = 1

One instance and concurrency 10 reduce autoscaling variability and make a controlled experiment easier to interpret. It is not a production availability recommendation: it limits throughput, provides no second-instance failover, and does not remove Firestore contention. Record overload as application error, HTTP throttling, transaction contention, process crash, or platform scaling constraint instead of treating every failure as the same condition.
