import { createHash, randomUUID } from 'node:crypto';
import type { DocumentData } from 'firebase-admin/firestore';
import type { ReservationRecord, TicketRecord } from '@ticket-maestro/shared';
import { db } from '../firebase.js';
import { ApiError } from '../errors.js';
import { config } from '../config.js';
import { enqueueEmailJob } from './email.js';
import { processEmailJob } from './emailJobs.js';

function asReservation(id: string, data: DocumentData): ReservationRecord { return { ...data, id } as ReservationRecord; }

function idempotencyDocId(uid: string, key: string) {
  return createHash('sha256').update(`${uid}:${key}`).digest('hex');
}

export async function reserve(eventId: string, user: { uid: string; email: string }, quantity: number, key: string): Promise<{ reservation: ReservationRecord; replayed: boolean }> {
  if (!key || key.length > 160) throw new ApiError(400, 'Wymagany jest poprawny klucz idempotencji.', 'INVALID_IDEMPOTENCY_KEY');
  const eventRef = db.collection('events').doc(eventId);
  const reservationRef = db.collection('reservations').doc();
  const keyRef = db.collection('idempotencyKeys').doc(idempotencyDocId(user.uid, key));
  return db.runTransaction(async tx => {
    const [keyDoc, eventDoc] = await Promise.all([tx.get(keyRef), tx.get(eventRef)]);
    if (keyDoc.exists) {
      const existing = await tx.get(db.collection('reservations').doc(String(keyDoc.get('reservationId'))));
      if (!existing.exists) throw new ApiError(500, 'Nie można odtworzyć wcześniejszej rezerwacji.', 'IDEMPOTENCY_RECORD_MISSING');
      const record = asReservation(existing.id, existing.data()!);
      if (record.eventId !== eventId || record.quantity !== quantity) throw new ApiError(409, 'Ten klucz został już użyty dla innych danych.', 'IDEMPOTENCY_CONFLICT');
      return { reservation: record, replayed: true };
    }
    if (!eventDoc.exists) throw new ApiError(404, 'Nie znaleziono wydarzenia.', 'NOT_FOUND');
    const event = eventDoc.data()!;
    if (event.status !== 'PUBLISHED') throw new ApiError(409, 'To wydarzenie nie przyjmuje rezerwacji.', 'EVENT_UNAVAILABLE');
    if (new Date(String(event.date)).getTime() < Date.now()) throw new ApiError(409, 'Wydarzenie już się odbyło.', 'EVENT_PAST');
    const available = Number(event.available);
    if (available < quantity) throw new ApiError(409, `Pozostało tylko ${available} biletów.`, 'INSUFFICIENT_INVENTORY');
    const now = new Date().toISOString();
    const reservation: ReservationRecord = {
      id: reservationRef.id, eventId, eventTitle: String(event.title), eventDate: String(event.date),
      userId: user.uid, email: user.email, quantity, status: 'PENDING_PAYMENT', ticketIds: [],
      emailStatus: 'NOT_REQUESTED', idempotencyKey: key, createdAt: now, updatedAt: now
    };
    tx.update(eventRef, { available: available - quantity, reserved: Number(event.reserved) + quantity, updatedAt: now });
    tx.create(reservationRef, reservation);
    tx.create(keyRef, { userId: user.uid, reservationId: reservation.id, eventId, quantity, createdAt: now });
    return { reservation, replayed: false };
  });
}

export async function listReservations(userId: string): Promise<ReservationRecord[]> {
  const result = await db.collection('reservations').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(100).get();
  return result.docs.map(doc => asReservation(doc.id, doc.data()));
}

export async function checkout(id: string, userId: string, forceFailure = false): Promise<{ reservation: ReservationRecord; failed: boolean }> {
  const ref = db.collection('reservations').doc(id);
  const result = await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new ApiError(404, 'Nie znaleziono rezerwacji.', 'NOT_FOUND');
    const current = asReservation(doc.id, doc.data()!);
    if (current.userId !== userId) throw new ApiError(403, 'To nie jest Twoja rezerwacja.', 'FORBIDDEN');
    if (current.status === 'CONFIRMED') return { reservation: current, failed: false };
    if (current.status !== 'PENDING_PAYMENT') throw new ApiError(409, 'Ta rezerwacja nie oczekuje na płatność.', 'CHECKOUT_NOT_AVAILABLE');
    const now = new Date().toISOString();
    if (forceFailure) {
      const eventRef = db.collection('events').doc(current.eventId);
      const eventDoc = await tx.get(eventRef);
      if (!eventDoc.exists) throw new ApiError(500, 'Nie można zwolnić biletów rezerwacji.', 'EVENT_MISSING');
      const event = eventDoc.data()!;
      tx.update(eventRef, { available: Number(event.available) + current.quantity, reserved: Math.max(0, Number(event.reserved) - current.quantity), updatedAt: now });
      const failed = { ...current, status: 'PAYMENT_FAILED' as const, updatedAt: now };
      tx.update(ref, failed);
      return { reservation: failed, failed: true };
    }
    const tickets: TicketRecord[] = Array.from({ length: current.quantity }, () => ({
      id: randomUUID(), reservationId: id, eventId: current.eventId, ownerId: current.userId,
      code: `TM-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`, createdAt: now
    }));
    for (const ticket of tickets) tx.create(db.collection('tickets').doc(ticket.id), ticket);
    const confirmed: ReservationRecord = { ...current, status: 'CONFIRMED', ticketIds: tickets.map(ticket => ticket.id), emailStatus: 'QUEUED', updatedAt: now };
    tx.update(ref, { status: confirmed.status, ticketIds: confirmed.ticketIds, updatedAt: confirmed.updatedAt });
    tx.update(ref, { emailStatus: confirmed.emailStatus });
    tx.create(db.collection('emailJobs').doc(id), { reservationId: id, status: 'QUEUED', attempts: 0, retryVersion: 0, nextAttemptAt: now, createdAt: now, updatedAt: now });
    return { reservation: confirmed, failed: false };
  });

  if (result.failed) return result;
  if (result.reservation.status === 'CONFIRMED' && result.reservation.emailStatus === 'QUEUED') {
    const job = await db.collection('emailJobs').doc(id).get();
    try { await enqueueEmailJob(id, Number(job.get('retryVersion') ?? 0)); }
    catch (error) { console.error(JSON.stringify({ level: 'error', message: 'Cloud Tasks dispatch failed; outbox remains retryable', reservationId: id, error: error instanceof Error ? error.message : 'unknown' })); }
  }
  return result;
}

export async function cancelReservation(id: string, userId: string): Promise<ReservationRecord> {
  const ref = db.collection('reservations').doc(id);
  return db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new ApiError(404, 'Nie znaleziono rezerwacji.', 'NOT_FOUND');
    const current = asReservation(doc.id, doc.data()!);
    if (current.userId !== userId) throw new ApiError(403, 'Możesz anulować tylko własne rezerwacje.', 'FORBIDDEN');
    if (current.status === 'CANCELLED') return current;
    if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(current.status)) throw new ApiError(409, 'Ta rezerwacja nie może zostać anulowana.', 'CANCELLATION_NOT_AVAILABLE');
    if (new Date(current.eventDate).getTime() <= Date.now()) throw new ApiError(409, 'Nie można anulować rezerwacji po rozpoczęciu wydarzenia.', 'EVENT_PAST');
    const eventRef = db.collection('events').doc(current.eventId);
    const emailJobRef = db.collection('emailJobs').doc(id);
    const [eventDoc, emailJobDoc, ...ticketDocs] = await Promise.all([tx.get(eventRef), tx.get(emailJobRef), ...current.ticketIds.map(ticketId => tx.get(db.collection('tickets').doc(ticketId)))]);
    if (!eventDoc.exists) throw new ApiError(500, 'Nie można zwolnić biletów rezerwacji.', 'EVENT_MISSING');
    if (emailJobDoc.exists && emailJobDoc.get('status') === 'PROCESSING') throw new ApiError(409, 'Potwierdzenie jest właśnie wysyłane. Spróbuj anulować za chwilę.', 'EMAIL_IN_PROGRESS');
    const event = eventDoc.data()!;
    const now = new Date().toISOString();
    const emailStatus = emailJobDoc.exists && ['QUEUED', 'FAILED'].includes(String(emailJobDoc.get('status'))) ? 'NOT_REQUESTED' : current.emailStatus;
    const cancelled: ReservationRecord = { ...current, status: 'CANCELLED', emailStatus, updatedAt: now };
    tx.update(eventRef, { available: Math.min(Number(event.capacity), Number(event.available) + current.quantity), reserved: Math.max(0, Number(event.reserved) - current.quantity), updatedAt: now });
    tx.update(ref, { status: cancelled.status, updatedAt: cancelled.updatedAt });
    if (cancelled.emailStatus !== current.emailStatus) tx.update(ref, { emailStatus: cancelled.emailStatus });
    if (emailJobDoc.exists && ['QUEUED', 'FAILED'].includes(String(emailJobDoc.get('status')))) tx.update(emailJobRef, { status: 'CANCELLED', updatedAt: now });
    for (const ticketDoc of ticketDocs) if (ticketDoc.exists) tx.update(ticketDoc.ref, { status: 'CANCELLED' });
    return cancelled;
  });
}

export async function getTickets(id: string, userId: string): Promise<Array<TicketRecord & { status?: string }>> {
  const reservation = await db.collection('reservations').doc(id).get();
  if (!reservation.exists) throw new ApiError(404, 'Nie znaleziono rezerwacji.', 'NOT_FOUND');
  if (reservation.get('userId') !== userId) throw new ApiError(403, 'To nie jest Twoja rezerwacja.', 'FORBIDDEN');
  if (reservation.get('status') !== 'CONFIRMED') throw new ApiError(409, 'Bilety będą dostępne po potwierdzeniu zakupu.', 'TICKETS_NOT_READY');
  const tickets = await db.collection('tickets').where('reservationId', '==', id).get();
  return tickets.docs.map(doc => ({ id: doc.id, ...doc.data() } as TicketRecord & { status?: string }));
}

export async function retryEmail(id: string, userId: string): Promise<ReservationRecord> {
  const ref = db.collection('reservations').doc(id);
  const queued = await db.runTransaction(async tx => {
    const jobRef = db.collection('emailJobs').doc(id);
    const [snapshot, job] = await Promise.all([tx.get(ref), tx.get(jobRef)]);
    if (!snapshot.exists) throw new ApiError(404, 'Nie znaleziono rezerwacji.', 'NOT_FOUND');
    const reservation = asReservation(snapshot.id, snapshot.data()!);
    if (reservation.userId !== userId) throw new ApiError(403, 'To nie jest Twoja rezerwacja.', 'FORBIDDEN');
    if (reservation.status !== 'CONFIRMED') throw new ApiError(409, 'Potwierdzenie jest dostępne dopiero po zakupie.', 'CHECKOUT_NOT_COMPLETE');
    if (job.exists && job.get('status') === 'PROCESSING') throw new ApiError(409, 'Potwierdzenie jest właśnie wysyłane. Spróbuj za chwilę.', 'EMAIL_IN_PROGRESS');
    const retryVersion = Number(job.get('retryVersion') ?? 0) + 1;
    const now = new Date().toISOString();
    if (job.exists) tx.update(jobRef, { status: 'QUEUED', nextAttemptAt: now, leaseUntil: null, retryVersion, updatedAt: now });
    else tx.create(jobRef, { reservationId: id, status: 'QUEUED', attempts: 0, nextAttemptAt: now, retryVersion, createdAt: now, updatedAt: now });
    tx.update(ref, { emailStatus: 'QUEUED', updatedAt: now });
    return { reservation: { ...reservation, emailStatus: 'QUEUED' as const, updatedAt: now }, retryVersion };
  });
  if (config.tasksEnabled) {
    try { await enqueueEmailJob(id, queued.retryVersion); }
    catch (error) { console.error(JSON.stringify({ level: 'error', message: 'Cloud Tasks retry dispatch failed; outbox remains retryable', reservationId: id, error: error instanceof Error ? error.message : 'unknown' })); }
    return queued.reservation;
  }
  const emailStatus = await processEmailJob(id);
  const latest = await ref.get();
  return { ...queued.reservation, ...(latest.data() ?? {}), id, emailStatus: emailStatus === 'PROCESSING' || emailStatus === 'CANCELLED' ? 'QUEUED' : emailStatus } as ReservationRecord;
}
