'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from './api-client';

/** El usuario autenticado, tal como lo devuelve `GET /auth/me`. */
export interface Me {
  userId: string;
  email: string;
  roleName: string;
  roleLevel: number;
  mustChangePassword: boolean;
  totpEnabled: boolean;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** Vuelve a pedir `/auth/me` (tras login, cambios de rol, etc.). */
  refresh: () => Promise<void>;
  /** Cierra la sesión en el servidor y limpia el estado. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Provee el estado de sesión a toda la app. Al montar pide `/auth/me`; si no
 * hay sesión, `me` queda en `null` (no es un error).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMe(await apiFetch<Me>('/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setMe(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ me, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook de sesión.
 *
 * @returns `{ me, loading, refresh, logout }`.
 * @throws Error si se usa fuera de `<AuthProvider>`.
 */
export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  }
  return context;
}

/** Roles con acceso a los paneles de administración. */
export const ADMIN_ROLES = ['admin', 'director', 'super'];
