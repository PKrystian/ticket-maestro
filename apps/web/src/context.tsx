import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User, signOut } from 'firebase/auth';
import { auth } from './firebase';
import { api } from './api';
import type { AuthUser, Role } from '@ticket-maestro/shared';

interface Session { firebaseUser: User | null; user: AuthUser | null; loading: boolean; refresh: () => Promise<void>; logout: () => Promise<void> }
const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    if (!auth.currentUser) { setUser(null); return; }
    try { setUser(await api<AuthUser>('/me')); }
    catch { setUser({ uid: auth.currentUser.uid, email: auth.currentUser.email ?? '', role: 'USER' as Role }); }
  };
  useEffect(() => onAuthStateChanged(auth, async current => {
    setLoading(true);
    setFirebaseUser(current);
    if (current) {
      try {
        const token = await current.getIdToken();
        await fetch('/api/auth/profile', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
        setUser(await api<AuthUser>('/me'));
      } catch { setUser({ uid: current.uid, email: current.email ?? '', role: 'USER' }); }
    } else setUser(null);
    setLoading(false);
  }), []);
  const value = useMemo(() => ({ firebaseUser, user, loading, refresh, logout: () => signOut(auth) }), [firebaseUser, user, loading]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
export function useSession() { const context = useContext(SessionContext); if (!context) throw new Error('SessionProvider is missing'); return context; }

interface Toast { id: number; message: string; kind: 'success' | 'error' | 'info' }
interface ToastContextValue { showToast: (message: string, kind?: Toast['kind']) => void }
const ToastContext = createContext<ToastContextValue | null>(null);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = (message: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setToasts(current => [...current, { id, message, kind }]);
    window.setTimeout(() => setToasts(current => current.filter(toast => toast.id !== id)), 4200);
  };
  return <ToastContext.Provider value={{ showToast }}>{children}<div className="toast-stack" aria-live="polite">{toasts.map(toast => <div key={toast.id} className={`toast toast-${toast.kind}`}>{toast.message}</div>)}</div></ToastContext.Provider>;
}
export function useToast() { const context = useContext(ToastContext); if (!context) throw new Error('ToastProvider is missing'); return context; }
