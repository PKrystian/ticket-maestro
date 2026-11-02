import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { z } from 'zod';
import { eventInputSchema, reservationInputSchema } from '@ticket-maestro/shared';
import { config } from './config.js';
import { db } from './firebase.js';
import { requireAuth, requireRole } from './auth.js';
import { ApiError, errorMessage } from './errors.js';
import { createEvent, deleteEvent, getEvent, listEvents, updateEvent } from './services/events.js';
import { cancelReservation, checkout, getTickets, listReservations, reserve, retryEmail } from './services/reservations.js';
import { processEmailJob } from './services/emailJobs.js';
import { verifyEmailTaskToken } from './services/email.js';

const app = express();
let failureInjection: { mode: 'none' | 'latency' | 'error'; latencyMs: number } = { mode: 'none', latencyMs: 0 };
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function requiredParam(req: express.Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || !value) throw new ApiError(400, `Brak parametru ${name}.`, 'INVALID_PATH');
  return value;
}
app.disable('x-powered-by');
app.disable('etag');
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'", 'http://localhost:9099', 'http://127.0.0.1:9099', 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://www.googleapis.com', 'https://*.googleapis.com', 'https://*.firebaseio.com', 'wss://*.firebaseio.com'],
      objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
    }
  }
}));
app.use(cors({ origin: config.webOrigin.split(',').map(value => value.trim()), credentials: false }));
app.use(express.json({ limit: '32kb' }));
app.use(pinoHttp({ redact: ['req.headers.authorization'] }));
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 2000, standardHeaders: 'draft-8', legacyHeaders: false }));
if (config.failureInjectionEnabled) app.use('/api', (req, _res, next) => {
  if (req.path === '/admin/failure-injection' || failureInjection.mode === 'none') return next();
  if (failureInjection.mode === 'error') return next(new ApiError(503, 'Symulowana niedostępność bazy danych.', 'SIMULATED_DATABASE_UNAVAILABLE'));
  setTimeout(next, failureInjection.latencyMs);
});

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
app.get('/readyz', async (_req, res) => {
  try { await db.collection('events').limit(1).get(); res.json({ status: 'ready' }); }
  catch { res.status(503).json({ status: 'not_ready' }); }
});

app.get('/openapi.json', (_req, res, next) => {
  try { res.type('application/json').send(readFileSync(path.join(workspaceRoot, 'apps/api/openapi.json'), 'utf8')); }
  catch (error) { next(error); }
});

app.post('/api/auth/profile', requireAuth, async (req, res, next) => {
  try {
    const user = req.user!;
    const ref = db.collection('users').doc(user.uid);
    const role = await db.runTransaction(async transaction => {
      const existing = await transaction.get(ref);
      if (existing.exists) return String(existing.get('role') ?? 'USER');
      transaction.create(ref, { uid: user.uid, email: user.email, role: 'USER', createdAt: new Date().toISOString() });
      return 'USER';
    });
    res.json({ uid: user.uid, email: user.email, role });
  } catch (error) { next(error); }
});
app.get('/api/me', requireAuth, (req, res) => res.json(req.user));

const eventQuerySchema = z.object({ search: z.string().optional(), category: z.string().optional(), from: z.iso.date().optional(), to: z.iso.date().optional(), sort: z.enum(['date-asc', 'date-desc', 'title']).optional(), page: z.coerce.number().int().positive().optional(), pageSize: z.coerce.number().int().positive().max(48).optional(), cursor: z.string().optional() });
app.get('/api/events', async (req, res, next) => {
  try { const query = eventQuerySchema.parse(req.query); res.json(await listEvents(query)); }
  catch (error) { next(error); }
});
app.get('/api/events/:id', async (req, res, next) => {
  try { const event = await getEvent(requiredParam(req, 'id')); if (event.status !== 'PUBLISHED') throw new ApiError(404, 'Nie znaleziono wydarzenia.', 'NOT_FOUND'); res.json(event); }
  catch (error) { next(error); }
});
app.get('/api/events/:id/availability', async (req, res, next) => {
  try { const event = await getEvent(requiredParam(req, 'id')); if (event.status !== 'PUBLISHED') throw new ApiError(404, 'Nie znaleziono wydarzenia.', 'NOT_FOUND'); res.json({ eventId: event.id, available: event.available, capacity: event.capacity, checkedAt: new Date().toISOString() }); }
  catch (error) { next(error); }
});

app.get('/api/manager/events', requireAuth, requireRole('MANAGER', 'ADMIN'), async (req, res, next) => {
  try {
    const page = eventQuerySchema.parse(req.query).page ?? 1;
    const pageSize = eventQuerySchema.parse(req.query).pageSize ?? 48;
    let query: FirebaseFirestore.Query = req.user!.role === 'ADMIN' ? db.collection('events') : db.collection('events').where('managerId', '==', req.user!.uid);
    const count = await query.count().get();
    const cursorId = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    query = query.orderBy('date', 'asc');
    if (cursorId) { const cursor = await db.collection('events').doc(cursorId).get(); if (cursor.exists) query = query.startAfter(cursor); }
    const rows = await query.limit(pageSize).get();
    const total = count.data().count;
    const hasMore = page * pageSize < total;
    res.json({ items: rows.docs.map(doc => ({ id: doc.id, ...doc.data() })), total, page, pageSize, hasMore, ...(hasMore && rows.docs.length ? { nextCursor: rows.docs[rows.docs.length - 1]!.id } : {}) });
  } catch (error) { next(error); }
});
app.post('/api/events', requireAuth, requireRole('MANAGER', 'ADMIN'), async (req, res, next) => {
  try { const input = eventInputSchema.parse(req.body); res.status(201).json(await createEvent(input, req.user!.uid)); }
  catch (error) { next(error); }
});
app.put('/api/events/:id', requireAuth, requireRole('MANAGER', 'ADMIN'), async (req, res, next) => {
  try { const input = eventInputSchema.parse(req.body); res.json(await updateEvent(requiredParam(req, 'id'), input, req.user!.uid, req.user!.role === 'ADMIN')); }
  catch (error) { next(error); }
});
app.delete('/api/events/:id', requireAuth, requireRole('MANAGER', 'ADMIN'), async (req, res, next) => {
  try { await deleteEvent(requiredParam(req, 'id'), req.user!.uid, req.user!.role === 'ADMIN'); res.status(204).end(); }
  catch (error) { next(error); }
});

app.post('/api/events/:id/reservations', requireAuth, async (req, res, next) => {
  try {
    const { quantity } = reservationInputSchema.parse(req.body);
    const key = req.header('idempotency-key') ?? '';
    const result = await reserve(requiredParam(req, 'id'), { uid: req.user!.uid, email: req.user!.email }, quantity, key);
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { next(error); }
});
app.get('/api/reservations', requireAuth, async (req, res, next) => {
  try { res.json(await listReservations(req.user!.uid)); }
  catch (error) { next(error); }
});
app.post('/api/reservations/:id/checkout', requireAuth, async (req, res, next) => {
  try {
    const forceFailure = !config.production && req.body?.simulateFailure === true;
    const result = await checkout(requiredParam(req, 'id'), req.user!.uid, forceFailure);
    res.status(result.failed ? 402 : 200).json(result);
  } catch (error) { next(error); }
});
app.post('/api/reservations/:id/cancel', requireAuth, async (req, res, next) => {
  try { res.json(await cancelReservation(requiredParam(req, 'id'), req.user!.uid)); }
  catch (error) { next(error); }
});
app.get('/api/reservations/:id/tickets', requireAuth, async (req, res, next) => {
  try { res.json(await getTickets(requiredParam(req, 'id'), req.user!.uid)); }
  catch (error) { next(error); }
});
app.post('/api/reservations/:id/email/retry', requireAuth, async (req, res, next) => {
  try { res.json(await retryEmail(requiredParam(req, 'id'), req.user!.uid)); }
  catch (error) { next(error); }
});
if (config.tasksEnabled) app.post('/api/internal/email-jobs/:id', async (req, res, next) => {
  try {
    if (!await verifyEmailTaskToken(req.header('authorization'))) throw new ApiError(401, 'Wymagane jest uwierzytelnienie zadania e-mail.', 'INVALID_TASK_IDENTITY');
    const status = await processEmailJob(requiredParam(req, 'id'));
    if (status === 'FAILED' || status === 'PROCESSING' || status === 'QUEUED' || status === 'NOT_REQUESTED') {
      res.status(503).json({ status, message: 'Zadanie e-mail może zostać ponowione.' });
      return;
    }
    res.json({ status });
  } catch (error) { next(error); }
});

app.get('/api/admin/stats', requireAuth, requireRole('ADMIN'), async (_req, res, next) => {
  try {
    const [users, events, reservations, confirmed, cancelled, eventRows] = await Promise.all([
      db.collection('users').count().get(), db.collection('events').count().get(), db.collection('reservations').count().get(),
      db.collection('reservations').where('status', '==', 'CONFIRMED').count().get(), db.collection('reservations').where('status', '==', 'CANCELLED').count().get(),
      db.collection('events').select('reserved', 'capacity', 'title', 'date', 'available').limit(10000).get()
    ]);
    const metrics = eventRows.docs.map(doc => ({ id: doc.id, title: doc.get('title'), date: doc.get('date'), reserved: Number(doc.get('reserved') ?? 0), available: Number(doc.get('available') ?? 0), capacity: Number(doc.get('capacity') ?? 0) }));
    const totalCapacity = metrics.reduce((sum, event) => sum + event.capacity, 0);
    const ticketsReserved = metrics.reduce((sum, event) => sum + event.reserved, 0);
    res.json({ totalUsers: users.data().count, totalEvents: events.data().count, totalReservations: reservations.data().count, confirmedReservations: confirmed.data().count, cancelledReservations: cancelled.data().count, ticketsReserved, totalCapacity, occupancy: totalCapacity ? ticketsReserved / totalCapacity : 0, popularEvents: metrics.sort((a, b) => b.reserved - a.reserved).slice(0, 5), eventStats: metrics.slice(0, 20) });
  } catch (error) { next(error); }
});

if (config.failureInjectionEnabled) app.put('/api/admin/failure-injection', requireAuth, requireRole('ADMIN'), (req, res, next) => {
  const parsed = z.object({ mode: z.enum(['none', 'latency', 'error']), latencyMs: z.coerce.number().int().min(0).max(30_000).optional() }).safeParse(req.body);
  if (!parsed.success) return next(parsed.error);
  failureInjection = { mode: parsed.data.mode, latencyMs: parsed.data.mode === 'latency' ? parsed.data.latencyMs ?? 1000 : 0 };
  res.json({ enabled: true, ...failureInjection });
});

const webDist = path.resolve(workspaceRoot, 'apps/web/dist');
app.use('/api', (_req, _res, next) => next(new ApiError(404, 'Nie znaleziono endpointu.', 'NOT_FOUND')));
app.use(express.static(webDist, { index: false, maxAge: config.production ? '1h' : 0 }));
app.get('*splat', (_req, res, next) => {
  res.sendFile(path.join(webDist, 'index.html'), error => { if (error) next(); });
});
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const apiError = error instanceof ApiError ? error : null;
  const status = apiError?.status ?? (error instanceof z.ZodError ? 400 : 500);
  const message = apiError?.message ?? (error instanceof z.ZodError ? 'Dane formularza są nieprawidłowe.' : 'Wystąpił błąd serwera. Spróbuj ponownie później.');
  if (!apiError && !(error instanceof z.ZodError)) req.log.error({ err: errorMessage(error) }, 'request failed');
  res.status(status).json({ error: apiError?.code ?? (status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'), message });
});

export { app };
