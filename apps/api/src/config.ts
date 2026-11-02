export const config = {
  port: Number(process.env.PORT ?? 8080),
  projectId: process.env.FIREBASE_PROJECT_ID ?? 'ticket-maestro-local',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  production: process.env.NODE_ENV === 'production',
  authEmulator: process.env.FIREBASE_AUTH_EMULATOR_HOST,
  firestoreEmulator: process.env.FIRESTORE_EMULATOR_HOST,
  emailMode: process.env.EMAIL_MODE ?? 'simulation',
  smtpHost: process.env.SMTP_HOST,
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  smtpFrom: process.env.SMTP_FROM ?? 'tickets@ticketmaestro.local',
  failureInjectionEnabled: process.env.ENABLE_FAILURE_INJECTION === 'true' && process.env.NODE_ENV !== 'production',
  cloudTasksQueue: process.env.CLOUD_TASKS_QUEUE,
  cloudTasksLocation: process.env.CLOUD_TASKS_LOCATION,
  cloudTasksServiceAccount: process.env.CLOUD_TASKS_SERVICE_ACCOUNT,
  serviceBaseUrl: process.env.SERVICE_BASE_URL?.replace(/\/$/, ''),
  tasksEnabled: Boolean(process.env.CLOUD_TASKS_QUEUE && process.env.CLOUD_TASKS_LOCATION && process.env.CLOUD_TASKS_SERVICE_ACCOUNT && process.env.SERVICE_BASE_URL),
  emailWorkerServiceAccount: process.env.EMAIL_WORKER_SERVICE_ACCOUNT
};

if (config.production && (config.authEmulator || config.firestoreEmulator)) {
  throw new Error('Firebase emulators must not be enabled in production.');
}
