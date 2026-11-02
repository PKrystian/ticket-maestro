import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from './config.js';

process.env.GCLOUD_PROJECT ??= config.projectId;
if (config.authEmulator) process.env.FIREBASE_AUTH_EMULATOR_HOST = config.authEmulator;
if (config.firestoreEmulator) process.env.FIRESTORE_EMULATOR_HOST = config.firestoreEmulator;

const app = getApps()[0] ?? initializeApp({ projectId: config.projectId, credential: applicationDefault() });
export const auth = getAuth(app);
export const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
