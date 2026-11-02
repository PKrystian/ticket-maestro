import { describe, expect, it } from 'vitest';
import { eventInputSchema, reservationInputSchema, roleSchema } from './index.js';

describe('shared validation contracts', () => {
  it('accepts supported roles and rejects client-created elevated roles as invalid input for public flows', () => {
    expect(roleSchema.safeParse('USER').success).toBe(true);
    expect(roleSchema.safeParse('SUPERUSER').success).toBe(false);
  });
  it('limits reservation quantities to one through five tickets', () => {
    for (const quantity of [1, 2, 3, 4, 5]) expect(reservationInputSchema.safeParse({ quantity }).success).toBe(true);
    for (const quantity of [0, 6, -1, 1.5]) expect(reservationInputSchema.safeParse({ quantity }).success).toBe(false);
  });
  it('validates event capacity, date, and safe image URL fields', () => {
    const valid = { title: 'Koncert testowy', description: 'Wydarzenie do sprawdzenia walidacji danych.', category: 'Muzyka', date: new Date(Date.now() + 86_400_000).toISOString(), location: 'Poznań', imageUrl: '', capacity: 10, status: 'PUBLISHED' };
    expect(eventInputSchema.safeParse(valid).success).toBe(true);
    expect(eventInputSchema.safeParse({ ...valid, capacity: 9 }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...valid, imageUrl: 'javascript:alert(1)' }).success).toBe(false);
  });
});
