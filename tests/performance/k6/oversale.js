import { check } from 'k6';
import { Counter } from 'k6/metrics';
import http from 'k6/http';
import { BASE_URL, AUTH_EMULATOR_URL, bearer, get, record, summary } from './lib.js';

const succeeded = new Counter('reservation_successes');
const conflicts = new Counter('reservation_conflicts');
const unexpected = new Counter('reservation_unexpected_responses');
const authFailures = new Counter('oversale_auth_failures');
const users = Number(__ENV.VUS || 500);
const eventId = __ENV.EVENT_ID || 'load-oversale-event';
const expectedSuccesses = Math.min(users, 10);
export const options = { scenarios: { oversale: { executor: 'per-vu-iterations', vus: users, iterations: 1, maxDuration: __ENV.MAX_DURATION || '10m' } }, thresholds: { checks: ['rate>=1'], http_req_failed: ['rate<0.99'], http_req_duration: ['p(95)<10000'], reservation_successes: [`count>=${expectedSuccesses}`, `count<=${expectedSuccesses}`], reservation_conflicts: [`count>=${Math.max(0, users - 10)}`, `count<=${Math.max(0, users - 10)}`], reservation_unexpected_responses: ['count<=0'], oversale_auth_failures: ['count<=0'] } };
export function setup() {
  const inventory = get(`/api/events/${eventId}/availability`);
  if (inventory.status !== 200 || Number(inventory.json('available')) !== 10 || Number(inventory.json('capacity')) !== 10) throw new Error('Reset the local oversale fixture before running; it must have exactly 10 available out of 10.');
  return { initialAvailable: Number(inventory.json('available')) };
}
export default function () {
  const suffix = String(__VU).padStart(4, '0');
  const email = `load-${suffix}@ticketmaestro.local`;
  const response = httpSignIn(email, __ENV.USER_PASSWORD || 'TicketMaestro123!');
  check(response, { 'distinct local user authenticated': result => result.status === 200 });
  if (response.status !== 200) { authFailures.add(1); return; }
  const idToken = response.json('idToken');
  const booked = record(httpPost(`${BASE_URL}/api/events/${eventId}/reservations`, JSON.stringify({ quantity: 1 }), { headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}`, 'idempotency-key': `oversale-${__VU}-${__ITER}` }, responseCallback: http.expectedStatuses(201, 409), timeout: '30s' }));
  if (booked.status === 201) succeeded.add(1); else if (booked.status === 409) conflicts.add(1); else unexpected.add(1);
  check(booked, { 'reservation is success or insufficient inventory': result => result.status === 201 || result.status === 409 });
}
export function teardown() {
  const finalInventory = get(`/api/events/${eventId}/availability`);
  const finalAvailability = Number(finalInventory.json('available'));
  const capacity = Number(finalInventory.json('capacity'));
  check(finalInventory, { 'inventory remains within capacity': result => result.status === 200 && finalAvailability >= 0 && finalAvailability <= capacity, 'exactly available attempts were held': result => result.status === 200 && capacity - finalAvailability === expectedSuccesses });
  console.log(`oversale consistency: capacity=${capacity}, remaining=${finalAvailability}; expected 10 successful holds.`);
}
function httpSignIn(email, password) { return record(http.post(`${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, JSON.stringify({ email, password, returnSecureToken: true }), { headers: { 'content-type': 'application/json' }, timeout: '30s' })); }
function httpPost(url, body, params) { return http.post(url, body, params); }
export function handleSummary(data) { return summary(__ENV.SUMMARY_NAME || 'oversale')(data); }
