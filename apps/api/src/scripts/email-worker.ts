import { listRetryableEmailJobs, processEmailJob } from '../services/emailJobs.js';

if (!process.env.FIRESTORE_EMULATOR_HOST && process.env.NODE_ENV === 'production') {
  throw new Error('The polling email worker must not run inside a request-based Cloud Run service. Use the optional Cloud Tasks integration instead.');
}
const pollMs = Math.max(250, Number(process.env.EMAIL_WORKER_POLL_MS ?? 1500));
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
console.log(JSON.stringify({ level: 'info', message: 'TicketMaestro local email outbox worker started', pollMs }));
while (!stopping) {
  try {
    const jobs = await listRetryableEmailJobs();
    await Promise.all(jobs.map(async id => {
      try { await processEmailJob(id); }
      catch (error) { console.error(JSON.stringify({ level: 'error', message: 'Email job processing failed', reservationId: id, error: error instanceof Error ? error.message : 'unknown' })); }
    }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'Email outbox scan failed', error: error instanceof Error ? error.message : 'unknown' }));
  }
  await new Promise(resolve => setTimeout(resolve, pollMs));
}
console.log(JSON.stringify({ level: 'info', message: 'TicketMaestro local email outbox worker stopped' }));
