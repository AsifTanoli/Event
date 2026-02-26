import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
  useRef
} from "react";

interface User {
  id: string;
  name: string;
  email?: string;
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
  login: (username: string, password: string) => Promise<void>;
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

const PUBLIC_ROUTE_PATTERNS = [
  /^\/login\/?$/,
  /^\/register\/?$/,
  /^\/self-check-in\/?$/,
  /^\/self-check-in-by-registration\/?$/,
  /^\/event\/[^/]+\/register\/?$/,
  /^\/event\/[^/]+\/check-in\/?$/,
  // Keep staff registration on the same page and let it trigger Windows auth popup there.
  /^\/staff-register\/?$/,
  /^\/staf-register\/?$/,
  /^\/staff-registration\/?$/,
  /^\/event\/[^/]+\/staff-register\/?$/,
  /^\/event\/[^/]+\/staf-register\/?$/,
  /^\/event\/[^/]+\/staff-registration\/?$/
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

  const checkWhoami = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${WINDOWS_AUTH_API_BASE}/whoami`, {
        method: "GET",
        headers: {
          accept: "*/*"
        },
        credentials: "include"
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      if (!data.success || !data.windowsIdentity?.isAuthenticated) {
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
        accessType
      };

      setUser(userData);

      localStorage.setItem(
        "windows_auth_user",
        JSON.stringify({
          username: windowsUser.username,
          domain: windowsUser.domain,
          fullName: data.databaseUser?.fullName || windowsUser.name,
          accessType,
          role: data.databaseUser?.role || null,
          permissions,
          databaseUser: data.databaseUser || null
        })
      );

      if (data.token) {
        localStorage.setItem("windows_auth_token", data.token);
      }

      return true;
    } catch (error) {
      console.error("Error checking whoami:", error);
      return false;
    }
  }, []);

  const loginWithWindows = useCallback(async (_eventId?: string): Promise<void> => {
    try {
      setIsLoading(true);

      const response = await fetch(`${WINDOWS_AUTH_API_BASE}/whoami`, {
        method: "GET",
        headers: {
          accept: "*/*"
        },
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error("Windows authentication failed");
      }

      const data = await response.json();
      if (!data.success || !data.windowsIdentity?.isAuthenticated) {
        throw new Error(data.message || "Windows authentication failed");
      }

      const windowsUser = data.windowsIdentity;
      const accessType = data.databaseUser ? "FULL_ACCESS" : "EVENT_ONLY";
      const rawPermissions = data.databaseUser?.permissions || [];
      const permissions = parsePermissions(rawPermissions);

      const nextUser: User = {
        id: data.databaseUser?.id || windowsUser.username || windowsUser.name,
        name: data.databaseUser?.fullName || windowsUser.name || windowsUser.username,
        email: data.databaseUser?.email || windowsUser.email || "",
        username: windowsUser.username,
        domain: windowsUser.domain,
        fullName: data.databaseUser?.fullName || windowsUser.name,
        role: data.databaseUser?.role || null,
        permissions,
        accessType
      };

      setUser(nextUser);

      localStorage.setItem(
        "windows_auth_user",
        JSON.stringify({
          username: windowsUser.username,
          domain: windowsUser.domain,
          fullName: data.databaseUser?.fullName || windowsUser.name,
          accessType,
          role: data.databaseUser?.role || null,
          permissions,
          databaseUser: data.databaseUser || null
        })
      );

      if (data.token) {
        localStorage.setItem("windows_auth_token", data.token);
      }
    } catch (error: any) {
      console.error("Windows login error:", error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authCheckedRef.current) {
      return;
    }
    authCheckedRef.current = true;

    const checkAuth = async () => {
      try {
        let restoredSession = false;

        const windowsUser = localStorage.getItem("windows_auth_user");
        const windowsToken = localStorage.getItem("windows_auth_token");

        if (windowsUser && (windowsToken || windowsUser)) {
          try {
            const userData = JSON.parse(windowsUser);
            const permissions = parsePermissions(userData.permissions || []);

            setUser({
              id:
                userData.databaseUser?.id ||
                userData.username ||
                userData.fullName ||
                userData.id,
              name: userData.fullName || userData.username || userData.name,
              email: userData.databaseUser?.email || userData.email || "",
              role: userData.role || userData.databaseUser?.role || null,
              permissions,
              accessType: userData.accessType || "EVENT_ONLY",
              username: userData.username,
              domain: userData.domain,
              fullName: userData.fullName
            });
            restoredSession = true;
          } catch (parseError) {
            console.error("Error parsing stored Windows user:", parseError);
          }
        }

        if (!restoredSession) {
          const storedUser = localStorage.getItem("user");
          const token = localStorage.getItem("auth_token");

          if (storedUser && token) {
            try {
              setUser(JSON.parse(storedUser));
              restoredSession = true;
            } catch (parseError) {
              console.error("Error parsing stored user:", parseError);
            }
          }
        }

        const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";
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

  const login = async (username: string, password: string): Promise<void> => {
    try {
      setIsLoading(true);

      const useAPI = import.meta.env.VITE_USE_API === "true";

      if (useAPI) {
        const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
        const response = await fetch(`${API_BASE_URL}/v1/auth/windows/custom-login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ username, password })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || "Login failed");
        }

        const data = await response.json();
        const permissions = parsePermissions(data.data.user.permissions || []);
        const userData: User = {
          id: data.data.user.id || "",
          name: data.data.user.fullName || "",
          username: data.data.user.fullName || "",
          email: data.data.user.email || "",
          role: data.data.user.role,
          fullName: data.data.user.fullName,
          accessType: "FULL_ACCESS",
          permissions
        };

        if (data.token || data.accessToken) {
          localStorage.setItem("windows_auth_token", data.token || data.accessToken);
        }
        setUser(userData);

        localStorage.setItem(
          "windows_auth_user",
          JSON.stringify({
            id: data.data.user.id || "",
            name: data.data.user.name || "",
            username: data.data.user.name || "",
            email: data.data.user.email || "",
            role: data.data.user.role,
            fullName: data.data.user.fullName,
            accessType: "FULL_ACCESS",
            permissions
          })
        );
      } else {
        if (!username || !password) {
          throw new Error("username and password are required");
        }

        const userData: User = {
          id: "1",
          name: username,
          role: "admin"
        };

        const mockToken = `mock_token_${Date.now()}`;
        localStorage.setItem("auth_token", mockToken);
        localStorage.setItem("user", JSON.stringify(userData));
        setUser(userData);
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
        logout
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
