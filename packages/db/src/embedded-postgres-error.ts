const DEFAULT_RECENT_LOG_LIMIT = 40;
const RECENT_LOG_SUMMARY_LINES = 8;

function toError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) return error;
  if (error === undefined) return new Error(fallbackMessage);
  if (typeof error === "string") return new Error(`${fallbackMessage}: ${error}`);

  try {
    return new Error(`${fallbackMessage}: ${JSON.stringify(error)}`);
  } catch {
    return new Error(`${fallbackMessage}: ${String(error)}`);
  }
}

function summarizeRecentLogs(recentLogs: string[]): string | null {
  if (recentLogs.length === 0) return null;
  return recentLogs
    .slice(-RECENT_LOG_SUMMARY_LINES)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" | ");
}

function detectBaseEmbeddedPostgresHint(recentLogs: string[]): string | null {
  const haystack = recentLogs.join("\n").toLowerCase();
  if (haystack.includes("could not create semaphores") || haystack.includes("semget(")) {
    return "Embedded PostgreSQL could not allocate operating-system semaphores. " +
      "Check for stale PostgreSQL IPC resources and unfinished test servers. " +
      "This is not disk exhaustion or a SQL lock limit; integration tests must not be skipped.";
  }
  if (!haystack.includes("could not create shared memory segment")) {
    return null;
  }

  return (
    "Embedded PostgreSQL bootstrap could not allocate shared memory. " +
    "On macOS, this usually means the host's kern.sysv.shm* limits are too low for another local PostgreSQL cluster. " +
    "Stop other local PostgreSQL servers or raise the shared-memory sysctls, then retry."
  );
}

function detectEmbeddedPostgresHint(recentLogs: string[]): string | null {
  const baseHint = detectBaseEmbeddedPostgresHint(recentLogs);
  if (baseHint) return baseHint;
  const haystack = recentLogs.join("\n").toLowerCase();
  if (
    process.getuid?.() === 0 &&
    (haystack.includes("permission denied") || haystack.includes("could not change permissions"))
  ) {
    return "Paperclip is running as root, so embedded PostgreSQL runs as a separate \"postgres\" system user. " +
      "That user must be able to reach the data directory and /tmp socket files: do not keep the data under /root (mode 700) " +
      "and remove stale /tmp/.s.PGSQL.* files left by another user. " +
      "Set PAPERCLIP_HOME to a path such as /var/lib/paperclip, run Paperclip as a non-root user, or set DATABASE_URL to an external Postgres.";
  }
  return null;
}

export function createEmbeddedPostgresLogBuffer(limit = DEFAULT_RECENT_LOG_LIMIT): {
  append(message: unknown): void;
  getRecentLogs(): string[];
} {
  const recentLogs: string[] = [];

  return {
    append(message: unknown) {
      const text =
        typeof message === "string"
          ? message
          : message instanceof Error
            ? message.message
            : String(message ?? "");

      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        recentLogs.push(line);
        if (recentLogs.length > limit) {
          recentLogs.splice(0, recentLogs.length - limit);
        }
      }
    },
    getRecentLogs() {
      return [...recentLogs];
    },
  };
}

export function formatEmbeddedPostgresError(
  error: unknown,
  input: {
    fallbackMessage: string;
    recentLogs?: string[];
  },
): Error {
  const baseError = toError(error, input.fallbackMessage);
  const recentLogs = input.recentLogs ?? [];
  const parts = [baseError.message];
  const hint = detectEmbeddedPostgresHint([baseError.message, ...recentLogs]);
  const recentSummary = summarizeRecentLogs(recentLogs);

  if (hint) {
    parts.push(hint);
  }
  if (recentSummary) {
    parts.push(`Recent embedded Postgres logs: ${recentSummary}`);
  }

  return new Error(parts.join(" "));
}
