import http from 'k6/http';
import { check } from 'k6';
import { AUTH_EMULATOR_URL, BASE_URL, bearer, get, put, record, summary } from './lib.js';

export const options = { vus: 1, iterations: 1, thresholds: { http_req_failed: ['rate<0.8'] } };
export default function () {
  const token = __ENV.AUTH_TOKEN || signIn(__ENV.ADMIN_EMAIL || 'admin@ticketmaestro.local', __ENV.ADMIN_PASSWORD || 'TicketMaestro123!');
  const auth = bearer(token);
  const activateError = put('/api/admin/failure-injection', { mode: 'error' }, auth);
  check(activateError, { 'admin enables simulated DB errors': response => response.status === 200 });
  const failed = get('/api/events?pageSize=1');
  check(failed, { 'simulated DB error returns 503': response => response.status === 503 });
  const activateLatency = put('/api/admin/failure-injection', { mode: 'latency', latencyMs: Number(__ENV.LATENCY_MS || 2500) }, auth);
  check(activateLatency, { 'admin enables bounded simulated latency': response => response.status === 200 });
  const timeout = record(http.get(`${BASE_URL}/api/events?pageSize=1`, { timeout: __ENV.REQUEST_TIMEOUT || '1s' }));
  check(timeout, { 'client timeout is observed during injected latency': response => !response || response.status === 0 });
  const reset = put('/api/admin/failure-injection', { mode: 'none' }, auth);
  check(reset, { 'admin resets failure injection': response => response.status === 200 });
  check(get('/api/events?pageSize=1'), { 'service recovers after failure injection': response => response.status === 200 });
}
function signIn(email, password) {
  const response = record(http.post(`${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, JSON.stringify({ email, password, returnSecureToken: true }), { headers: { 'content-type': 'application/json' } }));
  if (response.status !== 200) throw new Error('Admin sign-in failed in local auth emulator.');
  return response.json('idToken');
}
export function handleSummary(data) { return summary(__ENV.SUMMARY_NAME || 'failure')(data); }
