import fs from "fs";

const MB = 1024 * 1024;
const DEFAULT_FILE_BYTES = 25 * MB;
const DEFAULT_TOTAL_BYTES = 100 * MB;
const LIMITS_FILE = process.env.PI_HUB_LIMITS_FILE ?? "/etc/pihub/limits.json";

export interface UploadLimits {
  maxUploadFileBytes: number;
  maxUploadTotalBytes: number;
  maxUploadRequestBytes: number;
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function envInt(name: string): number | null {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

/**
 * Per-user upload limits. The hub rewrites PI_HUB_LIMITS_FILE (a read-only
 * bind mount) whenever an administrator changes the sandbox settings, so this
 * is read on every request instead of being cached at module load.
 */
export function readUploadLimits(): UploadLimits {
  let stored: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(LIMITS_FILE, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      stored = parsed as Record<string, unknown>;
    }
  } catch {
    // No limits file (dev, older hub): fall back to env or defaults.
  }

  const total =
    positiveInt(stored?.maxUploadTotalBytes) ??
    envInt("PI_WEB_MAX_UPLOAD_TOTAL_BYTES") ??
    DEFAULT_TOTAL_BYTES;
  const file = Math.min(
    positiveInt(stored?.maxUploadFileBytes) ??
      envInt("PI_WEB_MAX_UPLOAD_FILE_BYTES") ??
      DEFAULT_FILE_BYTES,
    total,
  );
  return {
    maxUploadFileBytes: file,
    maxUploadTotalBytes: total,
    // Multipart boundaries and headers are not file bytes, but must be bounded too.
    maxUploadRequestBytes: total + MB,
  };
}

export function uploadLimitMb(bytes: number): number {
  return Math.max(1, Math.round(bytes / MB));
}
