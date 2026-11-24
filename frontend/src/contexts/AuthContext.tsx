import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { apiClient, getStoredToken, onAuthExpired, setStoredToken } from "../lib/api";
import type { AuthResponse, UserDto } from "../types/api";

interface AuthContextValue {
  user: UserDto | null;
  loading: boolean;
  isStaffOrAdmin: boolean;
  isFullAdmin: boolean;
  refreshUser: () => Promise<void>;
  loginWithResponse: (res: AuthResponse, rememberMe?: boolean) => void;
  logout: () => Promise<void>;
  setUserDirect: (user: UserDto | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await apiClient.get<UserDto>("/api/auth/me");
      setUser(me);
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
    return onAuthExpired(() => {
      setUser(null);
    });
  }, [refreshUser]);

  const loginWithResponse = useCallback((res: AuthResponse, rememberMe = true) => {
    setStoredToken(res.access_token, rememberMe);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      if (getStoredToken()) {
        await apiClient.post<{ ok: boolean }>("/api/auth/logout");
      }
    } catch {
      // Clear local session regardless of server response
    } finally {
      setStoredToken(null);
      setUser(null);
    }
  }, []);

  const isStaffOrAdmin = Boolean(user && (user.role_id === 1 || user.role_id === 2));
  const isFullAdmin = Boolean(user && user.role_id === 1);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isStaffOrAdmin,
        isFullAdmin,
        refreshUser,
        loginWithResponse,
        logout,
        setUserDirect: setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
