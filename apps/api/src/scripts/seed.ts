import { auth, db } from '../firebase.js';
import type { EventInput } from '@ticket-maestro/shared';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Seed is restricted to local Firebase emulators. Set both emulator host variables.');
}

const now = Date.now();
const future = (days: number) => new Date(now + days * 86_400_000).toISOString();
const demoEvents: Array<{ id: string; input: EventInput }> = [
  { id: 'koncert-na-stadionie', input: { title: 'Noc Świateł — koncert na Stadionie', description: 'Największe polskie głosy, spektakularna scena i wieczór pełen muzyki. Bramy otwierają się dwie godziny przed koncertem.', category: 'Muzyka', date: future(30), location: 'Enea Stadion, Poznań', imageUrl: '', capacity: 10, status: 'PUBLISHED' } },
  { id: 'load-oversale-event', input: { title: 'Eksperyment obciążeniowy — 10 biletów', description: 'Deterministyczne wydarzenie do lokalnego eksperymentu współbieżności rezerwacji.', category: 'Technologia', date: future(90), location: 'Emulator TicketMaestro', imageUrl: '', capacity: 10, status: 'PUBLISHED' } },
  { id: 'jazz-nad-warta', input: { title: 'Jazz nad Wartą', description: 'Kameralny koncert jazzowy w industrialnej przestrzeni nad rzeką. W programie standardy i autorskie kompozycje.', category: 'Muzyka', date: future(18), location: 'KontenerART, Poznań', imageUrl: '', capacity: 240, status: 'PUBLISHED' } },
  { id: 'design-meetup', input: { title: 'Design Systems Meetup', description: 'Praktyczne spotkanie o projektowaniu, dostępności i skalowaniu systemów designu. Wstęp obejmuje warsztat i przerwę kawową.', category: 'Technologia', date: future(12), location: 'Concordia Design, Poznań', imageUrl: '', capacity: 80, status: 'PUBLISHED' } },
  { id: 'kino-pod-gwiazdami', input: { title: 'Kino pod gwiazdami', description: 'Letni seans plenerowy z leżakami i strefą gastronomiczną. Tytuł filmu ogłaszamy tydzień przed wydarzeniem.', category: 'Kultura', date: future(45), location: 'Park Cytadela, Poznań', imageUrl: '', capacity: 500, status: 'PUBLISHED' } },
  { id: 'bieg-miejski', input: { title: 'Poznański Bieg Miejski 10K', description: 'Dziesięć kilometrów przez centrum miasta. Pakiet startowy, pomiar czasu i medal na mecie.', category: 'Sport', date: future(60), location: 'Plac Wolności, Poznań', imageUrl: '', capacity: 3000, status: 'PUBLISHED' } },
  { id: 'startup-summit', input: { title: 'Startup Summit Wielkopolska', description: 'Dzień rozmów o przedsiębiorczości, inwestycjach i budowaniu produktów. Scena główna, sesje mentoringowe i networking.', category: 'Biznes', date: future(25), location: 'Międzynarodowe Targi Poznańskie', imageUrl: '', capacity: 1200, status: 'PUBLISHED' } },
  { id: 'warsztaty-fotograficzne', input: { title: 'Warsztaty fotografii ulicznej', description: 'Spacer fotograficzny z praktycznymi ćwiczeniami kompozycji i światła. Zabierz własny aparat lub telefon.', category: 'Warsztaty', date: future(8), location: 'Stary Rynek, Poznań', imageUrl: '', capacity: 16, status: 'PUBLISHED' } },
  { id: 'festiwal-miejski', input: { title: 'Festiwal Miejski 2027', description: 'Weekend koncertów, lokalnego jedzenia, sztuki i aktywności dla całej rodziny.', category: 'Festiwal', date: future(150), location: 'Park Jana Pawła II, Poznań', imageUrl: '', capacity: 20000, status: 'PUBLISHED' } }
];

async function ensureDemoUser(email: string, password: string, role: 'USER' | 'MANAGER' | 'ADMIN') {
  let user;
  try { user = await auth.getUserByEmail(email); }
  catch { user = await auth.createUser({ email, password, displayName: role === 'ADMIN' ? 'Administrator' : role === 'MANAGER' ? 'Organizator' : 'Użytkownik demo' }); }
  await db.collection('users').doc(user.uid).set({ uid: user.uid, email, role, createdAt: new Date().toISOString() }, { merge: true });
}

await Promise.all([
  ensureDemoUser('admin@ticketmaestro.local', 'TicketMaestro123!', 'ADMIN'),
  ensureDemoUser('manager@ticketmaestro.local', 'TicketMaestro123!', 'MANAGER'),
  ensureDemoUser('user@ticketmaestro.local', 'TicketMaestro123!', 'USER')
]);

const loadUserCountArg = process.argv.find(argument => argument.startsWith('--load-users='));
const loadUserCount = loadUserCountArg ? Number(loadUserCountArg.split('=')[1]) : 0;
if (loadUserCount > 0) {
  if (!Number.isInteger(loadUserCount) || loadUserCount > 500) throw new Error('Load user count must be an integer from 1 to 500.');
  for (let offset = 1; offset <= loadUserCount; offset += 25) {
    await Promise.all(Array.from({ length: Math.min(25, loadUserCount - offset + 1) }, (_, index) => {
      const id = String(offset + index).padStart(4, '0');
      return ensureDemoUser(`load-${id}@ticketmaestro.local`, 'TicketMaestro123!', 'USER');
    }));
  }
}

const manager = await auth.getUserByEmail('manager@ticketmaestro.local');
for (const { id, input } of demoEvents) {
  const ref = db.collection('events').doc(id);
  const current = await ref.get();
  if (!current.exists) {
    await ref.create({ ...input, id, titleNormalized: input.title.toLocaleLowerCase('pl-PL'), available: input.capacity, reserved: 0, managerId: manager.uid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), seedKey: 'ticket-maestro-demo-v1' });
  }
}

if (process.argv.includes('--large')) {
  const count = 10_000 - demoEvents.length;
  for (let offset = 0; offset < count; offset += 400) {
    const rows = Array.from({ length: Math.min(400, count - offset) }, (_, index) => {
      const eventNumber = offset + index + 1;
      const capacity = [10, 80, 500, 3000, 20000][(eventNumber - 1) % 5]!;
      const id = `generated-${String(eventNumber).padStart(5, '0')}`;
      return {
        ref: db.collection('events').doc(id),
        data: { id, title: `Demonstracja skalowania ${eventNumber}`, titleNormalized: `demonstracja skalowania ${eventNumber}`, description: 'Deterministyczne wydarzenie testowe do eksperymentów z paginacją.', category: ['Muzyka', 'Technologia', 'Kultura', 'Sport'][(eventNumber - 1) % 4]!, date: future((eventNumber - 1) % 300 + 1), location: 'Poznań', imageUrl: '', capacity, available: capacity, reserved: 0, status: 'PUBLISHED', managerId: manager.uid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), seedKey: 'ticket-maestro-generated-v1' }
      };
    });
    const existing = await db.getAll(...rows.map(row => row.ref));
    const batch = db.batch();
    existing.forEach((snapshot, index) => { if (!snapshot.exists) batch.create(snapshot.ref, rows[index]!.data); });
    if (existing.some(snapshot => !snapshot.exists)) await batch.commit();
  }
}
console.log(`Seed complete: ${3 + loadUserCount} demo users, ${demoEvents.length} base events${process.argv.includes('--large') ? ' plus generated scale dataset' : ''}.`);
