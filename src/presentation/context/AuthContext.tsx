import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
  useRef,
} from "react";
import { getStorageWithExpiry, setStorageWithExpiry } from "../../utils/storageWithExpiry";

interface User {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  permissions?: string[];
  accessType?: "EVENT_ONLY" | "FULL_ACCESS";
  username?: string;
  domain?: string;
  fullName?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  login: (adminId: string, password: string) => Promise<void>;
  loginWithWindows: (eventId?: string) => Promise<void>;
  checkWhoami: () => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

const WINDOWS_AUTH_API_BASE =
  import.meta.env.VITE_WINDOWS_AUTH_API_BASE ||
  "https://eventauthapi.gcaa-uae.gov/api/v1/auth/windows";
const WINDOWS_CUSTOM_LOGIN_API =
  import.meta.env.VITE_WINDOWS_AUTH_CUSTOM_LOGIN_API ||
  "https://gcaawebapi.gcaa-uae.gov/api/v1/auth/windows/custom-login";

const PUBLIC_ROUTE_PATTERNS = [
  /^\/login$/,
  /^\/register$/,
  /^\/self-check-in$/,
  /^\/self-check-in-by-registration$/,
  /^\/event\/[^/]+\/register$/,
  /^\/event\/[^/]+\/check-in$/,
  // Keep staff registration on the same page and let it trigger Windows auth popup there.
  /^\/event\/[^/]+\/staff-register$/,
  /^\/event\/[^/]+\/staff-registration$/,
];

const isPublicRoute = (path: string): boolean =>
  PUBLIC_ROUTE_PATTERNS.some((pattern) => pattern.test(path));

const parsePermissions = (permissions: string | string[] | undefined): string[] => {
  if (!permissions) return [];
  if (Array.isArray(permissions)) return permissions;
  if (typeof permissions !== "string") return [];
  try {
    const parsed = JSON.parse(permissions);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const authCheckedRef = useRef(false);

  const applyWindowsAuthPayload = useCallback((data: any): boolean => {
    if (!data?.success || !data.windowsIdentity?.isAuthenticated) {
      return false;
    }

    const windowsUser = data.windowsIdentity;
    const accessType = data.databaseUser ? "FULL_ACCESS" : "EVENT_ONLY";
    const rawPermissions = data.databaseUser?.permissions || [];
    const permissions = parsePermissions(rawPermissions);

    const userData: User = {
      id: data.databaseUser?.id || windowsUser.username || windowsUser.name,
      name: data.databaseUser?.fullName || windowsUser.name || windowsUser.username,
      email: data.databaseUser?.email || windowsUser.email || "",
      username: windowsUser.username,
      domain: windowsUser.domain,
      fullName: data.databaseUser?.fullName || windowsUser.name,
      role: data.databaseUser?.role || null,
      permissions,
      accessType,
    };

    setUser(userData);

    setStorageWithExpiry("windows_auth_user", {
      username: windowsUser.username,
      domain: windowsUser.domain,
      fullName: data.databaseUser?.fullName || windowsUser.name,
      accessType,
      role: data.databaseUser?.role || null,
      permissions,
      databaseUser: data.databaseUser || null,
    });

    if (data.token) {
      setStorageWithExpiry("windows_auth_token", data.token);
    }

    return true;
  }, []);

  const checkWhoami = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${WINDOWS_AUTH_API_BASE}/whoami`, {
        method: "GET",
        headers: {
          accept: "*/*",
        },
        credentials: "include",
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      return applyWindowsAuthPayload(data);
    } catch (error) {
      console.error("Error checking whoami:", error);
      return false;
    }
  }, [applyWindowsAuthPayload]);

  const loginWithWindows = useCallback(async (_eventId?: string): Promise<void> => {
    try {
      setIsLoading(true);

      const response = await fetch(`${WINDOWS_AUTH_API_BASE}/whoami`, {
        method: "GET",
        headers: {
          accept: "*/*",
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Windows authentication failed");
      }

      const data = await response.json();
      if (!applyWindowsAuthPayload(data)) {
        throw new Error(data.message || "Windows authentication failed");
      }
    } catch (error: any) {
      console.error("Windows login error:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [applyWindowsAuthPayload]);

  useEffect(() => {
    if (authCheckedRef.current) {
      return;
    }
    authCheckedRef.current = true;

    const checkAuth = async () => {
      try {
        let restoredSession = false;

        const windowsUser = getStorageWithExpiry<Record<string, any>>("windows_auth_user");
        const windowsToken = getStorageWithExpiry<string>("windows_auth_token");

        if (windowsUser && (windowsToken || windowsUser)) {
          const permissions = parsePermissions(windowsUser.permissions || []);

          setUser({
            id:
              windowsUser.databaseUser?.id ||
              windowsUser.username ||
              windowsUser.fullName ||
              windowsUser.id,
            name: windowsUser.fullName || windowsUser.username || windowsUser.name,
            email: windowsUser.databaseUser?.email || windowsUser.email || "",
            role: windowsUser.role || windowsUser.databaseUser?.role || null,
            permissions,
            accessType: windowsUser.accessType || "EVENT_ONLY",
            username: windowsUser.username,
            domain: windowsUser.domain,
            fullName: windowsUser.fullName,
          });
          restoredSession = true;
        }

        if (!restoredSession) {
          const storedUser = getStorageWithExpiry<User>("user");
          const token = getStorageWithExpiry<string>("auth_token");

          if (storedUser && token) {
            setUser(storedUser);
            restoredSession = true;
          }
        }

        const currentPath = window.location.pathname;
        if (!restoredSession && !isPublicRoute(currentPath)) {
          // Important: do not call /whoami here, because that can trigger the
          // browser's Windows auth challenge before the user clicks the button.
          window.location.replace("/login");
        }
      } catch (error) {
        console.error("Error checking auth:", error);
        localStorage.removeItem("user");
        localStorage.removeItem("auth_token");
        localStorage.removeItem("windows_auth_user");
        localStorage.removeItem("windows_auth_token");
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (adminId: string, password: string): Promise<void> => {
    try {
      setIsLoading(true);

      if (!adminId || !password) {
        throw new Error("Admin ID and password are required");
      }

      // Manual sign-in via Windows custom-login endpoint
      const response = await fetch(WINDOWS_CUSTOM_LOGIN_API, {
        method: "POST",
        headers: {
          accept: "*/*",
          "Content-Type": "application/json-patch+json",
        },
        credentials: "include",
        body: JSON.stringify({
          username: adminId,
          password,
        }),
      });

      if (!response.ok) {
        let message = "Login failed";
        try {
          const errorData = await response.json();
          message = errorData?.message || errorData?.title || message;
        } catch {
          // No JSON body
        }
        throw new Error(message);
      }

      const data = await response.json();
      if (data.token || data.accessToken) {
        setStorageWithExpiry("auth_token", data.token || data.accessToken);
      }

      // If custom-login returns the same structure as whoami, use it directly.
      if (applyWindowsAuthPayload(data)) {
        return;
      }

      // Fallback: keep the same user/access/permissions flow as whoami.
      if (!(await checkWhoami())) {
        throw new Error(data.message || "Login succeeded but user profile could not be loaded");
      }
    } catch (error: any) {
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const hasPermission = (permission: string): boolean => {
    if (!user || user.accessType !== "FULL_ACCESS") return false;
    if (!user.permissions || user.permissions.length === 0) return false;
    if (user.permissions.includes("*")) return true;
    return user.permissions.includes(permission);
  };

  const hasRole = (role: string): boolean => {
    if (!user || user.accessType !== "FULL_ACCESS") return false;
    return user.role === role;
  };

  const logout = () => {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("user");
    localStorage.removeItem("windows_auth_token");
    localStorage.removeItem("windows_auth_user");
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        hasPermission,
        hasRole,
        login,
        loginWithWindows,
        checkWhoami,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
