import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [meta, setMeta] = useState({ materials: {}, cities: [] });
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    api('/meta').then(setMeta).catch(() => {});
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api('/auth/me').then((d) => setUser(d.user)).catch(() => setToken(null)).finally(() => setLoading(false));
  }, [logout]);

  const value = useMemo(() => ({
    user,
    meta,
    loading,
    setUser,
    logout,
    async login(email, password) {
      const d = await api('/auth/login', { method: 'POST', body: { email, password } });
      setToken(d.token);
      setUser(d.user);
      return d.user;
    },
    async register(form) {
      const d = await api('/auth/register', { method: 'POST', body: form });
      setToken(d.token);
      setUser(d.user);
      return d.user;
    },
  }), [user, meta, loading, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
