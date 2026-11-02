import { FieldPath, type DocumentData } from 'firebase-admin/firestore';
import type { EventInput, EventRecord, Page } from '@ticket-maestro/shared';
import { db } from '../firebase.js';
import { ApiError } from '../errors.js';

function toEvent(id: string, data: DocumentData): EventRecord {
  return { ...data, id } as EventRecord;
}

export async function listEvents(query: { search?: string | undefined; category?: string | undefined; from?: string | undefined; to?: string | undefined; sort?: string | undefined; page?: number | undefined; pageSize?: number | undefined; cursor?: string | undefined; status?: string | undefined }): Promise<Page<EventRecord>> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, query.pageSize ?? 12));
  let ref: FirebaseFirestore.Query = db.collection('events');
  ref = ref.where('status', '==', query.status ?? 'PUBLISHED');
  if (query.category) ref = ref.where('category', '==', query.category);
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : null;
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : null;
  if (from && !Number.isNaN(from.valueOf())) ref = ref.where('date', '>=', from.toISOString());
  if (to && !Number.isNaN(to.valueOf())) ref = ref.where('date', '<=', to.toISOString());
  const search = query.search?.trim().toLocaleLowerCase('pl-PL');
  if (search) ref = ref.where('titleNormalized', '>=', search).where('titleNormalized', '<=', `${search}\uf8ff`);
  const order = query.sort === 'date-desc' ? 'desc' : 'asc';
  const hasSearch = Boolean(search);
  ref = ref.orderBy(hasSearch || query.sort === 'title' ? 'titleNormalized' : 'date', order);
  if (hasSearch && (from || to)) ref = ref.orderBy('date', order);
  ref = ref.orderBy(FieldPath.documentId());
  const count = await ref.count().get();
  if (query.cursor) {
    const cursor = await db.collection('events').doc(query.cursor).get();
    if (cursor.exists) ref = ref.startAfter(cursor);
  }
  const snapshot = await ref.limit(pageSize).get();
  const total = count.data().count;
  const hasMore = page * pageSize < total;
  return { items: snapshot.docs.map(doc => toEvent(doc.id, doc.data())), page, pageSize, total, hasMore, ...(hasMore && snapshot.docs.length ? { nextCursor: snapshot.docs[snapshot.docs.length - 1]!.id } : {}) };
}

export async function getEvent(id: string): Promise<EventRecord> {
  const doc = await db.collection('events').doc(id).get();
  if (!doc.exists) throw new ApiError(404, 'Nie znaleziono wydarzenia.', 'NOT_FOUND');
  return toEvent(doc.id, doc.data()!);
}

export async function createEvent(input: EventInput, managerId: string): Promise<EventRecord> {
  const now = new Date().toISOString();
  const ref = db.collection('events').doc();
  const record = { ...input, id: ref.id, titleNormalized: input.title.toLocaleLowerCase('pl-PL'), available: input.capacity, reserved: 0, managerId, createdAt: now, updatedAt: now };
  await ref.create(record);
  return record;
}

export async function updateEvent(id: string, input: EventInput, actorId: string, isAdmin: boolean): Promise<EventRecord> {
  const ref = db.collection('events').doc(id);
  return db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new ApiError(404, 'Nie znaleziono wydarzenia.', 'NOT_FOUND');
    const current = doc.data()! as EventRecord;
    if (!isAdmin && current.managerId !== actorId) throw new ApiError(403, 'Możesz edytować tylko swoje wydarzenia.', 'FORBIDDEN');
    const active = await tx.get(db.collection('reservations').where('eventId', '==', id).where('status', 'in', ['PENDING_PAYMENT', 'CONFIRMED']));
    const confirmedTickets = active.docs.filter(reservation => reservation.get('status') === 'CONFIRMED').reduce((sum, reservation) => sum + Number(reservation.get('quantity') ?? 0), 0);
    if (input.capacity < confirmedTickets || input.capacity < current.reserved) throw new ApiError(409, 'Nowa pojemność nie może być mniejsza od aktywnych rezerwacji.', 'CAPACITY_CONFLICT');
    if (input.status === 'CANCELLED' && !active.empty) throw new ApiError(409, 'Najpierw anuluj aktywne rezerwacje, aby odwołać wydarzenie.', 'ACTIVE_RESERVATIONS');
    const updated = { ...current, ...input, titleNormalized: input.title.toLocaleLowerCase('pl-PL'), available: input.capacity - current.reserved, updatedAt: new Date().toISOString() };
    tx.set(ref, updated);
    return updated;
  });
}

export async function deleteEvent(id: string, actorId: string, isAdmin: boolean): Promise<void> {
  const ref = db.collection('events').doc(id);
  await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new ApiError(404, 'Nie znaleziono wydarzenia.', 'NOT_FOUND');
    const current = doc.data()!;
    if (!isAdmin && current.managerId !== actorId) throw new ApiError(403, 'Możesz usuwać tylko swoje wydarzenia.', 'FORBIDDEN');
    const active = await tx.get(db.collection('reservations').where('eventId', '==', id).where('status', 'in', ['PENDING_PAYMENT', 'CONFIRMED']));
    if (!active.empty) throw new ApiError(409, 'Nie można usunąć wydarzenia z aktywnymi rezerwacjami.', 'ACTIVE_RESERVATIONS');
    tx.delete(ref);
  });
}
