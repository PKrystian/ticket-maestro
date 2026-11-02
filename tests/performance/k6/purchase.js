import { Counter, Trend } from 'k6/metrics';
import { check, sleep } from 'k6';
import { authToken, bearer, get, post, summary } from './lib.js';

const emailFailures = new Counter('purchase_email_failures');
const emailCompletion = new Trend('purchase_email_completion_ms', true);
export const options = { vus: Number(__ENV.VUS || 5), iterations: Number(__ENV.ITERATIONS || 20), thresholds: { http_req_failed: ['rate<0.1'], http_req_duration: ['p(95)<10000'], purchase_email_failures: ['count==0'] } };
export default function () {
  const token = authToken(); const auth = bearer(token); const eventId = __ENV.EVENT_ID || 'jazz-nad-warta';
  const reservation = post(`/api/events/${eventId}/reservations`, { quantity: 1 }, { ...auth, headers: { ...auth.headers, 'idempotency-key': `purchase-${__VU}-${__ITER}-${Date.now()}` } });
  check(reservation, { 'reservation created': response => response.status === 201 });
  if (reservation.status !== 201) return;
  const id = reservation.json('reservation.id');
  const purchased = post(`/api/reservations/${id}/checkout`, {}, auth);
  check(purchased, { 'simulated purchase confirmed': response => response.status === 200 && response.json('reservation.status') === 'CONFIRMED' });
  if (purchased.status !== 200) return;
  const tickets = get(`/api/reservations/${id}/tickets`, auth);
  check(tickets, { 'ticket document generated': response => response.status === 200 && response.json().length === 1 });

  const startedAt = Date.now();
  const deadline = startedAt + Number(__ENV.EMAIL_WAIT_SECONDS || 120) * 1000;
  let emailStatus = 'QUEUED';
  while (Date.now() <= deadline && !['SENT', 'SIMULATED', 'FAILED'].includes(emailStatus)) {
    const rows = get('/api/reservations', auth);
    check(rows, { 'reservation list remains available': response => response.status === 200 });
    if (rows.status !== 200) break;
    const current = rows.json().find(row => row.id === id);
    emailStatus = current?.emailStatus ?? 'QUEUED';
    if (!['SENT', 'SIMULATED', 'FAILED'].includes(emailStatus)) sleep(1);
  }
  emailCompletion.add(Date.now() - startedAt);
  if (!['SENT', 'SIMULATED'].includes(emailStatus)) emailFailures.add(1);
  check({ emailStatus }, { 'email workflow reaches a terminal status': state => ['SENT', 'SIMULATED'].includes(state.emailStatus) });
  console.log(`purchase ${id} email status: ${emailStatus}`);
}
export function handleSummary(data) { return summary(__ENV.SUMMARY_NAME || 'purchase')(data); }
