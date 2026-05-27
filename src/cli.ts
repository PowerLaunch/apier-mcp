#!/usr/bin/env node
/**
 * @apier/mcp — Hardened thin proxy from local MCP clients (Claude Desktop,
 * Cursor, Zed, Codex) to Apier's hosted Norwegian compliance MCP server.
 *
 * Security posture: see SECURITY.md. Summary —
 *   • API key read from APIER_API_KEY env; SCRUBBED from spawned child's env.
 *   • Key forwarded to mcp-remote only via `--header Authorization: Bearer …`.
 *   • stdout reserved for MCP JSON-RPC; diagnostics on stderr (redacted).
 *   • Non-https endpoint URLs rejected unconditionally.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { dirname as pathDirname, resolve as pathResolve } from "node:path";
import { constants as osConstants } from "node:os";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as {
  version: string;
  name: string;
};

const DEFAULT_ENDPOINT = "https://www.apier.no/api/mcp";
const VERSION = pkg.version;

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi,
  /apier_(live|test)_[A-Za-z0-9_\-]{8,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /Authorization:\s*[^\s,;]+/gi,
];

function redact(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "***REDACTED***");
  return out;
}

function safeStderr(s: string): void {
  process.stderr.write(redact(s));
}

/**
 * Line-buffered redactor for a child's stderr stream. Stream "data" events
 * split at arbitrary byte boundaries, so redacting each chunk independently
 * lets a secret straddling two chunks ("Bear" + "er apier_live_…") slip
 * through unredacted (Cursor Bugbot, Medium). We accumulate until a newline
 * and redact whole lines — secrets contain no newlines, so each token is
 * matched in one piece. flush() emits any trailing partial line on stream end.
 * Exported for tests.
 */
export function createStderrRedactor(write: (s: string) => void): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  let buffer = "";
  const drain = (final: boolean): void => {
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      write(redact(buffer.slice(0, nl + 1)));
      buffer = buffer.slice(nl + 1);
    }
    if (final && buffer.length > 0) {
      write(redact(buffer));
      buffer = "";
    }
  };
  return {
    push: (chunk: string): void => { buffer += chunk; drain(false); },
    flush: (): void => drain(true),
  };
}

interface ParsedArgs {
  endpoint: string;
  showHelp: boolean;
  showVersion: boolean;
  extra: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    endpoint: DEFAULT_ENDPOINT,
    showHelp: false,
    showVersion: false,
    extra: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--help" || a === "-h") out.showHelp = true;
    else if (a === "--version" || a === "-v") out.showVersion = true;
    else if (a === "--endpoint") {
      const v = argv[++i];
      if (!v) throw new Error("--endpoint requires a URL argument");
      out.endpoint = v;
    } else if (a === "--allow-http") {
      throw new Error(
        "--allow-http is not supported by @apier/mcp. The Apier endpoint is " +
          "https-only. If you have a legitimate non-https use case (local " +
          "dev mirror), use mcp-remote directly."
      );
    } else {
      out.extra.push(a);
    }
  }
  return out;
}

const HELP = `@apier/mcp ${VERSION} — Hardened proxy to Apier's hosted MCP server.

Usage: apier-mcp [options]

Options:
  --endpoint <url>     Override default ${DEFAULT_ENDPOINT}
  --version, -v        Print version and exit
  --help, -h           Print this help and exit

Required environment variable:
  APIER_API_KEY        Get a key at https://www.apier.no/dashboard/keys

The key is read from APIER_API_KEY, scrubbed from the spawned child process
environment, and forwarded to mcp-remote via --header Authorization: Bearer.
It is NEVER passed through env to the child.

Example MCP client config (Claude Desktop / Cursor):
  {
    "mcpServers": {
      "apier": {
        "command": "npx",
        "args": ["-y", "@apier/mcp"],
        "env": { "APIER_API_KEY": "apier_live_<your_key_here>" }
      }
    }
  }
`;

const ENV_PASSTHROUGH_ALLOWLIST = new Set([
  "PATH", "HOME", "USER", "USERNAME", "LOGNAME", "LANG", "TMPDIR", "TEMP", "TMP",
  "APPDATA", "LOCALAPPDATA", "USERPROFILE", "COMSPEC", "SYSTEMROOT", "SYSTEMDRIVE",
  "PATHEXT", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMDATA",
  "COMMONPROGRAMFILES", "WINDIR", "MCP_REMOTE_CONFIG_DIR",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy",
]);

const ENV_DENY_SUBSTRINGS = ["TOKEN", "SECRET", "BEARER", "KEY", "PASSWORD", "CREDENTIAL", "APIER"];

export function buildChildEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(parent)) {
    if (v === undefined) continue;
    const upper = k.toUpperCase();
    // Deny first: any name containing a secret substring is never forwarded,
    // so it cannot ride a later allow rule (Cursor Bugbot, High).
    if (ENV_DENY_SUBSTRINGS.some((s) => upper.includes(s))) continue;
    if (ENV_PASSTHROUGH_ALLOWLIST.has(k)) { child[k] = v; continue; }
    if (ENV_PASSTHROUGH_ALLOWLIST.has(upper)) { child[k] = v; continue; }
    if (upper.startsWith("LC_")) { child[k] = v; continue; }
    // NODE_* is deliberately NOT forwarded: NODE_OPTIONS can --require/--import
    // arbitrary modules into the child (which could read the bearer token passed
    // on argv) and NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS verification —
    // both undermine the proxy's TLS + secret-handling guarantees (CodeRabbit,
    // Major). Add a specific safe NODE_ var to the exact allowlist if needed.
  }
  return child;
}

function validateEndpoint(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error(`Invalid --endpoint URL: ${raw}`); }
  if (u.protocol !== "https:") {
    throw new Error(
      `Refusing non-https endpoint: ${u.protocol}//${u.host}. ` +
        `@apier/mcp requires https. To use a non-https mirror, call mcp-remote directly.`
    );
  }
  return u;
}

// Resolve mcp-remote's bin entry (dist/proxy.js) from its installed
// package.json, so it can be run with the current Node binary instead of npx.
// Exported for tests. Throws if mcp-remote or its bin entry can't be found.
export function resolveMcpRemoteEntry(): string {
  const pkgJsonPath = require.resolve("mcp-remote/package.json");
  const mcpPkg = require("mcp-remote/package.json") as { bin?: Record<string, string> };
  const binRel = mcpPkg.bin?.["mcp-remote"];
  if (!binRel) throw new Error("mcp-remote package.json has no 'mcp-remote' bin entry");
  return pathResolve(pathDirname(pkgJsonPath), binRel);
}

// Map a terminating signal to the conventional Unix exit code 128 + signum
// (SIGINT -> 130, SIGTERM -> 143) so callers inspecting $? can tell which
// signal killed the child (Cursor Bugbot, Low). Exported for tests.
export function signalExitCode(signal: NodeJS.Signals): number {
  const signals = osConstants.signals as Record<string, number | undefined>;
  return 128 + (signals[signal] ?? 0);
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  let parsed: ParsedArgs;
  try { parsed = parseArgs(argv); }
  catch (e) { safeStderr(`${(e as Error).message}\n`); return 2; }

  // HELP is a trusted static constant; write it verbatim. Routing it through
  // safeStderr() would let redact() mangle the documented literal
  // "Authorization: Bearer." into "***REDACTED***" (Cursor Bugbot, Medium).
  if (parsed.showHelp) { process.stderr.write(HELP); return 0; }
  if (parsed.showVersion) { safeStderr(`${VERSION}\n`); return 0; }

  const apiKey = env.APIER_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    safeStderr(
      "APIER_API_KEY environment variable is required.\n" +
        "Get a key at https://www.apier.no/dashboard/keys\n"
    );
    return 1;
  }

  let endpoint: URL;
  try { endpoint = validateEndpoint(parsed.endpoint); }
  catch (e) { safeStderr(`${(e as Error).message}\n`); return 2; }

  const childEnv = buildChildEnv(env);
  delete childEnv.APIER_API_KEY;
  delete childEnv.AUTHORIZATION;

  // Run mcp-remote's resolved bin with the current Node binary instead of npx.
  // Cross-platform: spawn("npx", …, { shell:false }) fails on Windows because
  // npx is npx.cmd and Node won't run a .cmd without a shell — and a shell
  // would mis-split our space-bearing --header arg (Cursor Bugbot, Medium).
  // Using process.execPath on the resolved .js also removes any npx
  // fallback-download path, so only the exact installed (pinned) mcp-remote
  // can ever run.
  let mcpRemoteEntry: string;
  try {
    mcpRemoteEntry = resolveMcpRemoteEntry();
  } catch (e) {
    safeStderr(`Could not locate the mcp-remote binary: ${redact((e as Error).message)}\n`);
    return 127;
  }

  const headerValue = `Authorization: Bearer ${apiKey}`;
  const mcpRemoteArgs = [mcpRemoteEntry, endpoint.toString(), "--header", headerValue, ...parsed.extra];

  const child = spawn(process.execPath, mcpRemoteArgs, {
    env: childEnv,
    stdio: ["inherit", "inherit", "pipe"],
    shell: false,
    windowsHide: true,
  });

  const stderrRedactor = createStderrRedactor((s) => { process.stderr.write(s); });
  child.stderr.on("data", (buf: Buffer) => stderrRedactor.push(buf.toString("utf8")));
  child.stderr.on("end", () => stderrRedactor.flush());

  return await new Promise<number>((resolve) => {
    let settled = false;
    const onSignal = (sig: NodeJS.Signals) => () => { if (!child.killed) child.kill(sig); };
    const onSigint = onSignal("SIGINT");
    const onSigterm = onSignal("SIGTERM");
    const done = (code: number) => {
      if (settled) return;
      settled = true;
      // Remove our process-level signal listeners on settle so they don't
      // accumulate or suppress Node's default signal-exit once main() resolves
      // — main() is exported and may be called programmatically (Bugbot, Low).
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      stderrRedactor.flush();
      resolve(code);
    };
    child.on("error", (err) => {
      safeStderr(`Failed to spawn mcp-remote: ${redact(err.message)}\n`);
      done(127);
    });
    // Resolve on "close" (all stdio drained), not "exit": stderr pipe data can
    // still be in flight when "exit" fires, and the entry point calls
    // process.exit() in a microtask that would drop it (Cursor Bugbot, Low).
    child.on("close", (code, signal) => {
      if (signal) { safeStderr(`mcp-remote terminated by signal ${signal}\n`); done(signalExitCode(signal)); return; }
      done(code ?? 1);
    });
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
  });
}

// Registered ONLY when run as the CLI entry point (see isMainModule below),
// never as an import side effect — these call process.exit(70), which would
// otherwise terminate any app that imports @apier/mcp on an unrelated
// unhandled error (Cursor Bugbot, Medium).
function installGlobalErrorHandlers(): void {
  process.on("uncaughtException", (err) => {
    safeStderr(`uncaughtException: ${redact(err.stack ?? err.message)}\n`);
    process.exit(70);
  });
  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    safeStderr(`unhandledRejection: ${redact(msg)}\n`);
    process.exit(70);
  });
}

// True only when this file is the process entry point. Compares the real
// (symlink-resolved) path of this module against argv[1], which is robust for
// npm bin symlinks. The old endsWith() heuristic matched on any path suffix,
// and with the `?? ""` fallback endsWith("") was always true (Cursor Bugbot,
// Medium) — so importing the module could spawn mcp-remote unexpectedly.
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  installGlobalErrorHandlers();
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (err) => {
      safeStderr(`fatal: ${redact((err as Error).message)}\n`);
      process.exit(1);
    }
  );
}
