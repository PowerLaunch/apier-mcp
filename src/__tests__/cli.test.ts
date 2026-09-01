import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

// Mock spawn so the argv/env assertions below can inspect exactly what main()
// would hand to mcp-remote without starting a real process. Declared via
// vi.hoisted so spawnMock exists before vitest hoists the cli.js import.
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import {
  main,
  parseArgs,
  buildChildEnv,
  createStderrRedactor,
  resolveMcpRemoteEntry,
  signalExitCode,
  AUTH_HEADER_ENV_VAR,
  AUTH_HEADER_ARG,
} from "../cli.js";

// ─── Issue #33: the key must never reach the child's command line ──────────

/**
 * Drive main() to completion against a fake child and return what spawn() was
 * called with. main() resolves on the child's "close" event, so we emit one.
 */
async function captureSpawn(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ args: string[]; env: NodeJS.ProcessEnv; exitCode: number }> {
  let child: EventEmitter & { stdout: Readable; stderr: Readable; killed: boolean; kill(): boolean };
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => {
    const c = Object.assign(new EventEmitter(), {
      stdout: new Readable({ read() {} }),
      stderr: new Readable({ read() {} }),
      killed: false,
      kill: () => true,
    });
    child = c;
    return c;
  });
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((() => true) as never);
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
  try {
    const p = main(argv, env);
    await new Promise((r) => setTimeout(r, 0));
    child!.stdout.push(null);
    child!.stderr.push(null);
    child!.emit("close", 0, null);
    const exitCode = await p;
    const call = spawnMock.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
    return { args: call[1], env: call[2].env, exitCode };
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
}

const KEY = "apier_live_supersecret_abcdef0123456789";

describe("spawn argv — API key must not be observable via process inspection (#33)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("no element of the spawn argv contains the API key value", async () => {
    const { args } = await captureSpawn([], { APIER_API_KEY: KEY } as NodeJS.ProcessEnv);
    for (const a of args) expect(a).not.toContain(KEY);
    // Belt and braces: the joined command line — what `ps aux` actually shows.
    expect(args.join(" ")).not.toContain(KEY);
  });

  it("argv carries the literal ${APIER_MCP_AUTH_HEADER} placeholder, never 'Bearer <key>'", async () => {
    const { args } = await captureSpawn([], { APIER_API_KEY: KEY } as NodeJS.ProcessEnv);
    expect(args).toContain("--header");
    expect(args).toContain("Authorization:${APIER_MCP_AUTH_HEADER}");
    expect(args.join(" ")).not.toMatch(/Bearer\s/);
  });

  it("hands the bearer value to the child via APIER_MCP_AUTH_HEADER instead", async () => {
    const { env } = await captureSpawn([], { APIER_API_KEY: KEY } as NodeJS.ProcessEnv);
    expect(env[AUTH_HEADER_ENV_VAR]).toBe(`Bearer ${KEY}`);
  });

  it("still scrubs APIER_API_KEY itself from the spawned child's env", async () => {
    const { env } = await captureSpawn([], {
      APIER_API_KEY: KEY,
      PATH: "/usr/bin",
    } as NodeJS.ProcessEnv);
    expect(env.APIER_API_KEY).toBeUndefined();
    expect(env.AUTHORIZATION).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin");
  });

  it("a caller-supplied APIER_MCP_AUTH_HEADER cannot survive into the child", async () => {
    // The name matches ENV_DENY_SUBSTRINGS ("APIER"), so buildChildEnv drops the
    // spoofed value; main() then assigns the real one.
    const { env } = await captureSpawn([], {
      APIER_API_KEY: KEY,
      APIER_MCP_AUTH_HEADER: "Bearer attacker_controlled_value",
    } as NodeJS.ProcessEnv);
    expect(env[AUTH_HEADER_ENV_VAR]).toBe(`Bearer ${KEY}`);
    expect(env[AUTH_HEADER_ENV_VAR]).not.toContain("attacker_controlled_value");
  });

  it("trims surrounding whitespace from the key before it becomes a header value", async () => {
    const { env } = await captureSpawn([], {
      APIER_API_KEY: `  ${KEY}\n`,
    } as NodeJS.ProcessEnv);
    expect(env[AUTH_HEADER_ENV_VAR]).toBe(`Bearer ${KEY}`);
  });
});

describe("AUTH_HEADER_ARG — contract with mcp-remote's parser", () => {
  // Pins the two upstream behaviours this fix depends on, both read out of the
  // pinned mcp-remote 0.8.1 bundle. If a future bump changes either, this
  // fails loudly rather than silently sending an unauthenticated request.
  it("satisfies mcp-remote's --header parse regex, yielding the placeholder as the value", () => {
    const match = AUTH_HEADER_ARG.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("Authorization");
    expect(match![2]).toBe(`\${${AUTH_HEADER_ENV_VAR}}`);
  });

  it("matches mcp-remote's ${VAR} substitution pattern and resolves from env", () => {
    const substituted = AUTH_HEADER_ARG.replace(
      /\$\{([^}]+)}/g,
      (_m, name: string) => ({ [AUTH_HEADER_ENV_VAR]: "Bearer resolved" })[name] ?? "",
    );
    expect(substituted).toBe("Authorization:Bearer resolved");
  });
});

describe("buildChildEnv — env scrubbing", () => {
  it("strips APIER_API_KEY from the child environment", () => {
    const parent = { APIER_API_KEY: "apier_live_dummy_key", PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.APIER_API_KEY).toBeUndefined();
    expect(child.PATH).toBe("/usr/bin");
  });

  it("strips any env var whose name contains TOKEN/SECRET/BEARER/KEY/PASSWORD/CREDENTIAL", () => {
    const parent = {
      GITHUB_TOKEN: "ghp_abc", MY_SECRET: "x", AUTH_BEARER: "x",
      SOMETHING_KEY: "x", DB_PASSWORD: "x", AWS_CREDENTIAL: "x",
      PATH: "/usr/bin",
    } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.GITHUB_TOKEN).toBeUndefined();
    expect(child.MY_SECRET).toBeUndefined();
    expect(child.AUTH_BEARER).toBeUndefined();
    expect(child.SOMETHING_KEY).toBeUndefined();
    expect(child.DB_PASSWORD).toBeUndefined();
    expect(child.AWS_CREDENTIAL).toBeUndefined();
    expect(child.PATH).toBe("/usr/bin");
  });

  it("drops ALL NODE_-prefixed vars (NODE_OPTIONS preload RCE, NODE_TLS_REJECT_UNAUTHORIZED TLS bypass)", () => {
    // NODE_* is no longer forwarded at all (CodeRabbit, Major): NODE_OPTIONS can
    // --require arbitrary modules into the child and NODE_TLS_REJECT_UNAUTHORIZED=0
    // disables TLS verification — both would undermine the proxy's guarantees.
    const parent = {
      NODE_AUTH_TOKEN: "npm_secrettokenvalue",
      NODE_OPTIONS: "--require /tmp/evil.js",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      PATH: "/usr/bin",
    } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.NODE_AUTH_TOKEN).toBeUndefined();
    expect(child.NODE_OPTIONS).toBeUndefined();
    expect(child.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    expect(child.PATH).toBe("/usr/bin");
  });

  it("passes through PATH, HOME, USER, LANG, TMPDIR", () => {
    const parent = {
      PATH: "/usr/bin", HOME: "/home/u", USER: "u",
      LANG: "en_US.UTF-8", TMPDIR: "/tmp",
    } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.PATH).toBe("/usr/bin");
    expect(child.HOME).toBe("/home/u");
    expect(child.USER).toBe("u");
    expect(child.LANG).toBe("en_US.UTF-8");
    expect(child.TMPDIR).toBe("/tmp");
  });

  it("passes through HTTP_PROXY / HTTPS_PROXY / NO_PROXY (lower + upper case)", () => {
    const parent = {
      HTTP_PROXY: "http://p:3128", HTTPS_PROXY: "http://p:3128", NO_PROXY: "localhost",
      http_proxy: "http://p:3128", https_proxy: "http://p:3128", no_proxy: "localhost",
    } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.HTTP_PROXY).toBe("http://p:3128");
    expect(child.https_proxy).toBe("http://p:3128");
    expect(child.no_proxy).toBe("localhost");
  });

  it("passes through MCP_REMOTE_CONFIG_DIR (needed by mcp-remote)", () => {
    const parent = { MCP_REMOTE_CONFIG_DIR: "/tmp/mcp-auth", PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.MCP_REMOTE_CONFIG_DIR).toBe("/tmp/mcp-auth");
  });

  it("passes through LC_* locale vars", () => {
    const parent = { LC_ALL: "en_US.UTF-8", LC_TIME: "nb_NO.UTF-8", PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.LC_ALL).toBe("en_US.UTF-8");
    expect(child.LC_TIME).toBe("nb_NO.UTF-8");
  });

  it("defaults to deny for unknown vars not matching any allow rule", () => {
    const parent = { RANDOM_THING: "x", PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const child = buildChildEnv(parent);
    expect(child.RANDOM_THING).toBeUndefined();
    expect(child.PATH).toBe("/usr/bin");
  });

  it("does not mutate the parent env object", () => {
    const parent = { APIER_API_KEY: "apier_live_x", PATH: "/usr/bin" } as NodeJS.ProcessEnv;
    const before = { ...parent };
    buildChildEnv(parent);
    expect(parent).toEqual(before);
  });
});

describe("redaction patterns", () => {
  it("redactor source contains the expected secret patterns", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("../cli.ts", import.meta.url), "utf8");
    expect(src).toMatch(/Bearer\\s\+/);
    expect(src).toMatch(/apier_\(live\|test\)_/);
    expect(src).toMatch(/ghp_/);
    expect(src).toMatch(/Authorization:/);
  });
});

describe("createStderrRedactor — line-buffered stderr redaction", () => {
  it("redacts a secret split across two stderr chunks", () => {
    const out: string[] = [];
    const r = createStderrRedactor((s) => out.push(s));
    // The token straddles the chunk boundary; neither chunk matches alone.
    r.push("mcp-remote log: Bearer ");
    r.push("apier_live_abcd1234efgh\n");
    const joined = out.join("");
    expect(joined).not.toContain("apier_live_abcd1234efgh");
    expect(joined).toContain("***REDACTED***");
  });

  it("buffers until newline and flush() emits the trailing partial line redacted", () => {
    const out: string[] = [];
    const r = createStderrRedactor((s) => out.push(s));
    r.push("trailing ghp_abcdefghijklmnopqrstuvwxyz0123");
    expect(out.join("")).toBe(""); // nothing emitted before a newline
    r.flush();
    const joined = out.join("");
    expect(joined).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123");
    expect(joined).toContain("***REDACTED***");
  });

  it("redacts a lowercase 'bearer <token>' (case-insensitive Bearer pattern)", () => {
    const out: string[] = [];
    const r = createStderrRedactor((s) => out.push(s));
    r.push("debug authorization: bearer sometokenvalue1234567\n");
    const joined = out.join("");
    expect(joined).not.toContain("sometokenvalue1234567");
    expect(joined).toContain("***REDACTED***");
  });
});

describe("resolveMcpRemoteEntry", () => {
  it("resolves to mcp-remote's bin entry, which exists on disk", () => {
    const entry = resolveMcpRemoteEntry();
    expect(entry).toMatch(/proxy\.js$/);
    expect(existsSync(entry)).toBe(true);
  });
});

describe("signalExitCode", () => {
  it("returns 128 + signal number (SIGINT -> 130, SIGTERM -> 143)", () => {
    expect(signalExitCode("SIGINT")).toBe(130);
    expect(signalExitCode("SIGTERM")).toBe(143);
  });
});

describe("main --help", () => {
  it("prints help verbatim without redacting the documented Authorization header", async () => {
    const chunks: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await main(["--help"], {} as NodeJS.ProcessEnv)).toBe(0);
    } finally {
      process.stderr.write = original;
    }
    const out = chunks.join("");
    expect(out).toContain("Authorization: Bearer");
    expect(out).not.toContain("***REDACTED***");
    // Pin the exact key-provisioning URL. https://www.apier.no/dashboard/keys
    // returned 404; the help text must keep pointing at the docs page.
    expect(out).toContain("https://www.apier.no/docs/authentication");
    expect(out).not.toContain("https://www.apier.no/dashboard/keys");
  });
});

describe("main — missing APIER_API_KEY error text", () => {
  it("points at the exact authentication docs URL, not the 404 dashboard path", async () => {
    const chunks: string[] = [];
    const original = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(await main([], {} as NodeJS.ProcessEnv)).toBe(1);
    } finally {
      process.stderr.write = original;
    }
    const out = chunks.join("");
    expect(out).toContain("APIER_API_KEY environment variable is required.");
    expect(out).toContain("https://www.apier.no/docs/authentication");
    expect(out).not.toContain("https://www.apier.no/dashboard/keys");
  });
});

describe("parseArgs — unknown args", () => {
  it("rejects an unknown long flag with a clear error", () => {
    expect(() => parseArgs(["--endpont", "https://example.com/mcp"])).toThrow(/Unknown flag: --endpont/);
  });

  it("rejects an unknown short flag", () => {
    expect(() => parseArgs(["-x"])).toThrow(/Unknown flag: -x/);
  });

  it("accepts --endpoint=<url> equals-syntax", () => {
    const parsed = parseArgs(["--endpoint=https://example.com/mcp"]);
    expect(parsed.endpoint).toBe("https://example.com/mcp");
  });

  it("rejects a non-dash positional argument (URL-shaped)", () => {
    expect(() => parseArgs(["https://evil.com"])).toThrow(/Unknown argument/);
  });

  it("rejects a non-dash positional argument (numeric)", () => {
    expect(() => parseArgs(["8080"])).toThrow(/Unknown argument/);
  });
});
