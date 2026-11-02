import { sleep } from 'k6';
import { get, responseCheck, summary } from './lib.js';

export const options = { scenarios: { soak: { executor: 'constant-vus', vus: Number(__ENV.VUS || 40), duration: __ENV.DURATION || '20m' } }, thresholds: { http_req_failed: ['rate<0.02'], http_req_duration: ['p(95)<1000', 'p(99)<2000'] } };
export default function () { responseCheck(get('/api/events?pageSize=24'), 'catalog response'); responseCheck(get('/api/events?search=muzyka&pageSize=12'), 'search response'); sleep(0.6); }
export function handleSummary(data) { return summary(__ENV.SUMMARY_NAME || 'soak')(data); }
