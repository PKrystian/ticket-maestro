import { sleep } from 'k6';
import { get, responseCheck, summary } from './lib.js';

export const options = { scenarios: { spike: { executor: 'ramping-vus', startVUs: 10, stages: [{ duration: '10s', target: 10 }, { duration: __ENV.SPIKE_RAMP || '5s', target: Number(__ENV.SPIKE_VUS || 300) }, { duration: __ENV.SPIKE_HOLD || '1m', target: Number(__ENV.SPIKE_VUS || 300) }, { duration: '10s', target: 10 }, { duration: '30s', target: 10 }, { duration: '10s', target: 0 }] } }, thresholds: { http_req_failed: ['rate<0.05'], http_req_duration: ['p(95)<1000'] } };
export default function () { responseCheck(get('/api/events?pageSize=20'), 'catalog response'); sleep(0.2); }
export function handleSummary(data) { return summary(__ENV.SUMMARY_NAME || 'spike')(data); }
