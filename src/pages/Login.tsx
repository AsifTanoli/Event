import { useState, FormEvent, ChangeEvent } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "../presentation/context/AuthContext";
import Button from "../components/Button";
import Input from "../components/Input";
import { LogIn, Mail, Lock, AlertCircle, Loader2 } from "lucide-react";

const WINDOWS_AUTH_API_BASE =
  import.meta.env.VITE_WINDOWS_AUTH_API_BASE ||
  "https://eventauthapi.gcaa-uae.gov/api/v1/auth/windows";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAttemptingWindowsAuth, setIsAttemptingWindowsAuth] = useState(false);
  const { login, loginWithWindows, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  // Redirect if already authenticated
  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  // Only show loading while auth context is initializing
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg animate-pulse">
            <LogIn className="text-white" size={32} />
          </div>
          <p className="text-gray-600">Loading...</p>
          <div className="mt-4 flex justify-center">
            <Loader2 className="animate-spin text-blue-600" size={24} />
          </div>
        </div>
      </div>
    );
  }

  const handleWindowsAuth = async () => {
    setIsAttemptingWindowsAuth(true);
    setError("");

    try {
      const url = `${WINDOWS_AUTH_API_BASE}/whoami`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "*/*",
        },
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.windowsIdentity?.isAuthenticated) {
          const windowsUser = data.windowsIdentity;
          const userData = {
            username: windowsUser.username,
            domain: windowsUser.domain,
            fullName: windowsUser.name,
          };
          localStorage.setItem("windows_auth_user", JSON.stringify(userData));

          await loginWithWindows();
          navigate("/");
          return;
        }
      } else if (response.status === 401) {
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const retryResponse = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "*/*",
          },
          credentials: "include",
        });

        if (retryResponse.ok) {
          const data = await retryResponse.json();
          if (data.success && data.windowsIdentity?.isAuthenticated) {
            const windowsUser = data.windowsIdentity;
            const userData = {
              username: windowsUser.username,
              domain: windowsUser.domain,
              fullName: windowsUser.name,
            };
            localStorage.setItem("windows_auth_user", JSON.stringify(userData));

            await loginWithWindows();
            navigate("/");
            return;
          }
        } else {
          setError(
            "Windows authentication was cancelled. Please try again or use manual login.",
          );
          return;
        }
      }

      setError("Windows authentication failed. Please try again or use manual login.");
    } catch (authError: any) {
      console.error("Windows auth error:", authError);
      setError("Windows authentication failed. Please try again or use manual login.");
    } finally {
      setIsAttemptingWindowsAuth(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Login failed. Please check your credentials.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo/Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <LogIn className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">GCAA</h1>
          <p className="text-sm text-gray-600 font-medium">Event Management System</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6 text-center">
            Sign In
          </h2>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="text-gray-400" size={20} />
                </div>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                  className="pl-10"
                  disabled={isSubmitting || isAttemptingWindowsAuth}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="text-gray-400" size={20} />
                </div>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="pl-10"
                  disabled={isSubmitting || isAttemptingWindowsAuth}
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full py-3 text-base font-semibold"
              disabled={isSubmitting || isAttemptingWindowsAuth}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Signing in...
                </span>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          {/* Windows Auth Button and Info */}
          <div className="mt-6 space-y-3">
            <Button
              type="button"
              onClick={handleWindowsAuth}
              disabled={isAttemptingWindowsAuth || isSubmitting}
              variant="outline"
              fullWidth
            >
              {isAttemptingWindowsAuth ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="animate-spin" size={16} />
                  Authenticating with Windows...
                </span>
              ) : (
                "Sign in with Windows"
              )}
            </Button>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-blue-800 font-medium mb-1">Windows Authentication:</p>
              <p className="text-xs text-blue-700">
                Click "Sign in with Windows" to use your Windows credentials. The browser will
                automatically show the Windows authentication dialog if needed.
              </p>
              <p className="text-xs text-blue-600 mt-1">
                Or enter your email and password above for manual login.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-500 mt-6">
          © 2024 GCAA. All rights reserved.
        </p>
      </div>
    </div>
  );
}
