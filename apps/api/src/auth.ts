import type { NextFunction, Request, Response } from 'express';
import type { AuthUser, Role } from '@ticket-maestro/shared';
import { roleSchema } from '@ticket-maestro/shared';
import { auth, db } from './firebase.js';
import { ApiError } from './errors.js';

/* eslint-disable @typescript-eslint/no-namespace -- Express exposes Request through this augmentation namespace. */
declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED');
    const decoded = await auth.verifyIdToken(header.slice(7));
    const profile = await db.collection('users').doc(decoded.uid).get();
    const role: Role = roleSchema.catch('USER').parse(profile.get('role'));
    req.user = { uid: decoded.uid, email: decoded.email ?? '', role };
    next();
  } catch (error) { next(error instanceof ApiError ? error : new ApiError(401, 'Sesja jest nieprawidłowa lub wygasła.', 'UNAUTHENTICATED')); }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new ApiError(401, 'Zaloguj się, aby kontynuować.', 'UNAUTHENTICATED'));
    if (!roles.includes(req.user.role)) return next(new ApiError(403, 'Nie masz uprawnień do tej operacji.', 'FORBIDDEN'));
    next();
  };
}
