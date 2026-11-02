# Performance testing

These are repeatable experiments, not a benchmark report. Suggested thresholds are requirements for later measurement; no latency, throughput, or capacity result is fabricated here.

## Proposed response targets

| Operation | Normal-load target | High-load target |
| --- | ---: | ---: |
| Login, browse/search, event detail, availability | ≤ 500 ms | ≤ 1,000 ms |
| Registration, event management, reservation, cancellation, simulated purchase | ≤ 3 s | ≤ 10 s |
| Purchase confirmation/email end-to-end completion | ≤ 120 s | ≤ 1,200 s |

Large-operation targets apply to asynchronous completion, not an individual HTTP request. For each run capture average, median, p95, p99, requests/second, successful/failed requests, HTTP status distribution, error rate, reservation consistency, and the workload point where latency or failures begin to rise. k6’s summary includes duration percentiles, rates, request totals, response status tags, and custom reservation/check metrics. Preserve raw k6 JSON or JMeter JTL output alongside the summary.

## Safety controls

- Every script defaults to `http://localhost:8080` and exits if `BASE_URL` is remote unless `ALLOW_REMOTE_LOAD_TESTS=true` is explicitly set.
- The oversale scenario authenticates only through the local Firebase Auth emulator. For remote application tests, provide a pre-issued `AUTH_TOKEN`; do not generate load against Google Auth, Firestore APIs, or unrelated services.
- CI never runs stress, spike, oversale, soak, or other high-load scenarios.
- The 500-VU test requires the explicit local-only `pnpm seed:load-users` and `pnpm reset:oversale` commands.
- Failure injection requires a development server started with `ENABLE_FAILURE_INJECTION=true` and an admin token. It models failures at the API boundary, not Firestore emulator internals.
- Do not run a high-load scenario against a public URL by accident. Review the target and test parameters before opting in.

## k6 scenarios

| Test | Script | Default workload | Focus |
| --- | --- | --- | --- |
| Load | `load.js` | 20 → 50 VUs | List, search, details, availability; browse target ≤ 500 ms p95. |
| Stress | `stress.js` | 20 → 100 → 250 → 500 VUs | Identify degradation; record error classes and recovery. |
| Spike | `spike.js` | 10 → 300 VUs rapidly | Recovery after sudden demand. |
| Oversale/concurrency | `oversale.js` | 500 VUs, one attempt each, distinct `load-0001..0500` users | Exactly 10 success holds, other attempts 409, final inventory 0/10. |
| Soak | `soak.js` | 40 VUs for 20 minutes | Sustained errors and latency drift. |
| Failure | `failure.js` | 1 VU | Admin enables 503 injection, bounded latency/client timeout, reset, recovery. |
| Multi-event | `multi-event.js` | 100 VUs, 2 minutes | Competing reservations across independent event documents. |
| Purchase/confirmation | `purchase.js` | 5 VUs, 20 iterations | Reserve, verify simulated purchase, fetch generated tickets, poll to `SENT`/`SIMULATED`, and record end-to-end email completion time; Mailpit shows local SMTP messages. |

Run single tests with `pnpm perf:load`, `pnpm perf:stress`, `pnpm perf:spike`, `pnpm perf:oversale`, `pnpm perf:soak`, `pnpm perf:failure`, `pnpm perf:multi-event`, or `pnpm perf:purchase`. Set `SUMMARY_NAME` to retain a uniquely named JSON report. Workload values can be overridden through `VUS`, `DURATION`, `MAX_VUS`, `SPIKE_VUS`, `STRESS_TOP_DURATION`, `EVENT_ID`, `EVENT_IDS`, `USER_EMAIL`, `USER_PASSWORD`, `AUTH_TOKEN`, and related variables used in each script.

The repeatable oversale sequence is:

```bash
pnpm seed:load-users
pnpm reset:oversale
VUS=500 SUMMARY_NAME=oversale-$(date -u +%Y%m%dT%H%M%SZ) k6 run tests/performance/k6/oversale.js
```

Each VU signs in as a distinct emulator user, makes one idempotent reservation attempt, and records its outcome. The setup checks the fixture starts at exactly 10/10. Teardown checks capacity remains consistent and exactly 10 holds occurred. Run the fixture reset again before every repeat.

## JMeter

`tests/performance/jmeter/ticket-maestro.jmx` contains a 20-user browse/search group and a configurable reservation concurrency group (default 500 threads). The reservation sampler accepts 201/409. Use `tests/performance/jmeter/run-jmeter.sh`; it defaults to localhost, requires `AUTH_TOKEN`, creates timestamped JTL and HTML output, and blocks remote origins without the same explicit opt-in.

## Failure classification

Do not combine all non-2xx responses into one “overloaded” label. Record separately:

- **Functional failure:** unexpected response or inventory invariant violation.
- **HTTP throttling:** 429 from the API rate limiter or platform.
- **Database contention:** Firestore transaction retries/aborts and their API status/log evidence.
- **Application crash:** health/readiness failures, connection resets, or process restart.
- **Infrastructure scaling limit:** Cloud Run max instance/concurrency or request timeout evidence.

An emulator run is a correctness and repeatability tool, not a substitute for production Firestore/Cloud Run benchmark measurements. Cloud Firestore emulator behavior and contention differ from production. Save test outputs and environment (commit, Node/k6 version, VUs/stages, emulator/Cloud Run settings) before drawing conclusions.
