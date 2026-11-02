import { z } from 'zod';

export const roleSchema = z.enum(['USER', 'MANAGER', 'ADMIN']);
export type Role = z.infer<typeof roleSchema>;
export const eventStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']);
export type EventStatus = z.infer<typeof eventStatusSchema>;
export const reservationStatusSchema = z.enum(['PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'PAYMENT_FAILED']);
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;
export const emailStatusSchema = z.enum(['NOT_REQUESTED', 'QUEUED', 'SIMULATED', 'SENT', 'FAILED']);
export type EmailStatus = z.infer<typeof emailStatusSchema>;
const safeImageUrl = z.string().url().refine(value => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}, 'Adres grafiki musi używać HTTP lub HTTPS.').or(z.literal(''));

export const eventInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(5000),
  category: z.string().trim().min(2).max(60),
  date: z.string().datetime(),
  location: z.string().trim().min(3).max(180),
  imageUrl: safeImageUrl,
  capacity: z.number().int().min(10).max(20000),
  status: eventStatusSchema.default('PUBLISHED')
});
export type EventInput = z.infer<typeof eventInputSchema>;

export const reservationInputSchema = z.object({ quantity: z.number().int().min(1).max(5) });
export type ReservationInput = z.infer<typeof reservationInputSchema>;

export interface EventRecord extends EventInput {
  id: string;
  available: number;
  reserved: number;
  titleNormalized: string;
  managerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketRecord {
  id: string;
  reservationId: string;
  eventId: string;
  ownerId: string;
  code: string;
  createdAt: string;
  status?: string;
}

export interface ReservationRecord {
  id: string;
  eventId: string;
  eventTitle: string;
  userId: string;
  email: string;
  quantity: number;
  status: ReservationStatus;
  ticketIds: string[];
  emailStatus: EmailStatus;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  eventDate: string;
}

export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; hasMore: boolean; nextCursor?: string }
export interface AuthUser { uid: string; email: string; role: Role }
