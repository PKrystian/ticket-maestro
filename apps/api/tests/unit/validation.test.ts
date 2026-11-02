import { describe, expect, it } from 'vitest';
import { eventInputSchema, reservationInputSchema } from '@ticket-maestro/shared';

describe('API input contracts', () => {
  it('rejects a missing or malformed idempotency payload quantity', () => {
    expect(reservationInputSchema.safeParse({}).success).toBe(false);
    expect(reservationInputSchema.safeParse({ quantity: '2' }).success).toBe(false);
  });
  it('requires a valid date and event capacity', () => {
    const event = { title: 'Wystawa fotografii', description: 'Wystawa fotograficzna w przestrzeni miejskiej.', category: 'Kultura', date: 'invalid-date', location: 'Poznań', imageUrl: '', capacity: 100, status: 'PUBLISHED' };
    expect(eventInputSchema.safeParse(event).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...event, date: new Date().toISOString(), capacity: 20001 }).success).toBe(false);
  });
});
