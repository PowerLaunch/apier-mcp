/**
 * Runtime acceptance matrix (PR-083b). Exercises the resilience layer added on
 * top of PR #10: stdout JSON-RPC validator, idle-timeout watchdog, synthetic
 * -32001 frames for auth + timeout, and strict-arg rejection paths. We mock
 * node:child_process via vi.hoisted so main()'s spawn returns a controllable
 * FakeChild — no real mcp-remote process is started.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// vi.mock factory needs spawnMock to exist BEFORE the import of cli.ts is
// hoisted, so we declare it via vi.hoisted.
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

// Imports below are hoisted by vitest to AFTER the vi.mock above.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import {
  main,
  parseArgs,
  formatErrorFrame,
  detectAuthFailure,
  createStdoutValidator,
} from "../cli.js";

// ─── Fake child + capture helpers ─────────────────────────────────────────

class FakeChild extends EventEmitter {
  stdin: null = null;
  stdout: Readable;
  stderr: Readable;
  killed = false;
  pid = 12345;
  constructor() {
    super();
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
  }
  kill(_sig?: NodeJS.Signals): boolean {
    if (this.killed) return false;
    this.killed = true;
    return true;
  }
}

let childRef: FakeChild | null = null;

type Captured = { stdout: string[]; stderr: string[] };
function captureStdio(): Captured {
  const cap: Captured = { stdout: [], stderr: [] };
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    cap.stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    cap.stderr.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stderr.write);
  return cap;
}

function tick(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(() => {
  childRef = null;
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    const c = new FakeChild();
    childRef = c;
    return c as unknown as ReturnType<typeof spawnMock>;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Pure helpers ─────────────────────────────────────────────────────────

describe("formatErrorFrame", () => {
  it("produces a JSON-RPC 2.0 frame with code -32001 + the message", () => {
    const o = JSON.parse(formatErrorFrame("hi"));
    expect(o).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "hi" } });
  });
});

describe("detectAuthFailure", () => {
  it("matches 'HTTP/1.1 401 Unauthorized'", () => {
    expect(detectAuthFailure("HTTP/1.1 401 Unauthorized")).toBe(true);
  });
  it("matches 'Authentication failed' (case-insensitive)", () => {
    expect(detectAuthFailure("Authentication FAILED for upstream")).toBe(true);
  });
  it("matches 'Unauthorized … 401'", () => {
    expect(detectAuthFailure("Got an Unauthorized response, status 401")).toBe(true);
  });
  it("does NOT match stray 4011 / unrelated text", () => {
    expect(detectAuthFailure("error code 4011 in subsystem foo")).toBe(false);
    expect(detectAuthFailure("debug: handshake complete")).toBe(false);
  });
});

describe("createStdoutValidator", () => {
  it("writes a valid JSON-RPC line through and resets the timer once", () => {
    const out: string[] = [];
    const err: string[] = [];
    let resets = 0;
    const v = createStdoutValidator((s) => out.push(s), () => resets++, (s) => err.push(s));
    v.push('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    expect(out.join("")).toContain('"jsonrpc":"2.0"');
    expect(resets).toBe(1);
    expect(err.join("")).toBe("");
  });

  it("drops a non-JSON-RPC line from stdout and writes a redacted copy to stderr", () => {
    const out: string[] = [];
    const err: string[] = [];
    let resets = 0;
    const v = createStdoutValidator((s) => out.push(s), () => resets++, (s) => err.push(s));
    v.push("garbage non-json line\n");
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain("garbage non-json line");
    expect(resets).toBe(0);
  });

  it("redacts a secret inside a dropped line before writing it to stderr", () => {
    const out: string[] = [];
    const err: string[] = [];
    const v = createStdoutValidator((s) => out.push(s), () => undefined, (s) => err.push(s));
    v.push("oops bearer apier_live_abc12345def67890 leaked\n");
    expect(err.join("")).not.toContain("apier_live_abc12345def67890");
    expect(err.join("")).toContain("***REDACTED***");
    expect(out.join("")).toBe("");
  });

  it("handles a JSON-RPC frame split across chunk boundaries", () => {
    const out: string[] = [];
    const v = createStdoutValidator((s) => out.push(s), () => undefined, () => undefined);
    v.push('{"jsonrpc":"2');
    v.push('.0","id":2,"result":{"ok":true}}\n');
    expect(out.join("")).toContain('"id":2');
  });
});

describe("parseArgs — --timeout (PR-083b)", () => {
  it("defaults idleTimeoutMs to 60000", () => {
    expect(parseArgs([]).idleTimeoutMs).toBe(60000);
  });
  it("accepts --timeout <ms> (space form)", () => {
    expect(parseArgs(["--timeout", "1500"]).idleTimeoutMs).toBe(1500);
  });
  it("accepts --timeout=<ms> (equals form)", () => {
    expect(parseArgs(["--timeout=250"]).idleTimeoutMs).toBe(250);
  });
  it("rejects non-numeric values", () => {
    expect(() => parseArgs(["--timeout", "abc"])).toThrow(/positive integer/);
  });
  it("rejects zero", () => {
    expect(() => parseArgs(["--timeout=0"])).toThrow(/positive integer/);
  });
  it("rejects negative values (leading '-' fails the positive-integer regex)", () => {
    expect(() => parseArgs(["--timeout=-500"])).toThrow(/positive integer/);
  });
});

// ─── main() runtime acceptance ────────────────────────────────────────────

describe("main() runtime — PR-083b acceptance matrix", () => {
  it("T1 invalid (non-https) --endpoint → exit 2, no spawn", async () => {
    captureStdio();
    const code = await main(
      ["--endpoint=ftp://nope.example/"],
      { APIER_API_KEY: "x" } as NodeJS.ProcessEnv,
    );
    expect(code).toBe(2);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("T2a missing APIER_API_KEY → exit 1, no spawn", async () => {
    const cap = captureStdio();
    const code = await main([], {} as NodeJS.ProcessEnv);
    expect(code).toBe(1);
    expect(spawnMock).not.toHaveBeenCalled();
    // Pin the exact key-provisioning URL alongside the exit-code assertion, so
    // a regression to the 404 dashboard path fails loudly here too.
    const stderr = cap.stderr.join("");
    expect(stderr).toContain("https://www.apier.no/docs/authentication");
    expect(stderr).not.toContain("https://www.apier.no/dashboard/keys");
  });

  it("T6 --timeout without a value → exit 2, no spawn", async () => {
    captureStdio();
    const code = await main(["--timeout"], { APIER_API_KEY: "x" } as NodeJS.ProcessEnv);
    expect(code).toBe(2);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("T3 child 'error' event → exit 127, no hang, 'Failed to spawn' on stderr", async () => {
    const cap = captureStdio();
    const p = main([], { APIER_API_KEY: "test_dummy_12345678" } as NodeJS.ProcessEnv);
    await tick();
    const c = childRef!;
    c.emit("error", new Error("ENOENT: simulated spawn failure"));
    c.stdout.push(null);
    c.stderr.push(null);
    c.emit("close", 127, null);
    const code = await p;
    expect(code).toBe(127);
    expect(cap.stderr.join("")).toContain("Failed to spawn mcp-remote");
  });

  it("T2b/T4 simulated upstream 401 on child stderr → -32001 auth frame on stdout", async () => {
    const cap = captureStdio();
    const p = main([], { APIER_API_KEY: "test_dummy_12345678" } as NodeJS.ProcessEnv);
    await tick();
    const c = childRef!;
    c.stderr.push("HTTP/1.1 401 Unauthorized\n");
    await tick(20);
    c.stdout.push(null);
    c.stderr.push(null);
    c.emit("close", 1, null);
    const exit = await p;
    const stdout = cap.stdout.join("");
    expect(stdout).toContain('"code":-32001');
    expect(stdout).toContain("Authentication failed. Verify APIER_API_KEY.");
    expect(exit).not.toBe(0);
  });

  it("T7 idle watchdog fires (no frames within --timeout) → -32001 timeout frame + non-zero exit + child killed", async () => {
    const cap = captureStdio();
    const p = main(
      ["--timeout=100"],
      { APIER_API_KEY: "test_dummy_12345678" } as NodeJS.ProcessEnv,
    );
    await tick();
    const c = childRef!;
    // Wait long enough for the 100ms watchdog to fire (margin for CI jitter).
    await tick(250);
    // The watchdog has SIGTERM'd the child; simulate the resulting close.
    c.stdout.push(null);
    c.stderr.push(null);
    c.emit("close", null, "SIGTERM" as NodeJS.Signals);
    const exit = await p;
    const stdout = cap.stdout.join("");
    expect(stdout).toContain('"code":-32001');
    expect(stdout).toContain("Request timed out.");
    expect(exit).not.toBe(0);
    expect(c.killed).toBe(true);
  });

  it("T8 valid JSON-RPC frames reset the watchdog → short --timeout does NOT fire while frames flow", async () => {
    const cap = captureStdio();
    const p = main(
      ["--timeout=300"],
      { APIER_API_KEY: "test_dummy_12345678" } as NodeJS.ProcessEnv,
    );
    await tick();
    const c = childRef!;
    // 5 frames at 100ms intervals = 500ms total — each resets the 300ms watchdog,
    // so it must NOT fire during the burst.
    for (let i = 0; i < 5; i++) {
      c.stdout.push(`{"jsonrpc":"2.0","id":${i},"result":{"ok":true}}\n`);
      await tick(100);
    }
    c.stdout.push(null);
    c.stderr.push(null);
    c.emit("close", 0, null);
    const exit = await p;
    expect(exit).toBe(0);
    expect(cap.stdout.join("")).not.toContain("Request timed out.");
    expect(c.killed).toBe(false);
  });

  it("T9 non-JSON-RPC stdout line is dropped, redacted copy goes to stderr; valid frames still flow", async () => {
    const cap = captureStdio();
    const p = main([], { APIER_API_KEY: "test_dummy_12345678" } as NodeJS.ProcessEnv);
    await tick();
    const c = childRef!;
    c.stdout.push("plain text garbage line\n");
    c.stdout.push('{"jsonrpc":"2.0","id":1,"result":{}}\n');
    await tick(20);
    c.stdout.push(null);
    c.stderr.push(null);
    c.emit("close", 0, null);
    await p;
    const stdout = cap.stdout.join("");
    const stderr = cap.stderr.join("");
    expect(stdout).not.toContain("plain text garbage");
    expect(stdout).toContain('"jsonrpc":"2.0"');
    expect(stderr).toContain("plain text garbage");
  });
});
