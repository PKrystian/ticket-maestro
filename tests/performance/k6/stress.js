import { sleep } from 'k6';
import { get, responseCheck, summary } from './lib.js';

export const options = { scenarios: { stress: { executor: 'ramping-vus', startVUs: 10, stages: [{ duration: '1m', target: 20 }, { duration: '2m', target: 100 }, { duration: '2m', target: 250 }, { duration: __ENV.STRESS_TOP_DURATION || '2m', target: Number(__ENV.MAX_VUS || 500) }, { duration: '30s', target: 0 }] } }, thresholds: { http_req_duration: ['p(95)<1000'], http_req_failed: ['rate<0.05'] } };
export default function () { responseCheck(get('/api/events?pageSize=24'), 'catalog response'); responseCheck(get('/api/events?category=Muzyka&pageSize=12'), 'category response'); sleep(0.3); }
export function handleSummary(data) { return summary(__ENV.SUMMARY_NAME || 'stress')(data); }
