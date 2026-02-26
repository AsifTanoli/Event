import { useMemo, useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { useParams } from "react-router-dom";
import schemaJson from "../infrastructure/data/forms/abc.json";
import masterFieldsJsonRaw from "../infrastructure/data/forms/masterFields.json";
import DynamicForm, { FormValues } from "../components/DynamicForm";
import {
  EventSchema,
  Field,
  FieldOption,
  MasterField,
  RegistrationResponse
} from "../domain/entities/FormTypes";
import Button from "../components/Button";
import Input from "../components/Input";
import Modal from "../components/Modal";
import PageLoader from "../components/PageLoader";
import { Mail, CreditCard, CheckCircle2, Loader2, XCircle, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "../components/Card";
import { useEventServices } from "../presentation/context/EventServiceContext";
import { useAuth } from "../presentation/context/AuthContext";
import { APIEventRepository } from "../infrastructure/repositories/APIEventRepository";

const masterFieldsJson: MasterField[] = masterFieldsJsonRaw as MasterField[];

type RegistrationMethod = "UAE_PASS" | "EMIRATES_ID" | "MANUAL_OTP" | null;

export default function StaffRegistration() {
  const services = useEventServices();
  const { loginWithWindows, checkWhoami, isAuthenticated, user } = useAuth();
  const [submitted, setSubmitted] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<RegistrationMethod>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [emiratesId, setEmiratesId] = useState("");
  const [emiratesIdExpiryDate, setEmiratesIdExpiryDate] = useState("");
  const [verifyingOTP, setVerifyingOTP] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpAttemptsRemaining, setOtpAttemptsRemaining] = useState(5);
  const [otpLocked, setOtpLocked] = useState(false);
  const [otpSentSuccessfully, setOtpSentSuccessfully] = useState(false);
  const [otpErrorType, setOtpErrorType] = useState<"invalid" | "expired" | "too_many_attempts" | null>(null);
  const [otpExpired, setOtpExpired] = useState(false);
  const [showOTPModal, setShowOTPModal] = useState(false);
  const [otpModalCode, setOtpModalCode] = useState(""); // Separate OTP code for modal
  const [otpModalError, setOtpModalError] = useState<string | null>(null); // Errors shown only in OTP modal
  const [otpResendCooldown, setOtpResendCooldown] = useState(0); // Seconds until resend is enabled
  const [pendingSubmissionValues, setPendingSubmissionValues] = useState<FormValues | null>(null);
  const [schema, setSchema] = useState<EventSchema | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(true);
  const [schemaLoaded, setSchemaLoaded] = useState(false); // Track if schema is actually loaded
  const [minDisplayTimePassed, setMinDisplayTimePassed] = useState(false); // Track if 2 seconds have passed
  const [dataSource, setDataSource] = useState<"API" | "localStorage" | "fallback" | null>(null); // Track data source
  const [progress, setProgress] = useState(0); // Progress bar percentage
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [registrationResponse, setRegistrationResponse] = useState<RegistrationResponse | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});
  const [imageLoadError, setImageLoadError] = useState<boolean>(false);
  const [uaePassDataLoaded, setUaePassDataLoaded] = useState(false);
  const [loadingUaePassData, setLoadingUaePassData] = useState(false);
  const uaePassCallbackProcessed = useRef(false); // Track if UAE PASS callback has been processed
  const servicesRef = useRef(services); // Store services in ref to break dependency cycles
  const schemaLoadingRef = useRef(false); // Track if schema is currently loading to prevent multiple loads
  const lastEventIdRef = useRef<string | undefined>(undefined); // Track last loaded eventId

  const { eventId: routeEventId } = useParams<{ eventId: string }>();

  // Storage key for form values backup
  const FORM_VALUES_STORAGE_KEY = `staff-registration-form-${routeEventId || "default"}`;

  // Update services ref synchronously (useLayoutEffect runs before paint, preventing flicker)
  useLayoutEffect(() => {
    servicesRef.current = services;
  }, [services]);

  // Helper function to save form values to sessionStorage
  const saveFormValuesToStorage = (values: FormValues) => {
    try {
      if (routeEventId) {
        sessionStorage.setItem(FORM_VALUES_STORAGE_KEY, JSON.stringify(values));
      }
    } catch (error) {
      console.warn("[StaffRegistration] Failed to save form values to sessionStorage:", error);
    }
  };

  // Helper function to load form values from sessionStorage
  const loadFormValuesFromStorage = (): FormValues | null => {
    try {
      if (routeEventId) {
        const stored = sessionStorage.getItem(FORM_VALUES_STORAGE_KEY);
        if (stored) {
          return JSON.parse(stored) as FormValues;
        }
      }
    } catch (error) {
      console.warn("[StaffRegistration] Failed to load form values from sessionStorage:", error);
    }
    return null;
  };

  // Helper function to clear form values from sessionStorage
  const clearFormValuesFromStorage = () => {
    try {
      if (routeEventId) {
        sessionStorage.removeItem(FORM_VALUES_STORAGE_KEY);
      }
    } catch (error) {
      console.warn("[StaffRegistration] Failed to clear form values from sessionStorage:", error);
    }
  };

  // Countdown timer for OTP resend cooldown
  useEffect(() => {
    if (otpResendCooldown <= 0) return;

    const timer = setInterval(() => {
      setOtpResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [otpResendCooldown]);

  // Load schema from API or fallback
  useEffect(() => {
    // Guard: Only load if eventId changed or if not already loading
    if (schemaLoadingRef.current && lastEventIdRef.current === routeEventId) {
      return; // Already loading the same event, skip
    }

    // Check if we should force refresh (e.g., via URL parameter or if localStorage cache is stale)
    const urlParams = new URLSearchParams(window.location.search);
    const forceRefresh = urlParams.get("refresh") === "true" || urlParams.get("refresh") === "1";

    // Guard: If we already have a schema loaded for this exact eventId and not forcing refresh, don't reload
    // Check both the ref (for current render) and state (for previous renders)
    const currentEventId = routeEventId || (schemaJson as EventSchema).eventId;
    if (!forceRefresh && lastEventIdRef.current === currentEventId && schemaLoaded && schema && schema.eventId === currentEventId) {
      return; // Schema already loaded for this event (unless forcing refresh)
    }

    // If forcing refresh, clear localStorage cache for this event
    if (forceRefresh && routeEventId) {
      try {
        localStorage.removeItem(`event-schema-${routeEventId}`);
      } catch (error) {
        console.warn("[StaffRegistration] Failed to clear localStorage cache:", error);
      }
    }

    // Mark as loading and update last eventId
    schemaLoadingRef.current = true;
    lastEventIdRef.current = routeEventId;

    let isMounted = true; // Track if component is still mounted
    const startTime = Date.now(); // Track when loading started

    const loadSchema = async () => {
      const fallback = schemaJson as EventSchema;
      const idToUse = routeEventId || fallback.eventId;

      setLoadingSchema(true);
      setSchemaLoaded(false);
      setMinDisplayTimePassed(false);
      setProgress(0); // Reset progress

      try {
        // Priority 1: Try to load from EventFormSchemas table via API
        if (routeEventId) {
          try {
            // Add timeout to prevent infinite loading
            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("Request timeout")), 10000); // 10 second timeout
            });

            const apiSchema = await Promise.race([servicesRef.current.getEventFormSchemaUseCase.execute(routeEventId), timeoutPromise]);

            if (!isMounted) {
              schemaLoadingRef.current = false;
              return; // Component unmounted, don't update state
            }

            if (apiSchema && apiSchema.fields && apiSchema.fields.length > 0) {
              if (!isMounted) {
                schemaLoadingRef.current = false;
                return;
              }

              setSchema(apiSchema);
              setDataSource("API");
              setSchemaLoaded(true);
              schemaLoadingRef.current = false; // Mark loading as complete

              // Clear localStorage cache when we successfully load from API to ensure fresh data
              // This ensures that if schema is updated, we always get the latest version
              if (routeEventId) {
                try {
                  // Save the fresh schema to localStorage with a timestamp for future reference
                  const schemaWithTimestamp = {
                    ...apiSchema,
                    _cachedAt: Date.now()
                  };
                  localStorage.setItem(`event-schema-${routeEventId}`, JSON.stringify(schemaWithTimestamp));
                } catch (error) {
                  console.warn("[StaffRegistration] Failed to update localStorage cache:", error);
                }
              }

              // Don't set loadingSchema to false yet - wait for minimum display time
              return;
            }
          } catch (error) {
            if (!isMounted) {
              schemaLoadingRef.current = false;
              return; // Component unmounted, don't update state
            }
            // Only log errors for debugging
            console.error("[StaffRegistration] Error loading schema from API:", error);
            // Continue to fallback - don't return here
          }
        }

        if (!isMounted) {
          schemaLoadingRef.current = false;
          return; // Component unmounted, don't update state
        }

        // Priority 2: Try localStorage (only if API didn't return a schema)
        // Note: We only use localStorage as fallback if API fails, not as primary source
        // This ensures we always get the latest schema from the database
        try {
          const stored = localStorage.getItem(`event-schema-${idToUse}`);
          if (stored) {
            const parsed = JSON.parse(stored) as EventSchema & { _cachedAt?: number };
            if (parsed && parsed.fields && parsed.fields.length > 0) {
              // Check if cache is stale (older than 5 minutes) - if so, don't use it
              const cacheAge = parsed._cachedAt ? Date.now() - parsed._cachedAt : Infinity;
              const CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes

              if (cacheAge < CACHE_MAX_AGE) {
                if (!isMounted) {
                  schemaLoadingRef.current = false;
                  return; // Component unmounted, don't update state
                }
                // Remove the timestamp before setting schema
                const { _cachedAt, ...schemaWithoutTimestamp } = parsed;
                setSchema(schemaWithoutTimestamp);
                setDataSource("localStorage");
                setSchemaLoaded(true);
                schemaLoadingRef.current = false; // Mark loading as complete
                // Don't set loadingSchema to false yet - wait for minimum display time
                return;
              } else {
                // Cache is stale, remove it
                try {
                  localStorage.removeItem(`event-schema-${idToUse}`);
                } catch (e) {
                  // Ignore removal errors
                }
              }
            }
          }
        } catch (error) {
          // Only log errors for debugging
          console.error("[StaffRegistration] Error loading schema from localStorage:", error);
          // ignore storage errors and fall back to static JSON
        }

        if (!isMounted) {
          schemaLoadingRef.current = false;
          return; // Component unmounted, don't update state
        }

        // Priority 3: Fallback to bundled JSON (default)
        if (!isMounted) {
          schemaLoadingRef.current = false;
          return;
        }
        setSchema({ ...fallback, eventId: idToUse });
        setDataSource("fallback");
        setSchemaLoaded(true);
        schemaLoadingRef.current = false; // Mark loading as complete
        // Don't set loadingSchema to false yet - wait for minimum display time
      } catch (error) {
        // Final catch-all to ensure loading state is cleared
        // Only log errors for debugging
        console.error("[StaffRegistration] Unexpected error loading schema:", error);
        if (isMounted) {
          setSchema({ ...fallback, eventId: idToUse });
          setDataSource("fallback");
          setSchemaLoaded(true);
          schemaLoadingRef.current = false; // Mark loading as complete
          // Don't set loadingSchema to false yet - wait for minimum display time
        } else {
          schemaLoadingRef.current = false;
        }
      }
    };

    loadSchema();

    // Animate progress bar from 0% to 90% over 2 seconds
    const progressInterval = setInterval(() => {
      if (isMounted) {
        setProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 2; // Increment by 2% every ~40ms (2 seconds / 90 = ~22ms, but using 40ms for smoother animation)
        });
      }
    }, 40);

    // Ensure minimum display time of 2 seconds
    const minDisplayTimer = setTimeout(() => {
      if (isMounted) {
        setMinDisplayTimePassed(true);
        setProgress(100); // Complete progress when minimum time passes
      }
    }, 2000); // 2 seconds

    // Cleanup function to prevent state updates if component unmounts
    return () => {
      isMounted = false;
      schemaLoadingRef.current = false; // Reset loading flag on cleanup
      clearTimeout(minDisplayTimer);
      clearInterval(progressInterval);
    };
  }, [routeEventId]); // Only re-run if eventId changes - guards prevent duplicate loads

  // Windows Authentication check for staff registration - ALWAYS required
  useEffect(() => {
    const checkStaffAuth = async () => {
      if (!routeEventId || authChecked) return;

      // Already authenticated in AuthContext; do not trigger additional Windows auth checks/popups.
      if (isAuthenticated || user) {
        setAuthChecked(true);
        return;
      }

      try {
        // First check if already authenticated via whoami
        const isAuth = await checkWhoami();
        if (isAuth) {
          setAuthChecked(true);
          return;
        }

        // Always require Windows authentication for staff registration
        const eventRepository = new APIEventRepository();
        const authResult = await eventRepository.checkWindowsAuth();

        if (authResult.success && authResult.windowsIdentity?.isAuthenticated) {
          // Store Windows identity with access type based on database user
          const accessType = authResult.databaseUser ? "FULL_ACCESS" : "EVENT_ONLY";
          const isSystemAdmin = authResult.databaseUser?.role === "System Admin";
          const permissions = isSystemAdmin ? ["*"] : authResult.databaseUser?.permissions || [];

          const userData = {
            username: authResult.windowsIdentity.username,
            domain: authResult.windowsIdentity.domain,
            fullName: authResult.databaseUser?.fullName || authResult.windowsIdentity.name,
            accessType: accessType,
            role: authResult.databaseUser?.role || null,
            permissions: permissions,
            databaseUser: authResult.databaseUser || null
          };
          //    localStorage.setItem("windows_auth_user", JSON.stringify(userData));

          // Update auth context
          await loginWithWindows();
          setAuthChecked(true);
        } else {
          console.log("Windows authentication required for staff registration:", authResult.message);
          setAuthChecked(true);
        }
      } catch (error) {
        console.error("Staff authentication failed:", error);
        setAuthChecked(true);
      }
    };

    if (routeEventId && !authChecked) {
      checkStaffAuth();
    }
  }, [routeEventId, authChecked, isAuthenticated, user, checkWhoami, loginWithWindows]);

  // Cleanup sessionStorage on component unmount or when eventId changes
  useEffect(() => {
    return () => {
      // Only clear if form was successfully submitted
      // Otherwise keep it for recovery in case user navigates back
      if (submitted && routeEventId) {
        try {
          sessionStorage.removeItem(`staff-registration-form-${routeEventId}`);
        } catch (error) {
          // Ignore storage errors on cleanup
        }
      }
    };
  }, [submitted, routeEventId]);

  // Hide loader only when both schema is loaded AND minimum time has passed
  useEffect(() => {
    if (schemaLoaded && minDisplayTimePassed) {
      setLoadingSchema(false);
    }
  }, [schemaLoaded, minDisplayTimePassed]);

  // Reset image load error when submission error changes
  useEffect(() => {
    setImageLoadError(false);
  }, [submissionError]);

  // Use the loaded schema or fallback
  const finalSchema: EventSchema = useMemo(() => {
    if (schema) {
      return schema;
    }
    const fallback = schemaJson as EventSchema;
    const idToUse = routeEventId || fallback.eventId;
    return { ...fallback, eventId: idToUse };
  }, [schema, routeEventId]);

  // Parse allowed registration methods from comma-separated string
  const parseAllowedMethods = (methodsString?: string): RegistrationMethod[] => {
    if (!methodsString || methodsString.trim() === "") {
      return ["UAE_PASS", "EMIRATES_ID", "MANUAL_OTP"]; // Default: all methods
    }
    return methodsString
      .split(",")
      .map((m) => m.trim())
      .filter((m) => m === "UAE_PASS" || m === "EMIRATES_ID" || m === "MANUAL_OTP") as RegistrationMethod[];
  };

  const allowedMethods = useMemo(
    () => parseAllowedMethods(finalSchema.allowedRegistrationMethods),
    [finalSchema.allowedRegistrationMethods]
  );

  // Show all configured registration methods, including MANUAL_OTP
  const displayableMethods = allowedMethods;
  const isUaePassOnlyMethod = useMemo(
    () => allowedMethods.length === 1 && allowedMethods[0] === "UAE_PASS",
    [allowedMethods]
  );
  const isManualOnlyMethod = useMemo(
    () => allowedMethods.length === 1 && allowedMethods[0] === "MANUAL_OTP",
    [allowedMethods]
  );
  const shouldShowRegistrationForm = !isUaePassOnlyMethod || uaePassDataLoaded;

  // Auto-select MANUAL_OTP once when methods are loaded/changed.
  // Using functional state update prevents re-select loops when user manually deselects.
  useEffect(() => {
    if (!allowedMethods.includes("MANUAL_OTP")) return;
    setSelectedMethod((prev) => prev ?? "MANUAL_OTP");
  }, [allowedMethods]);

  // Memoize merged fields to prevent unnecessary re-renders in DynamicForm
  const merged: Field[] = useMemo(() => {
    return finalSchema.fields
      .map((f) => {
        const master = masterFieldsJson.find((x) => x.id === f.id);

        // If it's a master field, use master field defaults
        if (master) {
          const type = f.type ?? master.type;
          const label = f.label ?? master.label;

          // Prefer options coming from the schema, then from master field
          const rawOptions: string[] | undefined =
            f.options ??
            master.config?.options ??
            // @ts-expect-error options might be top-level in raw JSON
            master.options;

          let options: FieldOption[] | undefined;
          if (type === "select" && rawOptions) {
            options = rawOptions.map((opt) => ({ label: opt, value: opt }));
          }

          return {
            id: master.id,
            label,
            arabicLabel: f.arabicLabel,
            type,
            required: f.required,
            options
          } as Field;
        }

        // If it's a custom field (not in masterFields), use schema field directly
        if (f.type && f.label) {
          let options: FieldOption[] | undefined;
          if (f.type === "select" && f.options) {
            options = f.options.map((opt) => ({ label: opt, value: opt }));
          }

          return {
            id: f.id,
            label: f.label,
            arabicLabel: f.arabicLabel,
            type: f.type as "text" | "email" | "select" | "phone",
            required: f.required,
            options
          } as Field;
        }

        // Skip fields without type or label
        return null;
      })
      .filter(Boolean) as Field[];
  }, [finalSchema]);

  // Error configuration array with image, message, and title
  const errorConfigurations = [
    {
      errorCode: "EVENT_NOT_FOUND",
      type: "error" as const,
      image: "/images/errors/event-not-found.svg", // You can use icon component or image path
      title: "Event Not Found",
      message: "The event you're trying to register for could not be found. Please check the event ID and try again.",
      bgColor: "bg-red-50 border-red-200",
      textColor: "text-red-800",
      iconColor: "text-red-500",
      IconComponent: XCircle
    },
    {
      errorCode: "EVENT_NOT_AVAILABLE",
      type: "warning" as const,
      image: "/images/errors/event-unavailable.svg",
      title: "Registration Unavailable",
      message: "This event is not currently available for registration. Please check back later or contact the event organizer.",
      bgColor: "bg-amber-50 border-amber-200",
      textColor: "text-amber-800",
      iconColor: "text-amber-500",
      IconComponent: AlertTriangle
    },
    {
      errorCode: "CAPACITY_FULL",
      type: "warning" as const,
      image: "/images/errors/capacity-full.svg",
      title: "Event at Full Capacity",
      message: "This event is at full capacity. Unfortunately, we cannot accept more registrations at this time. Please try another event.",
      bgColor: "bg-amber-50 border-amber-200",
      textColor: "text-amber-800",
      iconColor: "text-amber-500",
      IconComponent: AlertTriangle
    },
    {
      errorCode: "DUPLICATE",
      type: "info" as const,
      image: "/images/errors/already-registered.svg",
      title: "Already Registered",
      message: "You have already registered for this event. Check your email for confirmation details.",
      bgColor: "bg-blue-50 border-blue-200",
      textColor: "text-blue-800",
      iconColor: "text-blue-500",
      IconComponent: CheckCircle2
    },
    {
      errorCode: "NOT_INVITED",
      type: "warning" as const,
      image: "/images/errors/not-invited.svg",
      title: "Access Restricted",
      message: "You are not invited to this event. Please contact the event organizer if you believe this is an error.",
      bgColor: "bg-amber-50 border-amber-200",
      textColor: "text-amber-800",
      iconColor: "text-amber-500",
      IconComponent: AlertTriangle
    },
    {
      errorCode: "VALIDATION_FAILED",
      type: "error" as const,
      image: "/images/errors/validation-failed.svg",
      title: "Validation Failed",
      message: "Please check your registration details and ensure all required fields are filled correctly.",
      bgColor: "bg-red-50 border-red-200",
      textColor: "text-red-800",
      iconColor: "text-red-500",
      IconComponent: XCircle
    },
    {
      errorCode: "DATABASE_ERROR",
      type: "error" as const,
      image: "/images/errors/database-error.svg",
      title: "Database Error",
      message: "A database error occurred while processing your registration. Please try again later or contact support.",
      bgColor: "bg-red-50 border-red-200",
      textColor: "text-red-800",
      iconColor: "text-red-500",
      IconComponent: XCircle
    },
    {
      errorCode: "INTERNAL_SERVER_ERROR",
      type: "error" as const,
      image: "/images/errors/server-error.svg",
      title: "Server Error",
      message: "A server error occurred while processing your request. Please try again later or contact support if the problem persists.",
      bgColor: "bg-red-50 border-red-200",
      textColor: "text-red-800",
      iconColor: "text-red-500",
      IconComponent: XCircle
    },
    {
      errorCode: "UNKNOWN_ERROR",
      type: "error" as const,
      image: "/images/errors/unknown-error.svg",
      title: "Unexpected Error",
      message: "An unexpected error occurred. Please try again or contact support if the problem persists.",
      bgColor: "bg-red-50 border-red-200",
      textColor: "text-red-800",
      iconColor: "text-red-500",
      IconComponent: XCircle
    }
  ];

  // Helper function to parse error code from error message and get error configuration
  const parseErrorInfo = (errorMessage: string): {
    message: string;
    type: "error" | "warning" | "info";
    errorCode: string | null;
    title: string;
    image: string;
    bgColor: string;
    textColor: string;
    iconColor: string;
    IconComponent: typeof XCircle | typeof AlertTriangle | typeof CheckCircle2;
  } => {
    if (!errorMessage) {
      const defaultConfig = errorConfigurations.find((e) => e.errorCode === "UNKNOWN_ERROR") || errorConfigurations[errorConfigurations.length - 1];
      return {
        message: "An error occurred",
        type: "error",
        errorCode: null,
        title: defaultConfig.title,
        image: defaultConfig.image,
        bgColor: defaultConfig.bgColor,
        textColor: defaultConfig.textColor,
        iconColor: defaultConfig.iconColor,
        IconComponent: defaultConfig.IconComponent
      };
    }

    // Check if error message contains an error code
    const upperMessage = errorMessage.toUpperCase();

    // Try to find matching error configuration
    for (const config of errorConfigurations) {
      if (upperMessage.includes(config.errorCode)) {
        // Extract user-friendly message (remove error code if present)
        let cleanMessage = errorMessage;

        // Try to extract message after error code
        const codeIndex = upperMessage.indexOf(config.errorCode);
        if (codeIndex !== -1) {
          const afterCode = errorMessage.substring(codeIndex + config.errorCode.length).trim();
          if (afterCode && !afterCode.startsWith("_") && afterCode.length > 0) {
            cleanMessage = afterCode;
          }
        }

        // Use default message if we couldn't extract a clean one
        if (!cleanMessage || cleanMessage === errorMessage || cleanMessage.length === 0) {
          cleanMessage = config.message;
        }

        return {
          message: cleanMessage,
          type: config.type,
          errorCode: config.errorCode,
          title: config.title,
          image: config.image,
          bgColor: config.bgColor,
          textColor: config.textColor,
          iconColor: config.iconColor,
          IconComponent: config.IconComponent
        };
      }
    }

    // Check for HTTP status codes in message as fallback
    if (errorMessage.includes("400") || errorMessage.toLowerCase().includes("bad request")) {
      const config = errorConfigurations.find((e) => e.errorCode === "VALIDATION_FAILED")!;
      return {
        message: config.message,
        type: config.type,
        errorCode: config.errorCode,
        title: config.title,
        image: config.image,
        bgColor: config.bgColor,
        textColor: config.textColor,
        iconColor: config.iconColor,
        IconComponent: config.IconComponent
      };
    }
    if (errorMessage.includes("404") || errorMessage.toLowerCase().includes("not found")) {
      const config = errorConfigurations.find((e) => e.errorCode === "EVENT_NOT_FOUND")!;
      return {
        message: config.message,
        type: config.type,
        errorCode: config.errorCode,
        title: config.title,
        image: config.image,
        bgColor: config.bgColor,
        textColor: config.textColor,
        iconColor: config.iconColor,
        IconComponent: config.IconComponent
      };
    }
    if (errorMessage.includes("409") || errorMessage.toLowerCase().includes("conflict") || errorMessage.toLowerCase().includes("duplicate")) {
      const config = errorConfigurations.find((e) => e.errorCode === "DUPLICATE")!;
      return {
        message: config.message,
        type: config.type,
        errorCode: config.errorCode,
        title: config.title,
        image: config.image,
        bgColor: config.bgColor,
        textColor: config.textColor,
        iconColor: config.iconColor,
        IconComponent: config.IconComponent
      };
    }
    if (errorMessage.includes("403") || errorMessage.toLowerCase().includes("forbidden") || errorMessage.toLowerCase().includes("not invited")) {
      const config = errorConfigurations.find((e) => e.errorCode === "NOT_INVITED")!;
      return {
        message: config.message,
        type: config.type,
        errorCode: config.errorCode,
        title: config.title,
        image: config.image,
        bgColor: config.bgColor,
        textColor: config.textColor,
        iconColor: config.iconColor,
        IconComponent: config.IconComponent
      };
    }
    if (errorMessage.includes("500") || errorMessage.toLowerCase().includes("server error")) {
      const config = errorConfigurations.find((e) => e.errorCode === "INTERNAL_SERVER_ERROR")!;
      return {
        message: config.message,
        type: config.type,
        errorCode: config.errorCode,
        title: config.title,
        image: config.image,
        bgColor: config.bgColor,
        textColor: config.textColor,
        iconColor: config.iconColor,
        IconComponent: config.IconComponent
      };
    }

    // Default to unknown error
    const defaultConfig = errorConfigurations.find((e) => e.errorCode === "UNKNOWN_ERROR") || errorConfigurations[errorConfigurations.length - 1];
    return {
      message: errorMessage,
      type: "error",
      errorCode: null,
      title: defaultConfig.title,
      image: defaultConfig.image,
      bgColor: defaultConfig.bgColor,
      textColor: defaultConfig.textColor,
      iconColor: defaultConfig.iconColor,
      IconComponent: defaultConfig.IconComponent
    };
  };

  const handleMethodSelect = (method: RegistrationMethod) => {
    // Toggle: if same method is clicked, deselect it
    if (selectedMethod === method) {
      setSelectedMethod(null);
      setOtpSent(false);
      setOtpCode("");
      setEmiratesId("");
      setEmiratesIdExpiryDate("");
      setOtpVerified(false);
      // Reset OTP state
      setOtpAttemptsRemaining(5);
      setOtpLocked(false);
      setOtpSentSuccessfully(false);
      setOtpErrorType(null);
      setOtpExpired(false);
    } else {
      setSelectedMethod(method);
      setOtpSent(false);
      setOtpCode("");
      setEmiratesId("");
      setEmiratesIdExpiryDate("");
      setOtpVerified(false);
      // Reset OTP state
      setOtpAttemptsRemaining(5);
      setOtpLocked(false);
      setOtpSentSuccessfully(false);
      setOtpErrorType(null);
      setOtpExpired(false);
    }
  };

  // Validate Emirates ID - must be exactly 15 digits
  const validateEmiratesId = (id: string): boolean => {
    if (!id || id.trim() === "") {
      return false;
    }
    // Remove all non-digit characters and check length
    const digitsOnly = id.replace(/\D/g, "");
    return digitsOnly.length === 15;
  };

  // Get Emirates ID validation error message
  const getEmiratesIdError = (id: string): string | null => {
    if (!id || id.trim() === "") {
      return "Emirates ID is required";
    }
    const digitsOnly = id.replace(/\D/g, "");
    if (digitsOnly.length === 0) {
      return "Emirates ID must contain digits";
    }
    if (digitsOnly.length < 15) {
      return `Emirates ID must be exactly 15 digits (currently ${digitsOnly.length})`;
    }
    if (digitsOnly.length > 15) {
      return "Emirates ID must be exactly 15 digits";
    }
    return null;
  };

  // Format Emirates ID input (handle digits only, auto-format later if needed)
  const handleEmiratesIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    // Allow only digits and dashes, limit to reasonable length (15 digits + formatting)
    const cleaned = value.replace(/[^\d-]/g, "").slice(0, 19);
    setEmiratesId(cleaned);
  };

  // Validate OTP code
  const validateOTP = (code: string): string | null => {
    if (!code || code.trim() === "") {
      return "OTP code is required";
    }
    const digitsOnly = code.replace(/\D/g, "");
    if (digitsOnly.length === 0) {
      return "OTP code must contain only digits";
    }
    if (digitsOnly.length < 6) {
      return `OTP code must be 6 digits (currently ${digitsOnly.length})`;
    }
    if (digitsOnly.length > 6) {
      return "OTP code must be exactly 6 digits";
    }
    return null;
  };

  // Helper function to validate phone number is complete (not just country code)
  const validatePhoneNumber = (phoneNumber: string | undefined): string | null => {
    if (!phoneNumber || phoneNumber.trim() === "") {
      return null; // Empty is okay if email is provided
    }

    // Remove all non-digit characters except the leading +
    const cleaned = phoneNumber.replace(/[^\d+]/g, "");

    // If the cleaned value is empty, it's invalid
    if (!cleaned || cleaned.trim() === "") {
      return null; // Let DynamicForm handle this validation
    }

    // Extract digits only (without +)
    const digitsOnly = cleaned.replace(/\+/g, "");

    // Check if it starts with + (react-phone-input-2 always includes +)
    if (!cleaned.startsWith("+")) {
      // If it doesn't start with +, it might be a partial entry - let DynamicForm handle it
      return null; // Don't show error here, let the form validation handle it
    }

    // Check if it's just the country code (UAE is +971, so if length is 4 or less, it's incomplete)
    if (cleaned.length <= 4) {
      return "Please enter the complete phone number after the country code";
    }

    // Check total digits (country code + number should be at least 10 digits)
    if (digitsOnly.length < 10) {
      return "Please enter a complete phone number (minimum 10 digits including country code)";
    }

    // Extract country code and phone number parts for more specific validation
    const countryCodeMatch = cleaned.match(/^\+(\d{1,4})/);
    if (countryCodeMatch) {
      const countryCodeLength = countryCodeMatch[1].length;
      const phoneNumberDigits = digitsOnly.substring(countryCodeLength);

      // Validate that the phone number part (excluding country code) has at least 7 digits
      if (phoneNumberDigits.length < 7) {
        return `Please enter a complete phone number. The number should have at least 7 digits after the country code (currently ${phoneNumberDigits.length})`;
      }
    }

    return null; // Valid phone number
  };

  const handleSendOTP = async () => {
    if (!routeEventId) {
      // OTP-specific error - show in modal only
      setOtpModalError("Event ID is missing");
      return;
    }

    if (otpLocked) {
      setOtpModalError("OTP verification is locked. Please try again later.");
      return;
    }

    setOtpLoading(true);
    setSubmissionError(null); // Clear global errors
    setOtpModalError(null); // Clear modal-specific errors
    setOtpErrorType(null);
    setOtpExpired(false);

    try {
      // Extract email or phone from form values
      const phoneNumber = formValues.phoneNumber || formValues.phone || formValues.mobile || undefined;
      const email = formValues.email || formValues.emailAddress || undefined;

      // Validate phone number if provided
      const phoneError = validatePhoneNumber(phoneNumber);
      if (phoneError) {
        setOtpModalError(phoneError);
        setOtpLoading(false);
        return;
      }

      const identifier = {
        email: email || undefined,
        phoneNumber: phoneNumber || undefined
      };

      if (!identifier.email && !identifier.phoneNumber) {
        setOtpModalError("Please provide email or phone number in the form above before sending OTP");
        setOtpLoading(false);
        return;
      }

      const result = await services.sendOTPUseCase.execute(routeEventId, identifier);

      if (result.success) {
        setOtpSent(true);
        setOtpSentSuccessfully(true);
        setOtpCode(""); // Clear previous OTP code
        setOtpExpired(false);
        setOtpErrorType(null);
        // Reset attempts when new OTP is sent
        setOtpAttemptsRemaining(5);
        // Start 30s cooldown before allowing resend
        setOtpResendCooldown(30);
        // Hide success message after 3 seconds
        setTimeout(() => {
          setOtpSentSuccessfully(false);
        }, 3000);
      } else {
        // Backend may return locked/cooldown messages
        setOtpModalError(result.message || "Failed to send OTP. Please try again.");
      }
      setOtpLoading(false);
    } catch (error: any) {
      setOtpLoading(false);

      // If server returns 500 or an internal error, hide OTP modal and show a global-friendly message
      const status = error?.response?.status;
      const message = error?.message || "Failed to send OTP. Please try again.";

      if (status === 500 || String(message).includes("500")) {
        // Hide OTP modal (if it was opened for resend) and reset OTP state
        setShowOTPModal(false);
        setOtpSent(false);
        setOtpCode("");
        setOtpSentSuccessfully(false);
        setOtpErrorType(null);
        setOtpExpired(false);

        // Show a concise server error message in the modal error state
        setOtpModalError("A server error occurred while sending OTP. Please try again later.");
      } else {
        // Non-500 errors (validation, rate limits, etc.) – keep modal open and show the specific message
        setOtpModalError(message);
      }
    }
  };

  const handleVerifyOTP = async (): Promise<boolean> => {
    if (!routeEventId) {
      setSubmissionError("Event ID is missing");
      return false;
    }

    if (otpLocked) {
      setSubmissionError("OTP verification is locked after 5 failed attempts. Please request a new OTP.");
      return false;
    }

    const otpError = validateOTP(otpCode);
    if (otpError) {
      setSubmissionError(otpError);
      return false;
    }

    if (otpCode.length !== 6) {
      setSubmissionError("OTP code must be 6 digits");
      return false;
    }

    // Extract email or phone from form values
    const identifier = {
      email: formValues.email || formValues.emailAddress || undefined,
      phoneNumber: formValues.phoneNumber || formValues.phone || formValues.mobile || undefined
    };

    if (!identifier.email && !identifier.phoneNumber) {
      setSubmissionError("Please provide email or phone number in the form above before verifying OTP");
      return false;
    }

    setVerifyingOTP(true);
    setSubmissionError(null);
    setOtpErrorType(null);
    setOtpSentSuccessfully(false);

    try {
      const result = await services.verifyOTPUseCase.execute(routeEventId, otpCode, identifier);

      if (result.verified) {
        setOtpVerified(true);
        setOtpCode("");
        setOtpErrorType(null);
        setOtpExpired(false);
        // Reset attempts on successful verification
        setOtpAttemptsRemaining(5);
        return true;
      } else {
        // Handle different error types from API response
        const errorMessage = result.message || "Invalid OTP code";
        const upperMessage = errorMessage.toUpperCase();

        const newAttemptsRemaining = otpAttemptsRemaining - 1;

        // Check for specific error types in the message
        if (upperMessage.includes("EXPIRED") || upperMessage.includes("NO LONGER VALID")) {
          setOtpErrorType("expired");
          setOtpExpired(true);
          setOtpSent(false); // Reset to allow requesting new OTP
          setSubmissionError("OTP Expired – This OTP is no longer valid, please request a new one.");
        } else if (upperMessage.includes("TOO MANY") || upperMessage.includes("LOCKED") || upperMessage.includes("EXCEEDED")) {
          setOtpErrorType("too_many_attempts");
          setOtpLocked(true);
          setOtpAttemptsRemaining(0);
          setSubmissionError("Too Many Attempts – OTP verification is locked after 5 failed attempts, please try again later.");
        } else {
          setOtpErrorType("invalid");
          setOtpAttemptsRemaining(newAttemptsRemaining);

          if (newAttemptsRemaining <= 0) {
            setOtpLocked(true);
            setSubmissionError("Too Many Attempts – OTP verification is locked after 5 failed attempts, please try again later.");
          } else {
            setSubmissionError(
              `Invalid OTP – The entered OTP is incorrect, please try again. Attempts Remaining – You have ${newAttemptsRemaining} attempts left to verify your OTP.`
            );
          }
        }
        return false;
      }
    } catch (error: any) {
      const errorMessage = error.message || "Failed to verify OTP. Please try again.";
      const upperMessage = errorMessage.toUpperCase();

      const newAttemptsRemaining = otpAttemptsRemaining - 1;

      // Check for specific error types in the error message
      if (upperMessage.includes("EXPIRED") || upperMessage.includes("NO LONGER VALID")) {
        setOtpErrorType("expired");
        setOtpExpired(true);
        setOtpSent(false);
        setSubmissionError("OTP Expired – This OTP is no longer valid, please request a new one.");
      } else if (upperMessage.includes("TOO MANY") || upperMessage.includes("LOCKED") || upperMessage.includes("EXCEEDED")) {
        setOtpErrorType("too_many_attempts");
        setOtpLocked(true);
        setOtpAttemptsRemaining(0);
        setSubmissionError("Too Many Attempts – OTP verification is locked after 5 failed attempts, please try again later.");
      } else {
        setOtpErrorType("invalid");
        setOtpAttemptsRemaining(newAttemptsRemaining);

        if (newAttemptsRemaining <= 0) {
          setOtpLocked(true);
          setSubmissionError("Too Many Attempts – OTP verification is locked after 5 failed attempts, please try again later.");
        } else {
          setSubmissionError(
            `Invalid OTP – The entered OTP is incorrect, please try again. Attempts Remaining – You have ${newAttemptsRemaining} attempts left to verify your OTP.`
          );
        }
      }
      return false;
    } finally {
      setVerifyingOTP(false);
    }
  };

  const handleOTPChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, "").slice(0, 6);
    setOtpCode(value);
    // Clear error when user starts typing
    if (otpErrorType) {
      setOtpErrorType(null);
      setSubmissionError(null);
    }
  };

  const handleResendOTP = () => {
    // Reset OTP state for resend
    setOtpSent(false);
    setOtpCode("");
    setOtpSentSuccessfully(false);
    setOtpErrorType(null);
    setOtpExpired(false);
    // Reset attempts when resending
    setOtpAttemptsRemaining(5);
    setOtpLocked(false);
    // Send new OTP
    handleSendOTP();
  };

  const handleUAE_PASSAuth = async () => {
    if (!routeEventId) {
      setSubmissionError("Event ID is missing");
      return;
    }

    // Toggle: if already selected, deselect it
    if (selectedMethod === "UAE_PASS") {
      handleMethodSelect("UAE_PASS");
      return;
    }

    // Select UAE PASS first

    handleMethodSelect("UAE_PASS");
    const UAE_PASS_CLIENT_ID = import.meta.env.VITE_ClientID || "";
    if (!UAE_PASS_CLIENT_ID) {
      setSubmissionError("UAE PASS client ID is not configured");
      return;
    }

    const params = new URLSearchParams({
      redirect_uri: import.meta.env.VITE_RedirectURL + "?eventurl=" + window.location.href,
      client_id: UAE_PASS_CLIENT_ID,
      response_type: "code",
      state: import.meta.env.VITE_State,
      scope: "urn:uae:digitalid:profile:general",
      acr_values: "urn:safelayer:tws:policies:authentication:level:low",
      ui_locales: "en"
    });

    const uaePassAuthUrl = `${import.meta.env.VITE_AuthorizeUrl}?${params.toString()}`;
    // Redirect user to UAE PASS
    window.location.href = uaePassAuthUrl;
  };

  // Reset callback processed flag when eventId changes
  useEffect(() => {
    uaePassCallbackProcessed.current = false;
    setUaePassDataLoaded(false);
    setLoadingUaePassData(false);
  }, [routeEventId]);

  // Handle UAE PASS callback (after redirect back)
  useEffect(() => {
    // Skip if already processed
    if (uaePassCallbackProcessed.current) {
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const attendeeId = urlParams.get("attendeeid");

    if (!attendeeId) return;

    // Mark as processed immediately to prevent re-execution
    uaePassCallbackProcessed.current = true;

    // Process the callback asynchronously
    const processCallback = async () => {
      if (!routeEventId) {
        setSubmissionError("Event ID is missing");
        uaePassCallbackProcessed.current = false; // Reset on error
        return;
      }

      setSubmissionError(null);
      setLoadingUaePassData(true);
      setUaePassDataLoaded(false);

      try {
        const response = await servicesRef.current.uaePassCallbackUseCase.execute(attendeeId);

        if (response.success && response.userData) {
          // Pre-fill form with user data
          setFormValues((prevValues) => ({
            ...prevValues,
            fullName: response.userData?.fullName || prevValues.fullName || "",
            email: response.userData?.email || prevValues.email || "",
            phoneNumber: response.userData?.mobile || prevValues.phoneNumber || "",
            emiratesId: response.userData?.emiratesId || prevValues.emiratesId || "",
            nationality: response.userData?.nationality || prevValues.nationality || "",
            dateOfBirth: response.userData?.dateOfBirth || prevValues.dateOfBirth || "",
            gender: response.userData?.gender || prevValues.gender || ""
          }));

          setSelectedMethod("UAE_PASS");
          setOtpVerified(true); // Skip OTP for UAE PASS
          setUaePassDataLoaded(true);

          // Clean URL by removing query parameters
          window.history.replaceState({}, document.title, window.location.pathname);
        } else {
          setUaePassDataLoaded(false);
          setSubmissionError("UAE PASS authentication failed");
          uaePassCallbackProcessed.current = false; // Reset on failure so user can retry
        }
      } catch (error: any) {
        setUaePassDataLoaded(false);
        setSubmissionError(error.message || "UAE PASS authentication failed. Please try again.");
        uaePassCallbackProcessed.current = false; // Reset on error so user can retry
      } finally {
        setLoadingUaePassData(false);
      }
    };

    processCallback();
  }, [routeEventId]); // services accessed via ref, not in dependencies

  const handleEmiratesIDSubmit = async () => {
    if (!routeEventId) {
      setSubmissionError("Event ID is missing");
      return;
    }

    if (!emiratesId.trim()) {
      setSubmissionError("Emirates ID is required");
      return;
    }

    const error = getEmiratesIdError(emiratesId);
    if (error) {
      setSubmissionError(error);
      return;
    }

    if (!validateEmiratesId(emiratesId)) {
      setSubmissionError("Emirates ID must be exactly 15 digits");
      return;
    }

    // Validate expiry date
    if (!emiratesIdExpiryDate || emiratesIdExpiryDate.trim() === "") {
      setSubmissionError("Emirates ID expiry date is required");
      return;
    }

    const expiryDate = new Date(emiratesIdExpiryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (expiryDate < today) {
      setSubmissionError("Emirates ID expiry date cannot be in the past");
      return;
    }

    setSubmissionError(null);

    try {
      // Clean Emirates ID to digits only
      const cleanedEmiratesId = emiratesId.replace(/\D/g, "");

      const response = await services.validateEmiratesIdUseCase.execute(routeEventId, cleanedEmiratesId, expiryDate.toISOString());

      if (response.isValid) {
        // If attendee data exists, pre-fill form
        if (response.attendeeData) {
          setFormValues({
            ...formValues,
            fullName: response.attendeeData.fullName || formValues.fullName || "",
            email: response.attendeeData.email || formValues.email || "",
            phoneNumber: response.attendeeData.mobile || formValues.phoneNumber || "",
            emiratesId: (response.attendeeData as any).emiratesId || cleanedEmiratesId,
            nationality: response.attendeeData.nationality || formValues.nationality || "",
            dateOfBirth: response.attendeeData.dateOfBirth || formValues.dateOfBirth || "",
            gender: response.attendeeData.gender || formValues.gender || ""
          });
        }

        setOtpVerified(true); // Skip OTP for Emirates ID
      } else {
        setSubmissionError("Invalid Emirates ID");
      }
    } catch (error: any) {
      setSubmissionError(error.message || "Failed to validate Emirates ID. Please try again.");
    }
  };

  // Validate form submission without OTP check (used after OTP is verified)
  const validateFormSubmissionWithoutOTP = (values: FormValues): boolean => {
    // Check if all required fields are filled
    const requiredFields = merged.filter((f) => f.required);
    const missingFields = requiredFields.filter((f) => !values[f.id] || values[f.id].trim() === "");

    if (missingFields.length > 0) {
      return false;
    }

    // Additional validation based on registration method (skip OTP check)
    if (selectedMethod === "EMIRATES_ID") {
      if (!emiratesId || !validateEmiratesId(emiratesId)) {
        return false;
      }
      if (!emiratesIdExpiryDate || emiratesIdExpiryDate.trim() === "") {
        return false;
      }
      // Validate expiry date is not in the past
      const expiryDate = new Date(emiratesIdExpiryDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expiryDate < today) {
        return false;
      }
    }

    // Skip OTP verification check since we just verified it

    return true;
  };

  // Validate all form data before submission
  const validateFormSubmission = (values: FormValues): boolean => {
    // Check if all required fields are filled
    const requiredFields = merged.filter((f) => f.required);
    const missingFields = requiredFields.filter((f) => !values[f.id] || values[f.id].trim() === "");

    if (missingFields.length > 0) {
      return false;
    }

    // Additional validation based on registration method
    if (selectedMethod === "EMIRATES_ID") {
      if (!emiratesId || !validateEmiratesId(emiratesId)) {
        return false;
      }
      if (!emiratesIdExpiryDate || emiratesIdExpiryDate.trim() === "") {
        return false;
      }
      // Validate expiry date is not in the past
      const expiryDate = new Date(emiratesIdExpiryDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expiryDate < today) {
        return false;
      }
    }

    if (selectedMethod === "MANUAL_OTP") {
      if (!otpVerified) {
        return false;
      }
    }

    // Require OTP verification for manual form filling (no method selected)
    if (!selectedMethod) {
      // Check if user has entered email or phone (indicating manual form filling)
      const hasEmailOrPhone = !!(values.email || values.emailAddress || values.phoneNumber || values.phone || values.mobile);
      if (hasEmailOrPhone && !otpVerified) {
        return false;
      }
    }

    return true;
  };

  // Actual form submission logic (separated to avoid recursion)
  const performSubmission = async (values: FormValues, skipOtpCheck: boolean = false) => {
    // Final validation (skip OTP check if we just verified it)
    const validationPassed = skipOtpCheck ? validateFormSubmissionWithoutOTP(values) : validateFormSubmission(values);

    if (!validationPassed) {
      setSubmissionError("Please complete all required fields and verify OTP if required.");
      return;
    }

    // Proceed with actual form submission
    setSubmitting(true);

    try {
      // Allow submission without method selection - pass undefined if not selected
      const method = selectedMethod || "MANUAL";

      // Ensure eventId exists
      if (!routeEventId) {
        // Normalize to EVENT_NOT_FOUND so the nice error screen is shown
        throw new Error(
          "EVENT_NOT_FOUND The event you're trying to register for could not be found. Please check the event ID and try again."
        );
      }

      // Prepare registration data with method-specific fields
      const registrationData = {
        ...values,
        // Add method-specific data
        ...(selectedMethod === "EMIRATES_ID" && {
          emiratesId: emiratesId.replace(/\D/g, ""), // Clean to digits only
          emiratesIdExpiryDate: emiratesIdExpiryDate
        })
      };

      // Call use case - method can be undefined
      const response = await services.registerForEventUseCase.execute(routeEventId, method, registrationData);

      setRegistrationResponse(response);
      setSubmitted(true);
      setSubmitting(false);

      clearFormValuesFromStorage();
      setPendingSubmissionValues(null);
    } catch (error: any) {
      // Handle error
      setSubmitting(false);
      const errorMessage = error.message || "Failed to submit registration. Please try again.";
      setSubmissionError(errorMessage);
      // Keep form visible so user can fix errors
    }
  };

  const handleSubmit = async (values: FormValues) => {
    // Clear previous errors
    setSubmissionError(null);
    setOtpErrorType(null);
    setOtpModalError(null);

    // Check if OTP is required (manual flows only)
    const requiresOTP =
      selectedMethod === "MANUAL_OTP" ||
      (!selectedMethod && (values.email || values.emailAddress || values.phoneNumber || values.phone || values.mobile));

    // If OTP is required, ALWAYS handle submission via the OTP modal
    if (requiresOTP) {
      // Validate phone number before proceeding if phone is provided
      const phoneNumber = values.phoneNumber || values.phone || values.mobile || undefined;
      const phoneError = validatePhoneNumber(phoneNumber);
      if (phoneError) {
        setSubmissionError(phoneError);
        return;
      }

      // Store form values for later submission (both in state and sessionStorage as backup)
      setPendingSubmissionValues(values);
      saveFormValuesToStorage(values); // Backup to sessionStorage

      // If OTP not sent yet, send it and show modal
      if (!otpSent && !otpLocked) {
        setSubmitting(true);
        try {
          await handleSendOTP();
          setOtpModalCode(""); // Clear modal OTP code
          setShowOTPModal(true);
          setSubmitting(false);
        } catch (error: any) {
          setSubmitting(false);
          setSubmissionError(error.message || "Failed to send OTP. Please try again.");
        }
      } else if (otpSent && !otpLocked) {
        // OTP already sent, just show modal
        setOtpModalCode(""); // Clear modal OTP code
        setShowOTPModal(true);
      } else if (otpLocked) {
        setSubmissionError("OTP verification is locked. Please request a new OTP.");
      }
      return;
    }

    // If OTP is not required (UAE_PASS / EMIRATES_ID), proceed with submission directly
    await performSubmission(values);
  };

  // Handle OTP verification in modal
  const handleModalOTPVerify = async () => {
    if (!routeEventId) {
      setOtpModalError("Event ID is missing");
      return;
    }

    if (otpLocked) {
      setOtpModalError("OTP verification is locked after 5 failed attempts. Please request a new OTP.");
      return;
    }

    const otpError = validateOTP(otpModalCode);
    if (otpError) {
      setOtpModalError(otpError);
      return;
    }

    if (otpModalCode.length !== 6) {
      setOtpModalError("OTP code must be 6 digits");
      return;
    }

    // Extract email or phone from form values
    const identifier = {
      email: formValues.email || formValues.emailAddress || undefined,
      phoneNumber: formValues.phoneNumber || formValues.phone || formValues.mobile || undefined
    };

    if (!identifier.email && !identifier.phoneNumber) {
      setOtpModalError("Please provide email or phone number in the form above before verifying OTP");
      return;
    }

    setVerifyingOTP(true);
    setSubmissionError(null);
    setOtpModalError(null);
    setOtpErrorType(null);
    setOtpSentSuccessfully(false);

    try {
      const result = await services.verifyOTPUseCase.execute(routeEventId, otpModalCode, identifier);

      if (result.verified) {
        // Set OTP verified state first
        setOtpVerified(true);
        setOtpCode(otpModalCode); // Sync with main OTP code
        setOtpModalCode("");
        setOtpErrorType(null);
        setOtpExpired(false);
        setOtpAttemptsRemaining(5);
        setOtpModalError(null); // Clear any previous errors
        setOtpSentSuccessfully(false); // Hide 'sent' message, we'll show 'verified' message

        // Get form values from multiple sources (priority: pendingSubmissionValues > sessionStorage > current formValues)
        let submissionValues: FormValues | null = pendingSubmissionValues;

        // If pendingSubmissionValues is null, try to recover from sessionStorage
        if (!submissionValues) {
          submissionValues = loadFormValuesFromStorage();
        }

        // If still null, use current formValues as last resort
        if (!submissionValues) {
          submissionValues = formValues;
        }

        // Show success message in modal for a short time, then close and submit
        if (submissionValues && Object.keys(submissionValues).length > 0) {
          setTimeout(async () => {
            setShowOTPModal(false);
            // Clear sessionStorage backup after successful submission
            clearFormValuesFromStorage();
            await performSubmission(submissionValues!, true); // true = skip OTP check
          }, 1500);
        } else {
          // This should never happen, but if it does, show helpful error
          setOtpModalError("Unable to retrieve form data. Please keep the form open and try again.");
          console.error("[StaffRegistration] Form data lost: pendingSubmissionValues, sessionStorage, and formValues all empty");
        }
      } else {
        // Handle different error types from API response (use backend messages)
        const errorMessage = result.message || "Invalid OTP code";
        const upperMessage = errorMessage.toUpperCase();

        // 7) OTP Expired
        if (upperMessage.includes("EXPIRED")) {
          setOtpErrorType("expired");
          setOtpExpired(true);
          setOtpSent(false);
          setOtpModalError("OTP Expired – This OTP is no longer valid, please request a new one.");
        }
        // 8) Too Many Attempts / Locked
        else if (upperMessage.includes("TOO MANY") || upperMessage.includes("LOCKED")) {
          setOtpErrorType("too_many_attempts");
          setOtpLocked(true);
          setOtpAttemptsRemaining(0);
          setOtpModalError("Too Many Attempts – OTP verification is locked after 5 failed attempts, please try again later.");
        }
        // 5) Invalid OTP + 6) Attempts Remaining
        else {
          setOtpErrorType("invalid");
          // Try to parse "Attempts remaining: X" from backend message
          const match = upperMessage.match(/ATTEMPTS REMAINING[:]?(\s*)(\d+)/i);
          if (match && match[2]) {
            const remaining = parseInt(match[2], 10);
            if (!Number.isNaN(remaining)) {
              setOtpAttemptsRemaining(remaining);
              if (remaining <= 0) {
                setOtpLocked(true);
                setOtpModalError("Too Many Attempts – OTP verification is locked after 5 failed attempts, please try again later.");
              } else {
                setOtpModalError(
                  `Invalid OTP – The entered OTP is incorrect, please try again. Attempts Remaining – You have ${remaining} attempts left to verify your OTP.`
                );
              }
              return;
            }
          }
          // Fallback if we cannot parse attempts
          setOtpModalError("Invalid OTP – The entered OTP is incorrect, please try again.");
        }
      }
    } catch (error: any) {
      // Extract error message from API response
      const errorMessage = error.message || "Failed to verify OTP. Please try again.";
      const upperMessage = errorMessage.toUpperCase();

      // Check for specific error types in the error message (same logic as successful response)
      if (upperMessage.includes("EXPIRED") || upperMessage.includes("NO LONGER VALID")) {
        setOtpErrorType("expired");
        setOtpExpired(true);
        setOtpSent(false);
        setOtpModalError("OTP Expired – This OTP is no longer valid, please request a new one.");
      } else if (upperMessage.includes("TOO MANY") || upperMessage.includes("LOCKED") || upperMessage.includes("EXCEEDED")) {
        setOtpErrorType("too_many_attempts");
        setOtpLocked(true);
        setOtpAttemptsRemaining(0);
        setOtpModalError("Too Many Attempts – OTP verification is locked after 5 failed attempts, please try again later.");
      } else if (upperMessage.includes("INVALID") || upperMessage.includes("INCORRECT")) {
        // Try to parse attempts remaining from error message
        setOtpErrorType("invalid");
        const match = upperMessage.match(/ATTEMPTS REMAINING[:]?(\s*)(\d+)/i);
        if (match && match[2]) {
          const remaining = parseInt(match[2], 10);
          if (!Number.isNaN(remaining)) {
            setOtpAttemptsRemaining(remaining);
            if (remaining <= 0) {
              setOtpLocked(true);
              setOtpModalError("Too Many Attempts – OTP verification is locked after 5 failed attempts, please try again later.");
            } else {
              setOtpModalError(
                `Invalid OTP – The entered OTP is incorrect, please try again. Attempts Remaining – You have ${remaining} attempts left to verify your OTP.`
              );
            }
          } else {
            setOtpModalError("Invalid OTP – The entered OTP is incorrect, please try again.");
          }
        } else {
          // Decrement attempts if we can't parse from message
          const newAttemptsRemaining = otpAttemptsRemaining - 1;
          setOtpAttemptsRemaining(newAttemptsRemaining);
          if (newAttemptsRemaining <= 0) {
            setOtpLocked(true);
            setOtpModalError("Too Many Attempts – OTP verification is locked after 5 failed attempts, please try again later.");
          } else {
            setOtpModalError(
              `Invalid OTP – The entered OTP is incorrect, please try again. Attempts Remaining – You have ${newAttemptsRemaining} attempts left to verify your OTP.`
            );
          }
        }
      } else {
        // Generic error - show the actual error message
        setOtpModalError(errorMessage);
      }
    } finally {
      setVerifyingOTP(false);
    }
  };

  // Handle resend OTP from modal
  const handleModalResendOTP = async () => {
    // Prevent manual resend while cooldown is active
    if (otpResendCooldown > 0) return;

    setOtpModalCode("");
    setOtpSentSuccessfully(false);
    setOtpErrorType(null);
    setOtpExpired(false);
    setOtpAttemptsRemaining(5);
    setOtpLocked(false);
    setOtpModalError(null);
    await handleSendOTP();
  };

  // Show error screen if there's a submission error (and form was attempted)
  if (!submitted && submissionError && !submitting) {
    const errorInfo = parseErrorInfo(submissionError);
    const { IconComponent, title, message, image, bgColor, textColor, iconColor } = errorInfo;

    return (
      <div className="container mx-auto py-12 px-4 sm:px-6 lg:px-8 max-w-xl">
        <div className="bg-white rounded-xl shadow-sm p-8 text-center space-y-6">
          {/* Error Image/Icon */}
          {image && image.startsWith("/images/") && !imageLoadError ? (
            <img
              src={image}
              alt={title}
              className="mx-auto w-32 h-32 object-contain"
              onError={() => setImageLoadError(true)}
            />
          ) : (
            <IconComponent size={64} className={`mx-auto ${iconColor}`} />
          )}

          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>

          {/* Error Message */}
          <div className={`${bgColor} border rounded-lg p-4`}>
            <p className={`text-sm font-medium ${textColor}`}>{message}</p>
          </div>

          {errorInfo.type === "error" && (
            <div className="pt-4 space-y-3">
              <p className="text-sm text-gray-600">If you continue to experience issues, please contact support.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Show success screen if registration was successful
  if (submitted && registrationResponse) {
    return (
      <div className="container mx-auto py-12 px-4 sm:px-6 lg:px-8 max-w-xl">
        <div className="bg-white rounded-xl shadow-sm p-8 text-center space-y-6">
          <CheckCircle2 size={64} className="mx-auto text-green-500" />
          <h1 className="text-2xl font-bold text-gray-900">Registration Submitted Successfully!</h1>

          {/* Registration Code */}
          {registrationResponse.registrationCode && (
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-600 mb-1">Registration Code</p>
              <p className="text-2xl font-mono font-bold text-gray-900">{registrationResponse.registrationCode}</p>
            </div>
          )}

          {/* QR Code - Disabled */}
          {/* {registrationResponse.qrCodeUrl && (
            <div className="flex flex-col items-center">
              <img
                src={registrationResponse.qrCodeUrl}
                alt="QR Code"
                className="w-48 h-48 border-2 border-gray-200 rounded-lg"
              />
              <a
                href={registrationResponse.qrCodeUrl}
                download={`qr-code-${registrationResponse.registrationCode || 'registration'}.png`}
                className="mt-2 text-primary hover:text-primary/90 text-sm underline"
              >
                Download QR Code
              </a>
            </div>
          )} */}

          {/* Status Message */}
          <div className="pt-4 border-t border-gray-200">
            {registrationResponse.status === "PENDING" && (
              <p className="text-sm text-amber-600">
                Your registration is pending approval. You will receive a confirmation email once approved.
              </p>
            )}
            {registrationResponse.status === "APPROVED" && (
              <p className="text-sm text-green-600">
                Your registration has been approved! Check your email for event details.
              </p>
            )}
            {registrationResponse.status === "CONFIRMED" && (
              <p className="text-sm text-green-600">Your registration is confirmed! See you at the event.</p>
            )}
          </div>

          <p className="text-sm text-gray-600">
            You will receive a confirmation email with event details and your QR pass once processing is complete.
          </p>
        </div>
      </div>
    );
  }

  // Show everything on one page
  return (
    <div className="min-h-screen w-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-3xl relative">
        <div
          className={`bg-white rounded-xl shadow-sm p-8 space-y-8 transition-all duration-300 ${
            loadingSchema ? "blur-sm opacity-60 pointer-events-none" : "blur-0 opacity-100"
          }`}
        >
          {/* Header */}
          <div className="relative">
            {/* Images and Heading Layout */}
            <div className="flex items-start justify-between mb-4 pb-4">
              {/* Left Image */}
              <div className="flex-shrink-0">
                <img
                  src="/images/Logo.svg"
                  alt=""
                  className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 object-contain "
                  onError={(e) => {
                    // Hide image if not found
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>

              {/* Center Heading */}
              <div className="flex-1 text-center px-4">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">{schema?.eventTitle || "Staff Registration"}</h1>
                <p className="text-gray-600">Staff Registration - Please complete the registration form below</p>
              </div>

              {/* Right Image */}
              <div className="flex-shrink-0">
                <img
                  src="/images/emblem.svg"
                  alt=""
                  className="w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 object-contain"
                  onError={(e) => {
                    // Hide image if not found
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            </div>
          </div>

          {/* Registration Method Selection */}
          {displayableMethods.length > 0 && !isManualOnlyMethod && (
            <div className="border-b border-gray-200 pb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Registration Method</h2>
              <div
                className={`grid grid-cols-1 ${
                  displayableMethods.length === 2 ? "md:grid-cols-2" : displayableMethods.length === 3 ? "md:grid-cols-3" : "md:grid-cols-1"
                } gap-4`}
              >
                {/* UAE PASS */}
                {allowedMethods.includes("UAE_PASS") && (
                  <button
                    onClick={handleUAE_PASSAuth}
                    className={`p-4 rounded-lg border-2 transition-all text-center ${
                      selectedMethod === "UAE_PASS"
                        ? "border-purple-500 bg-purple-50"
                        : "border-gray-200 hover:border-purple-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="p-3 mx-auto mb-3 flex items-center justify-center">
                      <img src="/images/EN_UAEPASS_Login_Btn.svg" alt="UAE PASS" className="object-contain" />
                    </div>
                    <p className="text-xs text-gray-600">Auto fetch user information</p>
                  </button>
                )}

                {/* Emirates ID */}
                {allowedMethods.includes("EMIRATES_ID") && (
                  <button
                    onClick={() => handleMethodSelect("EMIRATES_ID")}
                    className={`p-4 rounded-lg border-2 transition-all text-center ${
                      selectedMethod === "EMIRATES_ID"
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 hover:border-indigo-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="p-3 bg-indigo-100 rounded-full w-12 h-12 mx-auto mb-3 flex items-center justify-center">
                      <CreditCard size={24} className="text-indigo-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1 text-sm">Emirates ID</h3>
                    <p className="text-xs text-gray-600">Auto-fill details</p>
                  </button>
                )}

                {/* Manual OTP */}
                {allowedMethods.includes("MANUAL_OTP") && (
                  <button
                    onClick={() => handleMethodSelect("MANUAL_OTP")}
                    className={`p-4 rounded-lg border-2 transition-all text-center ${
                      selectedMethod === "MANUAL_OTP"
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-gray-200 hover:border-emerald-300 hover:bg-gray-50"
                    }`}
                  >
                    <div className="p-3 bg-emerald-100 rounded-full w-12 h-12 mx-auto mb-3 flex items-center justify-center">
                      <Mail size={24} className="text-emerald-600" />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1 text-sm">Manual</h3>
                    <p className="text-xs text-gray-600">Verify with OTP</p>
                  </button>
                )}
              </div>
              {selectedMethod && (
                <p className="text-xs text-gray-500 mt-3 text-center">Click the selected method again to deselect</p>
              )}
            </div>
          )}

          {/* Emirates ID Input (if selected) */}
          {selectedMethod === "EMIRATES_ID" && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Enter Emirates ID</h3>
              <div className="space-y-4">
                <div>
                  <Input
                    label="Emirates ID"
                    placeholder="Enter 15 digits (e.g., 784123412345671)"
                    value={emiratesId}
                    onChange={handleEmiratesIdChange}
                    className="w-full"
                  />
                  {emiratesId &&
                    (() => {
                      const error = getEmiratesIdError(emiratesId);
                      return error ? <p className="text-xs text-red-600 mt-1">{error}</p> : null;
                    })()}
                </div>
                <div>
                  <Input
                    type="date"
                    label="Emirates ID Expiry Date"
                    value={emiratesIdExpiryDate}
                    onChange={(e) => setEmiratesIdExpiryDate(e.target.value)}
                    className="w-full"
                    required
                  />
                  {emiratesIdExpiryDate &&
                    (() => {
                      const expiryDate = new Date(emiratesIdExpiryDate);
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      if (expiryDate < today) {
                        return <p className="text-xs text-red-600 mt-1">Emirates ID expiry date cannot be in the past</p>;
                      }
                      return null;
                    })()}
                </div>
                <Button
                  onClick={handleEmiratesIDSubmit}
                  variant="primary"
                  disabled={!validateEmiratesId(emiratesId) || !emiratesIdExpiryDate.trim() || getEmiratesIdError(emiratesId) !== null}
                  fullWidth
                >
                  Verify
                </Button>
              </div>
              <p className="text-xs text-gray-600 mt-2">Your Emirates ID will be used to auto-fill registration details</p>
            </div>
          )}

          {/* Registration Form */}
          {shouldShowRegistrationForm ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-3">Registration Details</h2>

              {/* Always show the form and submit button - submit button handles OTP flow internally */}
              <DynamicForm
                fields={merged}
                values={formValues}
                onValuesChange={setFormValues}
                showSubmit={true}
                submitLabel={
                  submitting ? (otpLoading ? "Sending OTP..." : verifyingOTP ? "Verifying OTP..." : "Submitting...") : "Submit Registration"
                }
                onSubmit={handleSubmit}
                submitting={submitting}
              />

              {/* Show message if Emirates ID method selected but not verified */}
              {selectedMethod === "EMIRATES_ID" && !emiratesId.trim() && (
                <div className="text-center py-4 text-amber-600 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm">Please enter and verify your Emirates ID above to submit registration</p>
                </div>
              )}

              {/* Display submission errors */}
              {submissionError && (
                <div
                  className={`text-center py-4 ${
                    (() => {
                      const errorInfo = parseErrorInfo(submissionError);
                      return errorInfo.bgColor + " " + errorInfo.textColor + " border";
                    })()
                  } rounded-lg`}
                >
                  <p className="text-sm font-medium">{parseErrorInfo(submissionError).message}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 border-b border-gray-200 pb-3">Registration Details</h2>
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-5 text-center">
                {loadingUaePassData ? (
                  <div className="flex flex-col items-center gap-2 text-purple-700">
                    <Loader2 size={20} className="animate-spin" />
                    <p className="text-sm font-medium">Loading your UAE PASS details...</p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-medium text-purple-800">Continue with UAE PASS to load your details.</p>
                    <p className="text-xs text-purple-700 mt-1">
                      The registration form will appear after your attendee data is returned successfully.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Loader Overlay - Shows when loadingSchema is true */}
        <PageLoader
          isLoading={loadingSchema}
          title="Loading Staff Registration Form"
          description="Please wait while we prepare your staff registration form. This will only take a moment."
          showProgress={true}
          progress={progress}
        />
      </div>

      {/* OTP Verification Modal */}
      <Modal
        isOpen={showOTPModal}
        onClose={() => {
          setShowOTPModal(false);
          setOtpModalCode("");
          // Don't clear pendingSubmissionValues or sessionStorage on modal close
          // Keep them in case user wants to retry
          setOtpModalError(null);
        }}
        title="Verify Your Identity"
        size="md"
      >
        <div className="space-y-6">
          {/* Loading state when OTP is being sent */}
          {otpLoading && !otpSent && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center gap-3">
              <Loader2 size={20} className="text-blue-600 flex-shrink-0 animate-spin" />
              <div>
                <p className="text-sm font-medium text-blue-800">Sending OTP...</p>
                <p className="text-xs text-blue-700 mt-1">Please wait while we send the verification code to your phone.</p>
              </div>
            </div>
          )}

          {/* Success message when OTP is sent */}
          {otpSentSuccessfully && otpSent && !otpVerified && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle2 size={20} className="text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-800">OTP Sent Successfully</p>
                <p className="text-xs text-green-700 mt-1">A verification code has been sent to your phone.</p>
              </div>
            </div>
          )}

          {/* Success message when OTP is verified (shown in modal itself) */}
          {otpVerified && !otpErrorType && !verifyingOTP && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <CheckCircle2 size={20} className="text-green-600 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-800">OTP Verified</p>
                <p className="text-xs text-green-700 mt-1">Your email / mobile has been successfully verified.</p>
              </div>
            </div>
          )}

          {/* OTP Input */}
          <div>
            <Input
              label="Enter OTP Code"
              placeholder="000000"
              value={otpModalCode}
              onChange={(e) => {
                const value = e.target.value.replace(/\D/g, "").slice(0, 6);
                setOtpModalCode(value);
                // Clear error when user starts typing
                if (otpErrorType) {
                  setOtpErrorType(null);
                  setSubmissionError(null);
                }
              }}
              maxLength={6}
              className="text-center text-3xl tracking-widest font-mono"
              autoFocus
            />
            {otpModalCode && validateOTP(otpModalCode) && <p className="text-xs text-red-600 mt-1">{validateOTP(otpModalCode)}</p>}
            <p className="text-xs text-gray-500 mt-2">Please enter the 6-digit code sent to your registered email/number.</p>
          </div>

          {/* OTP-specific error message (modal only) - Single source of truth for OTP errors */}
          {otpModalError && (
            <div
              className={`border rounded-lg p-3 ${
                otpErrorType === "expired"
                  ? "bg-amber-50 border-amber-200"
                  : otpErrorType === "too_many_attempts"
                    ? "bg-red-50 border-red-200"
                    : "bg-red-50 border-red-200"
              }`}
            >
              {otpErrorType === "expired" && (
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-amber-700">OTP Expired</p>
                    <p className="text-xs text-amber-600 mt-1">{otpModalError}</p>
                  </div>
                </div>
              )}
              {otpErrorType === "too_many_attempts" && (
                <div className="flex items-start gap-2">
                  <AlertTriangle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-700">Too Many Attempts</p>
                    <p className="text-xs text-red-600 mt-1">{otpModalError}</p>
                  </div>
                </div>
              )}
              {otpErrorType === "invalid" && (
                <div>
                  <p className="text-sm font-medium text-red-700">Invalid OTP</p>
                  <p className="text-xs text-red-600 mt-1">{otpModalError}</p>
                </div>
              )}
              {!otpErrorType && <p className="text-xs text-red-600">{otpModalError}</p>}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              onClick={handleModalOTPVerify}
              variant="primary"
              fullWidth
              disabled={otpModalCode.length !== 6 || verifyingOTP || validateOTP(otpModalCode) !== null || otpLocked}
            >
              {verifyingOTP ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} className="mr-2" />
                  Verify & Submit
                </>
              )}
            </Button>
            <Button onClick={handleModalResendOTP} variant="outline" disabled={otpLoading || otpLocked || otpResendCooldown > 0}>
              {otpLoading ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail size={16} className="mr-2" />
                  {otpResendCooldown > 0 ? `Resend (${otpResendCooldown}s)` : "Resend"}
                </>
              )}
            </Button>
          </div>

          {/* Resend helper text */}
          <div className="text-center mt-2">
            {otpResendCooldown > 0 ? (
              <p className="text-xs text-gray-500">You can request a new OTP in {otpResendCooldown} seconds.</p>
            ) : (
              <p className="text-xs text-gray-500">Didn’t receive the code? Send a new OTP to your email/number.</p>
            )}
          </div>

          {/* Locked out message */}
          {otpLocked && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm font-medium text-red-700 mb-2">OTP Verification Locked</p>
              <p className="text-xs text-red-600 mb-3">Too many failed attempts. Please request a new OTP to continue.</p>
              <Button onClick={handleModalResendOTP} variant="outline" fullWidth disabled={otpLoading}>
                {otpLoading ? (
                  <>
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    Requesting...
                  </>
                ) : (
                  <>
                    <Mail size={16} className="mr-2" />
                    Request New OTP
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
