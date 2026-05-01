import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onIdTokenChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { setAuthToken } from '@/api';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) || '';

interface AuthUser {
  firebaseUser: User;
  role: 'user' | 'super_admin';
  id: number;
  email: string;
  name: string | null;
  photoUrl: string | null;
}

interface AuthContextValue {
  user:    AuthUser | null;
  loading: boolean;
  login:   () => Promise<void>;
  logout:  () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onIdTokenChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const token = await firebaseUser.getIdToken();
        setAuthToken(token);
        try {
          const res  = await fetch(`${BASE}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const me = await res.json() as {
              id: number; role: 'user' | 'super_admin';
              email: string; name: string | null; photo_url: string | null;
            };
            setUser({
              firebaseUser,
              role:     me.role,
              id:       me.id,
              email:    me.email,
              name:     me.name,
              photoUrl: me.photo_url,
            });
          } else {
            // Token valid but /me failed (e.g., non-zethic email)
            await signOut(auth);
            setUser(null);
          }
        } catch {
          setUser(null);
        }
      } else {
        setAuthToken(null);
        setUser(null);
      }
      setLoading(false);
    });
  }, []);

  async function login() {
    await signInWithPopup(auth, googleProvider);
  }

  async function logout() {
    await signOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
