import nodemailer from 'nodemailer';
import type { EmailStatus } from '@ticket-maestro/shared';
import { config } from '../config.js';
import { CloudTasksClient } from '@google-cloud/tasks';
import { OAuth2Client } from 'google-auth-library';

const transporter = config.emailMode === 'smtp' && config.smtpHost
  ? nodemailer.createTransport({ host: config.smtpHost, port: config.smtpPort, secure: false, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000 })
  : null;
const tasksClient = config.tasksEnabled ? new CloudTasksClient() : null;
const taskVerifier = new OAuth2Client();

export async function sendConfirmation(input: { email: string; eventTitle: string; codes: string[]; reservationId: string }): Promise<EmailStatus> {
  if (!transporter) return 'SIMULATED';
  try {
    await transporter.sendMail({
      from: config.smtpFrom,
      to: input.email,
      subject: `Potwierdzenie rezerwacji: ${input.eventTitle}`,
      messageId: `<${input.reservationId}@ticketmaestro.local>`,
      text: `Rezerwacja ${input.reservationId} została potwierdzona.\nBilety: ${input.codes.join(', ')}`
    });
    return 'SENT';
  } catch { return 'FAILED'; }
}

export async function enqueueEmailJob(reservationId: string, retryVersion: number): Promise<void> {
  if (!tasksClient || !config.cloudTasksQueue || !config.cloudTasksLocation || !config.cloudTasksServiceAccount || !config.serviceBaseUrl) return;
  const parent = tasksClient.queuePath(config.projectId, config.cloudTasksLocation, config.cloudTasksQueue);
  const taskName = `ticketmaestro-${reservationId}-${retryVersion}`;
  const task = {
    name: tasksClient.taskPath(config.projectId, config.cloudTasksLocation, config.cloudTasksQueue, taskName),
    httpRequest: {
      httpMethod: 'POST' as const,
      url: `${config.serviceBaseUrl}/api/internal/email-jobs/${encodeURIComponent(reservationId)}`,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify({ reservationId })).toString('base64'),
      oidcToken: { serviceAccountEmail: config.cloudTasksServiceAccount, audience: config.serviceBaseUrl }
    }
  };
  try { await tasksClient.createTask({ parent, task }); }
  catch (error) {
    if ((error as { code?: number }).code === 6) return; // ALREADY_EXISTS: this delivery attempt was already scheduled.
    throw error;
  }
}

export async function verifyEmailTaskToken(authorization: string | undefined): Promise<boolean> {
  if (!config.tasksEnabled || !config.serviceBaseUrl || !config.emailWorkerServiceAccount || !authorization?.startsWith('Bearer ')) return false;
  try {
    const ticket = await taskVerifier.verifyIdToken({ idToken: authorization.slice(7), audience: config.serviceBaseUrl });
    const payload = ticket.getPayload();
    return payload?.email === config.emailWorkerServiceAccount && payload.email_verified === true;
  } catch { return false; }
}
