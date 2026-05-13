/**
 * @apier-no/mcp — Thin transport-level proxy that bridges a local stdio
 * MCP client (Claude Desktop, Cursor, etc.) to Apier's hosted MCP
 * server over Streamable HTTP.
 *
 * The proxy is intentionally a pure-passthrough pipe at the transport
 * level — it never inspects, decodes, or rewrites MCP protocol frames.
 * All tool / resource / prompt semantics live server-side at
 * https://www.apier.no/api/mcp; a thin proxy makes the local client
 * transparent to MCP-protocol additions without requiring an npm
 * republish.
 *
 * SECURITY:
 *   - APIER_API_KEY is read from the environment ONLY (never CLI
 *     flag — `ps aux` would leak it). Missing or empty key exits 1
 *     with a helpful stderr message.
 *   - HTTP endpoint is rejected if not https:// — Apier is HTTPS-only.
 *   - ALL diagnostic output goes to stderr; stdout is reserved for
 *     MCP JSON-RPC frames (corrupting stdout with a stray log line
 *     breaks the MCP client).
 *   - APIER_API_KEY value is NEVER written to stderr (or anywhere).
 *     Error messages format only `err.name` / `err.constructor.name`,
 *     never the message which could carry header / auth bytes.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_ENDPOINT = "https://www.apier.no/api/mcp";

export interface StartProxyOptions {
  /** Override https://www.apier.no/api/mcp. Falls back to
   *  APIER_MCP_ENDPOINT env var, then to the default. */
  endpoint?: string;
}

export async function startProxy(
  options: StartProxyOptions = {},
): Promise<void> {
  // ── API key ─────────────────────────────────────────────────
  const apiKey = process.env.APIER_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    process.stderr.write(
      "apier-mcp: APIER_API_KEY environment variable is required.\n" +
        "  Get a key at https://www.apier.no/dashboard/keys\n" +
        "  Then add it to your MCP client config (example for Claude Desktop):\n" +
        '    "env": { "APIER_API_KEY": "apier_live_<your_key>" }\n',
    );
    process.exit(1);
  }

  // ── Endpoint resolution + HTTPS-only enforcement ────────────
  const rawEndpoint =
    options.endpoint ?? process.env.APIER_MCP_ENDPOINT ?? DEFAULT_ENDPOINT;

  let endpointUrl: URL;
  try {
    endpointUrl = new URL(rawEndpoint);
  } catch {
    process.stderr.write(
      `apier-mcp: invalid endpoint URL "${rawEndpoint}". Expected an https:// URL.\n`,
    );
    process.exit(1);
  }

  if (endpointUrl.protocol !== "https:") {
    process.stderr.write(
      `apier-mcp: endpoint must use https:// (got "${endpointUrl.protocol}//"). Apier's MCP server is HTTPS-only — http:// would expose API keys in transit.\n`,
    );
    process.exit(1);
  }

  process.stderr.write(`apier-mcp: connecting to ${endpointUrl.href}\n`);

  // ── Transports ─────────────────────────────────────────────
  // StreamableHTTPClientTransport: outbound link to Apier.
  // The Authorization header is set via requestInit so it threads
  // through every HTTP request the transport makes.
  const httpTransport = new StreamableHTTPClientTransport(endpointUrl, {
    requestInit: {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  });

  // StdioServerTransport: local link to Claude Desktop / Cursor /
  // any stdio-MCP client. Reads framed messages from stdin, writes
  // to stdout.
  const stdioTransport = new StdioServerTransport();

  // ── Bridge ─────────────────────────────────────────────────
  // Pure transport-level passthrough. We never decode MCP frames,
  // so a future protocol version with new methods works without a
  // republish. The MCP session state lives end-to-end between the
  // local client and the Apier server — we're just plumbing.
  stdioTransport.onmessage = (message) => {
    void httpTransport.send(message).catch((err: unknown) => {
      // Log only the error constructor name — error.message can
      // carry header bytes or fragments of the request body.
      const name = err instanceof Error ? err.constructor.name : typeof err;
      process.stderr.write(
        `apier-mcp: client→server forward failed (${name})\n`,
      );
    });
  };

  httpTransport.onmessage = (message) => {
    void stdioTransport.send(message).catch((err: unknown) => {
      const name = err instanceof Error ? err.constructor.name : typeof err;
      process.stderr.write(
        `apier-mcp: server→client forward failed (${name})\n`,
      );
    });
  };

  // ── Graceful shutdown ──────────────────────────────────────
  let shuttingDown = false;
  const handleShutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`apier-mcp: ${signal} received, closing transports.\n`);
    try {
      await stdioTransport.close();
    } catch (err) {
      const name = err instanceof Error ? err.constructor.name : typeof err;
      process.stderr.write(`apier-mcp: stdio close error (${name})\n`);
    }
    try {
      await httpTransport.close();
    } catch (err) {
      const name = err instanceof Error ? err.constructor.name : typeof err;
      process.stderr.write(`apier-mcp: http close error (${name})\n`);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void handleShutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void handleShutdown("SIGTERM");
  });

  // ── Start ──────────────────────────────────────────────────
  // Start HTTP first so the local client sees a ready proxy by
  // the time stdin starts emitting frames.
  await httpTransport.start();
  await stdioTransport.start();

  process.stderr.write("apier-mcp: ready, bridging messages.\n");
}
