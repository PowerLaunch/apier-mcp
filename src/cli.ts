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

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as {
  version: string;
  name: string;
  dependencies: Record<string, string>;
};

const DEFAULT_ENDPOINT = "https://www.apier.no/api/mcp";
const VERSION = pkg.version;

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-+/=]{8,}/g,
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
    // Deny takes precedence over every passthrough rule below (including the
    // NODE_/LC_ prefixes). Without deny-first, NODE_AUTH_TOKEN matched
    // startsWith("NODE_") and leaked into the child env, bypassing the deny
    // list (Cursor Bugbot, High). No exact-allowlist name contains a deny
    // substring, so deny-first never blocks a legitimate passthrough.
    if (ENV_DENY_SUBSTRINGS.some((s) => upper.includes(s))) continue;
    if (ENV_PASSTHROUGH_ALLOWLIST.has(k)) { child[k] = v; continue; }
    if (ENV_PASSTHROUGH_ALLOWLIST.has(upper)) { child[k] = v; continue; }
    if (upper.startsWith("LC_")) { child[k] = v; continue; }
    if (upper.startsWith("NODE_")) { child[k] = v; continue; }
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

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  let parsed: ParsedArgs;
  try { parsed = parseArgs(argv); }
  catch (e) { safeStderr(`${(e as Error).message}\n`); return 2; }

  if (parsed.showHelp) { safeStderr(HELP); return 0; }
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

  // Pin the npx-fetched mcp-remote to the exact version package.json declares.
  // Without @version, `npx -y mcp-remote` silently downloads the LATEST from
  // npm if it can't find the locally-installed binary, defeating the exact-pin
  // supply-chain guarantee (Cursor Bugbot, Medium). Single source of truth:
  // package.json dependencies.
  const mcpRemoteVersion = pkg.dependencies["mcp-remote"];
  if (!mcpRemoteVersion) {
    safeStderr("mcp-remote is not pinned in package.json dependencies; refusing to spawn.\n");
    return 2;
  }

  const headerValue = `Authorization: Bearer ${apiKey}`;
  const mcpRemoteArgs = ["-y", `mcp-remote@${mcpRemoteVersion}`, endpoint.toString(), "--header", headerValue, ...parsed.extra];

  const child = spawn("npx", mcpRemoteArgs, {
    env: childEnv,
    stdio: ["inherit", "inherit", "pipe"],
    shell: false,
    windowsHide: true,
  });

  child.stderr.on("data", (buf: Buffer) => { safeStderr(buf.toString("utf8")); });

  return await new Promise<number>((resolve) => {
    let settled = false;
    const done = (code: number) => { if (settled) return; settled = true; resolve(code); };
    child.on("error", (err) => {
      safeStderr(`Failed to spawn mcp-remote: ${redact(err.message)}\n`);
      done(127);
    });
    child.on("exit", (code, signal) => {
      if (signal) { safeStderr(`mcp-remote terminated by signal ${signal}\n`); done(128); return; }
      done(code ?? 1);
    });
    const forward = (sig: NodeJS.Signals) => () => { if (!child.killed) child.kill(sig); };
    process.on("SIGINT", forward("SIGINT"));
    process.on("SIGTERM", forward("SIGTERM"));
  });
}

process.on("uncaughtException", (err) => {
  safeStderr(`uncaughtException: ${redact(err.stack ?? err.message)}\n`);
  process.exit(70);
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  safeStderr(`unhandledRejection: ${redact(msg)}\n`);
  process.exit(70);
});

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
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (err) => {
      safeStderr(`fatal: ${redact((err as Error).message)}\n`);
      process.exit(1);
    }
  );
}
