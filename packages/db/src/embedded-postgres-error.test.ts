import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbeddedPostgresLogBuffer, formatEmbeddedPostgresError } from "./embedded-postgres-error.js";

describe("formatEmbeddedPostgresError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("explains how to fix data-directory permission errors when running as root", () => {
    vi.spyOn(process, "getuid").mockReturnValue(0);
    const error = formatEmbeddedPostgresError(new Error("Failed to start embedded PostgreSQL"), {
      fallbackMessage: "startup failed",
      recentLogs: ['FATAL: could not open lock file "/tmp/.s.PGSQL.54329.lock": Permission denied'],
    });
    expect(error.message).toContain('separate "postgres" system user');
    expect(error.message).toContain("PAPERCLIP_HOME");
    expect(error.message).toContain("DATABASE_URL");
  });

  it("does not add the root hint for a non-root user", () => {
    vi.spyOn(process, "getuid").mockReturnValue(1000);
    const error = formatEmbeddedPostgresError(new Error("Failed to start embedded PostgreSQL"), {
      fallbackMessage: "startup failed",
      recentLogs: ["FATAL: could not open lock file: Permission denied"],
    });
    expect(error.message).not.toContain("running as root");
  });

  it("identifies semaphore exhaustion without recommending SQL lock changes", () => {
    const error = formatEmbeddedPostgresError(new Error(), {
      fallbackMessage: "startup failed",
      recentLogs: ["FATAL: could not create semaphores: No space left on device", "DETAIL: semget(123, 17, 03600)"],
    });
    expect(error.message).toContain("operating-system semaphores");
    expect(error.message).toContain("integration tests must not be skipped");
    expect(error.message).toContain("not disk exhaustion or a SQL lock limit");
  });
  it("adds a shared-memory hint when initdb logs expose the real cause", () => {
    const error = formatEmbeddedPostgresError("Postgres init script exited with code 1.", {
      fallbackMessage: "Failed to initialize embedded PostgreSQL cluster",
      recentLogs: [
        "running bootstrap script ...",
        "FATAL:  could not create shared memory segment: Cannot allocate memory",
        "DETAIL:  Failed system call was shmget(key=123, size=56, 03600).",
      ],
    });

    expect(error.message).toContain("could not allocate shared memory");
    expect(error.message).toContain("kern.sysv.shm");
    expect(error.message).toContain("could not create shared memory segment");
  });

  it("keeps only recent non-empty log lines in the collector", () => {
    const buffer = createEmbeddedPostgresLogBuffer(2);
    buffer.append("line one\n\n");
    buffer.append("line two");
    buffer.append("line three");

    expect(buffer.getRecentLogs()).toEqual(["line two", "line three"]);
  });
});
