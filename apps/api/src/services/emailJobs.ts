import type { DocumentData } from 'firebase-admin/firestore';
import type { EmailStatus, ReservationRecord } from '@ticket-maestro/shared';
import { db } from '../firebase.js';
import { ApiError } from '../errors.js';
import { sendConfirmation } from './email.js';

interface EmailJob { status: EmailStatus | 'PROCESSING' | 'CANCELLED'; attempts: number; nextAttemptAt: string; leaseUntil?: number; retryVersion: number }
function reservationRecord(id: string, data: DocumentData): ReservationRecord { return { ...data, id } as ReservationRecord; }

export async function processEmailJob(id: string): Promise<EmailStatus | 'PROCESSING' | 'CANCELLED'> {
  const jobRef = db.collection('emailJobs').doc(id);
  const reservationRef = db.collection('reservations').doc(id);
  const claim = await db.runTransaction(async tx => {
    const [jobDoc, reservationDoc] = await Promise.all([tx.get(jobRef), tx.get(reservationRef)]);
    if (!jobDoc.exists || !reservationDoc.exists) throw new ApiError(404, 'Nie znaleziono potwierdzenia do wysłania.', 'EMAIL_JOB_NOT_FOUND');
    const job = jobDoc.data() as EmailJob;
    const reservation = reservationRecord(reservationDoc.id, reservationDoc.data()!);
    if (['SENT', 'SIMULATED', 'CANCELLED'].includes(job.status)) return { status: job.status, reservation: null, attempt: job.attempts };
    if (reservation.status !== 'CONFIRMED') {
      tx.update(jobRef, { status: 'CANCELLED', updatedAt: new Date().toISOString() });
      return { status: 'CANCELLED', reservation: null, attempt: job.attempts };
    }
    const nowMs = Date.now(); const now = new Date(nowMs).toISOString();
    if (job.nextAttemptAt && job.nextAttemptAt > now) return { status: job.status, reservation: null, attempt: job.attempts };
    if (job.status === 'PROCESSING' && Number(job.leaseUntil ?? 0) > nowMs) return { status: 'PROCESSING', reservation: null, attempt: job.attempts };
    const attempt = Number(job.attempts ?? 0) + 1;
    tx.update(jobRef, { status: 'PROCESSING', attempts: attempt, leaseUntil: nowMs + 60_000, nextAttemptAt: now, updatedAt: now });
    return { status: 'PROCESSING', reservation, attempt };
  });
  if (!claim.reservation) return claim.status as EmailStatus | 'PROCESSING' | 'CANCELLED';

  const ticketsSnapshot = await db.collection('tickets').where('reservationId', '==', id).get();
  const codes = ticketsSnapshot.docs.filter(ticket => ticket.get('status') !== 'CANCELLED').map(ticket => String(ticket.get('code')));
  const result = await sendConfirmation({ email: claim.reservation.email, eventTitle: claim.reservation.eventTitle, codes, reservationId: id });
  const now = new Date().toISOString();
  const retryDelaySeconds = Math.min(300, 2 ** Math.min(claim.attempt, 8));
  const nextAttemptAt = result === 'FAILED' ? new Date(Date.now() + retryDelaySeconds * 1000).toISOString() : now;
  await db.runTransaction(async tx => {
    const currentJob = await tx.get(jobRef);
    const currentReservation = await tx.get(reservationRef);
    if (!currentJob.exists || !currentReservation.exists) throw new ApiError(404, 'Nie znaleziono potwierdzenia do aktualizacji.', 'EMAIL_JOB_NOT_FOUND');
    if (currentJob.get('status') !== 'PROCESSING') return;
    tx.update(jobRef, { status: result, nextAttemptAt, leaseUntil: null, updatedAt: now, ...(result === 'FAILED' ? { lastError: 'SMTP delivery failed' } : { lastError: null }) });
    tx.update(reservationRef, { emailStatus: result, updatedAt: now });
  });
  return result;
}

export async function listRetryableEmailJobs(limit = 20): Promise<string[]> {
  const now = new Date().toISOString(); const nowMs = Date.now();
  const [queued, expired] = await Promise.all([
    db.collection('emailJobs').where('status', 'in', ['QUEUED', 'FAILED']).where('nextAttemptAt', '<=', now).orderBy('nextAttemptAt', 'asc').limit(limit).get(),
    db.collection('emailJobs').where('status', '==', 'PROCESSING').where('leaseUntil', '<=', nowMs).orderBy('leaseUntil', 'asc').limit(limit).get()
  ]);
  return [...queued.docs, ...expired.docs].map(doc => doc.id).slice(0, limit);
}
