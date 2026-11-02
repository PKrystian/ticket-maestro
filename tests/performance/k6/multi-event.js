import { sleep } from 'k6';
import http from 'k6/http';
import { check } from 'k6';
import { authToken, bearer, get, post, responseCheck, summary } from './lib.js';

export const options = { vus: Number(__ENV.VUS || 100), duration: __ENV.DURATION || '2m', thresholds: { http_req_failed: ['rate<0.05'], http_req_duration: ['p(95)<3000'] } };
const eventIds = (__ENV.EVENT_IDS || 'jazz-nad-warta,design-meetup,kino-pod-gwiazdami').split(',');
export function setup() {
  return eventIds.map(id => { const response = get(`/api/events/${id}/availability`); if (response.status !== 200) throw new Error(`Could not read initial inventory for ${id}`); return { id, capacity: Number(response.json('capacity')), available: Number(response.json('available')) }; });
}
export default function () {
  const token = authToken(); const auth = bearer(token);
  const eventId = eventIds[(__VU + __ITER) % eventIds.length];
  const inventory = get(`/api/events/${eventId}/availability`); responseCheck(inventory, 'event inventory');
  if (inventory.status === 200 && Number(inventory.json('available')) > 0) {
    const result = post(`/api/events/${eventId}/reservations`, { quantity: 1 }, { ...auth, headers: { ...auth.headers, 'idempotency-key': `multi-${__VU}-${__ITER}-${eventId}` }, responseCallback: http.expectedStatuses(201, 409) });
    check(result, { 'reservation accepted or inventory conflict': response => response.status === 201 || response.status === 409 });
    if (result.status === 201) {
      const reservationId = result.json('reservation.id');
      check(post(`/api/reservations/${reservationId}/cancel`, {}, auth), { 'temporary reservation releases inventory': response => response.status === 200 });
    }
  }
  sleep(0.3);
}
export function teardown(initial) {
  for (const event of initial) {
    const response = get(`/api/events/${event.id}/availability`); const available = Number(response.json('available'));
    check(response, { [`${event.id} inventory returns to its starting point`]: result => result.status === 200 && available === event.available && available >= 0 && available <= event.capacity });
    console.log(`multi-event inventory ${event.id}: initial=${event.available}, final=${available}, capacity=${event.capacity}`);
  }
}
export function handleSummary(data) { return summary(__ENV.SUMMARY_NAME || 'multi-event')(data); }
