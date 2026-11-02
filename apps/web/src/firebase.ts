import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? 'fake-api-key',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'localhost',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'ticket-maestro-local'
});
export const auth = getAuth(app);
const emulatorUrl = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? (!import.meta.env.PROD ? 'http://127.0.0.1:9099' : undefined);
if (emulatorUrl) connectAuthEmulator(auth, emulatorUrl, { disableWarnings: true });
