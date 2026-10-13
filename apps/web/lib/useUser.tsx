'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Me } from './api';

interface UserCtx {
  user: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
}

const UserContext = createContext<UserCtx>({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = async () => {
    // Set loading for the duration of the check so guarded pages don't
    // see the stale (user=null, loading=false) state mid-refresh and
    // bounce to /login.
    setLoading(true);
    try {
      const me = await api<Me>('/auth/me');
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const logout = () => {
    localStorage.removeItem('sf_access_token');
    localStorage.removeItem('sf_refresh_token');
    setUser(null);
    router.push('/login');
  };

  return (
    <UserContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
