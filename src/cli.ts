#!/usr/bin/env node
/**
 * apier-mcp CLI entry point.
 *
 * Reads APIER_API_KEY from the environment ONLY — never accepts the
 * key as a CLI flag. Process listings (`ps aux`, Activity Monitor)
 * leak CLI arguments to any local user; environment variables are
 * scoped to the process and are the documented MCP-client config
 * pattern (`env: { APIER_API_KEY: "..." }`).
 *
 * Recognised flags:
 *   --endpoint <url>   Override the default https://www.apier.no/api/mcp
 *                      (or set APIER_MCP_ENDPOINT env var)
 *   --version, -v      Print version and exit
 *   --help, -h         Print usage and exit
 */
import { startProxy } from "./index.js";

// Keep in sync with package.json#version. Hardcoded rather than read at
// runtime so a bundled binary doesn't need fs access. The build script
// (and prepublishOnly hook) is the discipline that keeps this honest.
const VERSION = "0.1.0";

const HELP = `apier-mcp ${VERSION} — Thin proxy to Apier's hosted MCP server.

Usage: apier-mcp [options]

Options:
  --endpoint <url>     Override default https://www.apier.no/api/mcp
                       (or set APIER_MCP_ENDPOINT)
  --version, -v        Print version and exit
  --help, -h           Print this help and exit

Required environment variable:
  APIER_API_KEY        Get a key at https://www.apier.no/dashboard/keys

Example MCP client config (Claude Desktop / Cursor):
  {
    "mcpServers": {
      "apier": {
        "command": "npx",
        "args": ["-y", "@apier-no/mcp"],
        "env": { "APIER_API_KEY": "apier_live_<your_key>" }
      }
    }
  }

Docs: https://www.apier.no/docs
Issues: https://github.com/PowerLaunch/apier-mcp/issues
`;

function parseArgs(argv: readonly string[]): {
  endpoint?: string;
  showHelp: boolean;
  showVersion: boolean;
  error?: string;
} {
  let endpoint: string | undefined;
  let showHelp = false;
  let showVersion = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
    } else if (arg === "--version" || arg === "-v") {
      showVersion = true;
    } else if (arg === "--endpoint") {
      const next = argv[i + 1];
      if (typeof next !== "string" || next.length === 0) {
        return {
          showHelp: false,
          showVersion: false,
          error: "--endpoint requires a URL argument.",
        };
      }
      endpoint = next;
      i++;
    } else {
      return {
        showHelp: false,
        showVersion: false,
        error: `Unknown argument: ${arg}`,
      };
    }
  }

  return { endpoint, showHelp, showVersion };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.error !== undefined) {
    process.stderr.write(`apier-mcp: ${parsed.error}\n\n${HELP}`);
    process.exit(1);
  }

  if (parsed.showHelp) {
    // Help goes to stderr (NOT stdout) — stdout is reserved for MCP
    // JSON-RPC frames. A user running `apier-mcp --help` sees the
    // text the same way regardless of stream.
    process.stderr.write(HELP);
    process.exit(0);
  }

  if (parsed.showVersion) {
    process.stderr.write(`apier-mcp ${VERSION}\n`);
    process.exit(0);
  }

  try {
    await startProxy({ endpoint: parsed.endpoint });
  } catch (err) {
    // Last-resort error handler. Never echo err.message — Supabase /
    // network error strings can carry token fragments or header
    // bytes. Only the constructor name is safe.
    const name = err instanceof Error ? err.constructor.name : typeof err;
    process.stderr.write(`apier-mcp: fatal error (${name})\n`);
    process.exit(1);
  }
}

void main();
