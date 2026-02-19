import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { apiUrl } from '../config/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthUser {
  username: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TOKEN_KEY = 'auth_token';
const AUTH_EXPIRED_EVENT = 'nexus:auth-expired';
const AUTH_EXPIRED_NOTICE_KEY = 'auth_expired_notice';
const TOKEN_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null);

// ─── Helper: get current token (for use in other services) ───────────────────

export function getAuthToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function notifyAuthExpired(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.setItem(AUTH_EXPIRED_NOTICE_KEY, '1');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(sessionStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Validate an existing token on mount
  useEffect(() => {
    const storedToken = sessionStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(apiUrl('/api/auth/me'), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${storedToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          throw new Error('Token validation failed');
        }

        const data = await res.json();

        if (!cancelled) {
          setUser({ username: data.username, role: data.role });
          setToken(storedToken);
        }
      } catch {
        // Token is invalid or server unreachable — clear session
        sessionStorage.removeItem(TOKEN_KEY);
        if (!cancelled) {
          setUser(null);
          setToken(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Login
  const login = useCallback(async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        return { success: false, error: data.error || 'שם משתמש או סיסמה שגויים' };
      }

      // Store token and set user
      sessionStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setUser({ username: data.user.username, role: data.user.role });

      return { success: true };
    } catch {
      return { success: false, error: 'שגיאת חיבור לשרת. נסה שוב מאוחר יותר.' };
    }
  }, []);

  // Logout
  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, []);

  // Periodic token refresh to prevent silent expiry while working
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    if (!token) return;

    const refreshToken = async () => {
      const currentToken = sessionStorage.getItem(TOKEN_KEY);
      if (!currentToken) return;

      try {
        const res = await fetch(apiUrl('/api/auth/refresh'), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${currentToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          notifyAuthExpired();
          return;
        }

        const data = await res.json();
        sessionStorage.setItem(TOKEN_KEY, data.token);
        setToken(data.token);
      } catch {
        // Network error — don't log out, will retry next interval
      }
    };

    refreshTimerRef.current = setInterval(refreshToken, TOKEN_REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [token]);

  useEffect(() => {
    const onExpired = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
    };
  }, []);

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!user && !!token,
    isLoading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
