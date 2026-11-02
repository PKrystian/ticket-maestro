import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
export const AUTH_EMULATOR_URL = (__ENV.AUTH_EMULATOR_URL || 'http://localhost:9099').replace(/\/$/, '');
export const REMOTE_ALLOWED = __ENV.ALLOW_REMOTE_LOAD_TESTS === 'true';
export const statusCounts = new Counter('response_status_count');
const localHost = /^(http:\/\/localhost(?::\d+)?|http:\/\/127\.0\.0\.1(?::\d+)?)$/i;

if (!localHost.test(BASE_URL) && !REMOTE_ALLOWED) throw new Error('Remote load testing is disabled. Set ALLOW_REMOTE_LOAD_TESTS=true only for your own deployment.');
if (!localHost.test(AUTH_EMULATOR_URL)) throw new Error('Load tests may authenticate only through the local Firebase Auth emulator. For remote tests, provide AUTH_TOKEN.');

export function record(response) {
  if (response) statusCounts.add(1, { status: String(response.status) });
  return response;
}
export function get(path, params = {}) { return record(http.get(`${BASE_URL}${path}`, params)); }
export function post(path, body, params = {}) { return record(http.post(`${BASE_URL}${path}`, JSON.stringify(body), { headers: { 'content-type': 'application/json', ...params.headers }, ...params })); }
export function put(path, body, params = {}) { return record(http.put(`${BASE_URL}${path}`, JSON.stringify(body), { headers: { 'content-type': 'application/json', ...params.headers }, ...params })); }
export function authToken(email = __ENV.USER_EMAIL, password = __ENV.USER_PASSWORD) {
  if (__ENV.AUTH_TOKEN) return __ENV.AUTH_TOKEN;
  if (!email || !password) throw new Error('Set AUTH_TOKEN or USER_EMAIL and USER_PASSWORD for authenticated scenarios.');
  const response = http.post(`${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`, JSON.stringify({ email, password, returnSecureToken: true }), { headers: { 'content-type': 'application/json' }, timeout: '15s' });
  record(response);
  if (response.status !== 200) throw new Error(`Auth emulator sign-in failed with ${response.status}.`);
  return response.json('idToken');
}
export function bearer(token) { return { headers: { authorization: `Bearer ${token}` } }; }
export function responseCheck(response, name = 'request succeeded') { return check(response, { [name]: result => result.status >= 200 && result.status < 400 }); }
export function summary(name) {
  return data => ({ [`tests/performance/results/${name}.json`]: JSON.stringify(data, null, 2), stdout: `k6 ${name} summary written to tests/performance/results/${name}.json\n` });
}
export const standardThresholds = { http_req_failed: ['rate<0.02'], http_req_duration: ['p(95)<500', 'p(99)<1000'] };
