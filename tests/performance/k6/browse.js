import { sleep } from 'k6';
import { BASE_URL, get, responseCheck, standardThresholds, summary } from './lib.js';

export const options = { scenarios: { browse: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: __ENV.RAMP_DURATION || '30s', target: Number(__ENV.START_VUS || 20) }, { duration: __ENV.HOLD_DURATION || '1m', target: Number(__ENV.TARGET_VUS || 50) }, { duration: __ENV.RAMP_DOWN || '15s', target: 0 }] } }, thresholds: standardThresholds };
export default function () {
  const list = get('/api/events?pageSize=12'); responseCheck(list, 'event catalog available');
  const items = list.json('items') || [];
  if (items.length) {
    const event = items[(__VU + __ITER) % items.length];
    responseCheck(get(`/api/events/${event.id}`), 'event detail available');
    responseCheck(get(`/api/events/${event.id}/availability`), 'event inventory available');
  }
  responseCheck(get(`/api/events?search=${encodeURIComponent(__ENV.SEARCH_TERM || 'koncert')}&pageSize=12`), 'search available');
  sleep(0.4);
}
export function handleSummary(data) { return summary(__ENV.SUMMARY_NAME || 'load')(data); }
