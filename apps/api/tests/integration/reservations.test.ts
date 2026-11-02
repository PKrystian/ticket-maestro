import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = Boolean(authHost && firestoreHost);
let app: Express;
let db: typeof import('../../src/firebase.js').db;
let auth: typeof import('../../src/firebase.js').auth;
let request: typeof import('supertest').default;
const eventId = `integration-${Date.now()}`;

async function createToken(number: number) {
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `integration-${Date.now()}-${number}@ticketmaestro.local`, password: 'TicketMaestro123!', returnSecureToken: true })
  });
  if (!response.ok) throw new Error(`Auth emulator signup failed: ${response.status} ${await response.text()}`);
  const body = await response.json() as { localId: string; idToken: string; email: string };
  await db.collection('users').doc(body.localId).set({ uid: body.localId, email: body.email, role: 'USER' });
  return body.idToken;
}

describe.skipIf(!enabled)('reservation API integration (requires local Firebase emulators)', () => {
  const users: Array<{ token: string }> = [];
  let adminToken = '';
  beforeAll(async () => {
    process.env.EMAIL_MODE = 'smtp'; process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = '1'; process.env.ENABLE_FAILURE_INJECTION = 'true';
    ({ db, auth } = await import('../../src/firebase.js'));
    ({ app } = await import('../../src/app.js'));
    request = (await import('supertest')).default;
    adminToken = await createToken(999);
    const adminUid = (await auth.verifyIdToken(adminToken)).uid;
    await db.collection('users').doc(adminUid).update({ role: 'ADMIN' });
    for (let index = 0; index < 12; index++) users.push({ token: await createToken(index) });
    await db.collection('events').doc(eventId).set({ id: eventId, title: 'Integration ticket fixture', titleNormalized: 'integration ticket fixture', description: 'Used for repeatable integration coverage.', category: 'Test', date: new Date(Date.now() + 86_400_000).toISOString(), location: 'Local emulator', imageUrl: '', capacity: 10, available: 10, reserved: 0, status: 'PUBLISHED', managerId: 'integration-manager', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  }, 120_000);

  afterAll(async () => {
    if (!enabled) return;
    for (const fixture of [eventId, `${eventId}-idempotent`, `${eventId}-cancel`, `${eventId}-checkout`, `${eventId}-delete`, `${eventId}-email`, `${eventId}-last-ticket`]) await cleanupFixture(fixture);
  });

  async function cleanupFixture(fixtureId: string) {
    const eventReservations = await db.collection('reservations').where('eventId', '==', fixtureId).get();
    const keys = await db.collection('idempotencyKeys').where('eventId', '==', fixtureId).get();
    const batch = db.batch();
    for (const row of eventReservations.docs) {
      const tickets = await db.collection('tickets').where('reservationId', '==', row.id).get();
      for (const ticket of tickets.docs) batch.delete(ticket.ref);
      batch.delete(row.ref);
      batch.delete(db.collection('emailJobs').doc(row.id));
    }
    for (const key of keys.docs) batch.delete(key.ref);
    batch.delete(db.collection('events').doc(fixtureId));
    await batch.commit();
  }

  it('rejects admin access, prevents overselling, and leaves inventory exact under contention', async () => {
    const denied = await request(app).get('/api/admin/stats').set('authorization', `Bearer ${users[0]!.token}`);
    expect(denied.status).toBe(403);
    const attempts = await Promise.all(users.map(({ token }, index) => request(app).post(`/api/events/${eventId}/reservations`).set('authorization', `Bearer ${token}`).set('idempotency-key', `parallel-${index}`).send({ quantity: 1 })));
    expect(attempts.filter(response => response.status === 201)).toHaveLength(10);
    expect(attempts.filter(response => response.status === 409)).toHaveLength(2);
    const event = await db.collection('events').doc(eventId).get();
    expect(event.get('available')).toBe(0);
    expect(event.get('reserved')).toBe(10);
    const availability = await request(app).get(`/api/events/${eventId}/availability`);
    expect(availability.body.available).toBe(0);
  }, 30_000);

  it('creates a missing auth profile idempotently under concurrent setup requests', async () => {
    const uid = (await auth.verifyIdToken(users[0]!.token)).uid;
    await db.collection('users').doc(uid).delete();
    const initialize = () => request(app).post('/api/auth/profile').set('authorization', `Bearer ${users[0]!.token}`);
    const responses = await Promise.all([initialize(), initialize()]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(responses.map(response => response.body.role)).toEqual(['USER', 'USER']);
    expect((await db.collection('users').doc(uid).get()).get('role')).toBe('USER');
  });

  it('returns the same reservation for a repeated idempotency key', async () => {
    const fixtureId = `${eventId}-idempotent`;
    await db.collection('events').doc(fixtureId).set({ id: fixtureId, title: 'Idempotency fixture', titleNormalized: 'idempotency fixture', description: 'Idempotency test event.', category: 'Test', date: new Date(Date.now() + 86_400_000).toISOString(), location: 'Local', imageUrl: '', capacity: 10, available: 10, reserved: 0, status: 'PUBLISHED', managerId: 'manager', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const call = () => request(app).post(`/api/events/${fixtureId}/reservations`).set('authorization', `Bearer ${users[0]!.token}`).set('idempotency-key', 'repeat-this').send({ quantity: 1 });
    const first = await call(); const replay = await call();
    expect(first.status).toBe(201); expect(replay.status).toBe(200);
    expect(replay.body.reservation.id).toBe(first.body.reservation.id);
    expect(replay.body.replayed).toBe(true);
    await db.collection('events').doc(fixtureId).delete();
  });

  it('allows exactly one of two simultaneous requests for the final ticket', async () => {
    const fixtureId = `${eventId}-last-ticket`;
    await db.collection('events').doc(fixtureId).set({ id: fixtureId, title: 'Last ticket fixture', titleNormalized: 'last ticket fixture', description: 'Final ticket race fixture.', category: 'Test', date: new Date(Date.now() + 86_400_000).toISOString(), location: 'Local', imageUrl: '', capacity: 10, available: 1, reserved: 9, status: 'PUBLISHED', managerId: 'manager', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const attempts = await Promise.all(users.slice(0, 2).map(({ token }, index) => request(app).post(`/api/events/${fixtureId}/reservations`).set('authorization', `Bearer ${token}`).set('idempotency-key', `last-ticket-${index}`).send({ quantity: 1 })));
    expect(attempts.filter(response => response.status === 201)).toHaveLength(1);
    expect(attempts.filter(response => response.status === 409)).toHaveLength(1);
    const event = await db.collection('events').doc(fixtureId).get();
    expect(event.get('available')).toBe(0);
    expect(event.get('reserved')).toBe(10);
  });

  it('protects ownership and makes repeated cancellation inventory-safe', async () => {
    const fixtureId = `${eventId}-cancel`;
    await db.collection('events').doc(fixtureId).set({ id: fixtureId, title: 'Cancellation fixture', titleNormalized: 'cancellation fixture', description: 'Cancellation test event.', category: 'Test', date: new Date(Date.now() + 86_400_000).toISOString(), location: 'Local', imageUrl: '', capacity: 10, available: 10, reserved: 0, status: 'PUBLISHED', managerId: 'manager', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const booking = await request(app).post(`/api/events/${fixtureId}/reservations`).set('authorization', `Bearer ${users[0]!.token}`).set('idempotency-key', 'cancel-test').send({ quantity: 2 });
    const id = booking.body.reservation.id as string;
    const forbidden = await request(app).post(`/api/reservations/${id}/cancel`).set('authorization', `Bearer ${users[1]!.token}`);
    expect(forbidden.status).toBe(403);
    expect((await request(app).post(`/api/reservations/${id}/cancel`).set('authorization', `Bearer ${users[0]!.token}`)).status).toBe(200);
    expect((await request(app).post(`/api/reservations/${id}/cancel`).set('authorization', `Bearer ${users[0]!.token}`)).status).toBe(200);
    const event = await db.collection('events').doc(fixtureId).get();
    expect(event.get('available')).toBe(10); expect(event.get('reserved')).toBe(0);
    await db.collection('events').doc(fixtureId).delete();
  });

  it('releases inventory on simulated checkout failure and rejects invalid quantities', async () => {
    const fixtureId = `${eventId}-checkout`;
    await db.collection('events').doc(fixtureId).set({ id: fixtureId, title: 'Checkout fixture', titleNormalized: 'checkout fixture', description: 'Checkout test event.', category: 'Test', date: new Date(Date.now() + 86_400_000).toISOString(), location: 'Local', imageUrl: '', capacity: 10, available: 10, reserved: 0, status: 'PUBLISHED', managerId: 'manager', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const badQuantity = await request(app).post(`/api/events/${fixtureId}/reservations`).set('authorization', `Bearer ${users[0]!.token}`).set('idempotency-key', 'bad-quantity').send({ quantity: 6 });
    expect(badQuantity.status).toBe(400);
    const booking = await request(app).post(`/api/events/${fixtureId}/reservations`).set('authorization', `Bearer ${users[0]!.token}`).set('idempotency-key', 'checkout-failure').send({ quantity: 1 });
    const response = await request(app).post(`/api/reservations/${booking.body.reservation.id}/checkout`).set('authorization', `Bearer ${users[0]!.token}`).send({ simulateFailure: true });
    expect(response.status).toBe(402); expect(response.body.failed).toBe(true);
    const event = await db.collection('events').doc(fixtureId).get();
    expect(event.get('available')).toBe(10); expect(event.get('reserved')).toBe(0);
    await db.collection('events').doc(fixtureId).delete();
  });

  it('creates unique tickets, records retryable email failure, and recovers from injected API failure', async () => {
    const fixtureId = `${eventId}-email`;
    await db.collection('events').doc(fixtureId).set({ id: fixtureId, title: 'Email fixture', titleNormalized: 'email fixture', description: 'Email outbox integration fixture.', category: 'Test', date: new Date(Date.now() + 86_400_000).toISOString(), location: 'Local', imageUrl: '', capacity: 10, available: 10, reserved: 0, status: 'PUBLISHED', managerId: 'manager', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const booking = await request(app).post(`/api/events/${fixtureId}/reservations`).set('authorization', `Bearer ${users[0]!.token}`).set('idempotency-key', 'email-confirmation').send({ quantity: 2 });
    const id = booking.body.reservation.id as string;
    const purchase = await request(app).post(`/api/reservations/${id}/checkout`).set('authorization', `Bearer ${users[0]!.token}`).send({});
    expect(purchase.status).toBe(200); expect(purchase.body.reservation.emailStatus).toBe('QUEUED');
    const tickets = await request(app).get(`/api/reservations/${id}/tickets`).set('authorization', `Bearer ${users[0]!.token}`);
    expect(tickets.status).toBe(200); expect(tickets.body).toHaveLength(2);
    expect(new Set(tickets.body.map((ticket: { code: string }) => ticket.code)).size).toBe(2);
    const email = await request(app).post(`/api/reservations/${id}/email/retry`).set('authorization', `Bearer ${users[0]!.token}`);
    expect(email.status).toBe(200); expect(email.body.emailStatus).toBe('FAILED');

    const activated = await request(app).put('/api/admin/failure-injection').set('authorization', `Bearer ${adminToken}`).send({ mode: 'error' });
    expect(activated.status).toBe(200);
    const unavailable = await request(app).get('/api/events?pageSize=1');
    expect(unavailable.status).toBe(503); expect(unavailable.body.error).toBe('SIMULATED_DATABASE_UNAVAILABLE');
    const reset = await request(app).put('/api/admin/failure-injection').set('authorization', `Bearer ${adminToken}`).send({ mode: 'none' });
    expect(reset.status).toBe(200);
    expect((await request(app).get('/api/events?pageSize=1')).status).toBe(200);
    await request(app).post(`/api/reservations/${id}/cancel`).set('authorization', `Bearer ${users[0]!.token}`);
    await db.collection('events').doc(fixtureId).delete();
  });

  it('prevents event deletion while a reservation is active', async () => {
    const managerUid = (await auth.verifyIdToken(users[0]!.token)).uid;
    await db.collection('users').doc(managerUid).update({ role: 'MANAGER' });
    const body = { title: 'Protected deletion fixture', description: 'Event used to verify active reservation protection.', category: 'Test', date: new Date(Date.now() + 86_400_000).toISOString(), location: 'Local', imageUrl: '', capacity: 10, status: 'PUBLISHED' };
    const created = await request(app).post('/api/events').set('authorization', `Bearer ${users[0]!.token}`).send(body);
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const booking = await request(app).post(`/api/events/${id}/reservations`).set('authorization', `Bearer ${users[1]!.token}`).set('idempotency-key', 'active-delete-test').send({ quantity: 1 });
    const blocked = await request(app).delete(`/api/events/${id}`).set('authorization', `Bearer ${users[0]!.token}`);
    expect(blocked.status).toBe(409);
    await request(app).post(`/api/reservations/${booking.body.reservation.id}/cancel`).set('authorization', `Bearer ${users[1]!.token}`);
    expect((await request(app).delete(`/api/events/${id}`).set('authorization', `Bearer ${users[0]!.token}`)).status).toBe(204);
    await cleanupFixture(id);
  });
});
