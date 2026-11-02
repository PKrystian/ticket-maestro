import { db } from '../firebase.js';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('The oversale fixture can only be reset against the local Firestore emulator.');
const eventId = 'load-oversale-event';
const reservationSnapshot = await db.collection('reservations').where('eventId', '==', eventId).get();
const reservationIds = reservationSnapshot.docs.map(doc => doc.id);
const batches: Array<Promise<unknown>> = [];
let batch = db.batch(); let writes = 0;
async function commitIfFull() { if (writes >= 400) { batches.push(batch.commit()); batch = db.batch(); writes = 0; } }
for (const reservation of reservationSnapshot.docs) {
  const tickets = await db.collection('tickets').where('reservationId', '==', reservation.id).get();
  for (const ticket of tickets.docs) { batch.delete(ticket.ref); writes++; await commitIfFull(); }
  batch.delete(reservation.ref); writes++; await commitIfFull();
}
const idempotency = await db.collection('idempotencyKeys').where('eventId', '==', eventId).get();
for (const key of idempotency.docs) { batch.delete(key.ref); writes++; await commitIfFull(); }
await Promise.all(batches);
const now = new Date().toISOString();
const event = db.collection('events').doc(eventId);
await event.set({ id: eventId, title: 'Eksperyment obciążeniowy — 10 biletów', titleNormalized: 'eksperyment obciążeniowy — 10 biletów', description: 'Deterministyczne wydarzenie do lokalnego eksperymentu współbieżności rezerwacji.', category: 'Technologia', date: new Date(Date.now() + 90 * 86_400_000).toISOString(), location: 'Emulator TicketMaestro', imageUrl: '', capacity: 10, available: 10, reserved: 0, status: 'PUBLISHED', managerId: 'load-fixture', createdAt: now, updatedAt: now, seedKey: 'ticket-maestro-load-fixture-v1' });
if (writes) await batch.commit();
console.log(`Oversale fixture reset. Removed ${reservationIds.length} prior reservations; event ${eventId} has 10 available tickets.`);
