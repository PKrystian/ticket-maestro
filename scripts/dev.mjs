import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const env = { ...process.env, NODE_ENV: 'development', ENABLE_FAILURE_INJECTION: process.env.ENABLE_FAILURE_INJECTION ?? 'true', FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? 'ticket-maestro-local', FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8081' };
const children = [];
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const emulator = spawn(pnpm, ['exec', 'firebase', 'emulators:start', '--project', env.FIREBASE_PROJECT_ID, '--only', 'auth,firestore'], { stdio: 'inherit', env });
children.push(emulator);
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}
async function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`);
}
try {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !stopping && emulator.exitCode === null) {
    const [authReady, firestoreReady] = await Promise.all([portOpen(9099), portOpen(8081)]);
    if (authReady && firestoreReady) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (stopping) process.exit(0);
  if (emulator.exitCode !== null) throw new Error('Firebase emulators exited before becoming ready.');
  if (!(await portOpen(9099)) || !(await portOpen(8081))) throw new Error('Timed out waiting for Firebase emulators.');
  await run(pnpm, ['--filter', '@ticket-maestro/shared', 'build']);
  await run(pnpm, ['--filter', '@ticket-maestro/api', 'seed']);
  for (const [name, args] of [['api', ['--filter', '@ticket-maestro/api', 'dev']], ['web', ['--filter', '@ticket-maestro/web', 'dev']], ['email-worker', ['--filter', '@ticket-maestro/api', 'worker:email']]]) {
    const child = spawn(pnpm, args, { stdio: 'inherit', env: { ...env, NODE_ENV: 'development' } });
    child.name = name;
    children.push(child);
  }
  await new Promise(resolve => {
    for (const child of children) child.once('exit', () => { if (!stopping) { stop(); resolve(); } });
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  stop();
  process.exitCode = 1;
}
