/**
 * @apier-no/mcp proxy tests.
 *
 * Three pinning assertions:
 *   TEST 1: missing APIER_API_KEY → process.exit(1) with helpful stderr
 *           naming the env var and linking the key dashboard.
 *   TEST 2: http:// endpoint rejected with stderr explaining HTTPS-only.
 *   TEST 3: token canary — APIER_API_KEY value never appears in stderr
 *           output across any error path.
 *
 * All three exercise startProxy() directly with process.exit and
 * process.stderr.write mocked. Subprocess-spawn tests would also
 * work but require a build step before the test run; mocking is
 * faster and proves the same invariants.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startProxy } from "../src/index.js";

interface ExitCalled {
  code: number | undefined;
}

function mockProcessExit(): { exit: ReturnType<typeof vi.fn>; calls: ExitCalled[] } {
  const calls: ExitCalled[] = [];
  // Cast through unknown because process.exit's signature is `(code?:
  // number) => never` and we want the mock to throw rather than
  // actually exit — TypeScript's typings refuse a plain `() => void`
  // assignment otherwise.
  const exit = vi.fn((code?: number) => {
    calls.push({ code });
    throw new Error(`__MOCKED_EXIT__:${code ?? "undefined"}`);
  }) as unknown as typeof process.exit;
  vi.spyOn(process, "exit").mockImplementation(exit);
  return { exit: exit as unknown as ReturnType<typeof vi.fn>, calls };
}

function mockStderr(): { writes: string[] } {
  const writes: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation(
    ((chunk: unknown) => {
      writes.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stderr.write,
  );
  return { writes };
}

beforeEach(() => {
  // Snapshot env so each test starts from a clean slate. The proxy
  // reads APIER_API_KEY and APIER_MCP_ENDPOINT — anything else in
  // process.env is harmless.
  delete process.env.APIER_API_KEY;
  delete process.env.APIER_MCP_ENDPOINT;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startProxy — env var contract", () => {
  it("TEST 1: missing APIER_API_KEY → exit(1) with helpful stderr", async () => {
    mockProcessExit();
    const stderr = mockStderr();

    await expect(startProxy({})).rejects.toThrow("__MOCKED_EXIT__:1");

    const text = stderr.writes.join("");
    expect(text).toContain("APIER_API_KEY");
    expect(text).toContain("https://www.apier.no/dashboard/keys");
  });

  it("TEST 1b: empty APIER_API_KEY (whitespace also empty) → exit(1)", async () => {
    process.env.APIER_API_KEY = "";
    mockProcessExit();
    const stderr = mockStderr();

    await expect(startProxy({})).rejects.toThrow("__MOCKED_EXIT__:1");
    expect(stderr.writes.join("")).toContain("APIER_API_KEY");
  });
});

describe("startProxy — endpoint validation", () => {
  beforeEach(() => {
    process.env.APIER_API_KEY = "test-key-not-canary";
  });

  it("TEST 2: http:// endpoint rejected with HTTPS-only stderr", async () => {
    mockProcessExit();
    const stderr = mockStderr();

    await expect(
      startProxy({ endpoint: "http://insecure.example.com" }),
    ).rejects.toThrow("__MOCKED_EXIT__:1");

    const text = stderr.writes.join("").toLowerCase();
    expect(text).toContain("https");
  });

  it("TEST 2b: malformed URL → exit(1) with stderr mentioning endpoint", async () => {
    mockProcessExit();
    const stderr = mockStderr();

    await expect(startProxy({ endpoint: "not-a-url" })).rejects.toThrow(
      "__MOCKED_EXIT__:1",
    );
    expect(stderr.writes.join("").toLowerCase()).toContain("endpoint");
  });
});

describe("startProxy — token canary (APIER_API_KEY never leaks to stderr)", () => {
  it("TEST 3: APIER_API_KEY=CANARY_VALUE_X7Q never appears in stderr on http:// rejection", async () => {
    process.env.APIER_API_KEY = "CANARY_VALUE_X7Q";
    mockProcessExit();
    const stderr = mockStderr();

    await expect(
      startProxy({ endpoint: "http://insecure.example.com" }),
    ).rejects.toThrow("__MOCKED_EXIT__:1");

    const text = stderr.writes.join("");
    expect(text).not.toContain("CANARY_VALUE_X7Q");
    expect(text).not.toContain("CANARY_VALUE");
  });

  it("TEST 3b: APIER_API_KEY=CANARY_VALUE_X7Q never appears in stderr on malformed-URL rejection", async () => {
    process.env.APIER_API_KEY = "CANARY_VALUE_X7Q";
    mockProcessExit();
    const stderr = mockStderr();

    await expect(startProxy({ endpoint: "not-a-url" })).rejects.toThrow(
      "__MOCKED_EXIT__:1",
    );

    const text = stderr.writes.join("");
    expect(text).not.toContain("CANARY_VALUE_X7Q");
  });
});
