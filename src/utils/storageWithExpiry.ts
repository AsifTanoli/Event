const DEFAULT_STORAGE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

const parsedEnvTtl = Number(import.meta.env.VITE_AUTH_STORAGE_TTL_MS);
export const AUTH_STORAGE_TTL_MS =
  Number.isFinite(parsedEnvTtl) && parsedEnvTtl > 0 ? parsedEnvTtl : DEFAULT_STORAGE_TTL_MS;

interface ExpiringStorageValue<T> {
  value: T;
  expiresAt: number;
}

const isExpiringStorageValue = (value: unknown): value is ExpiringStorageValue<unknown> => {
  if (!value || typeof value !== "object") return false;
  const parsed = value as Record<string, unknown>;
  return typeof parsed.expiresAt === "number" && "value" in parsed;
};

export const setStorageWithExpiry = <T>(
  key: string,
  value: T,
  ttlMs: number = AUTH_STORAGE_TTL_MS,
) => {
  const payload: ExpiringStorageValue<T> = {
    value,
    expiresAt: Date.now() + ttlMs,
  };
  localStorage.setItem(key, JSON.stringify(payload));
};

export const getStorageWithExpiry = <T>(key: string): T | null => {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!isExpiringStorageValue(parsed)) {
      // Backward compatibility for previously stored non-expiring values.
      return parsed as T;
    }

    if (Date.now() > parsed.expiresAt) {
      localStorage.removeItem(key);
      return null;
    }

    return parsed.value as T;
  } catch {
    // Backward compatibility for plain string values (e.g. old tokens).
    return raw as unknown as T;
  }
};
