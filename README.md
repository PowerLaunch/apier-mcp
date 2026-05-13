# @divisco/mcp

Thin npm proxy that connects local MCP clients (Claude Desktop, Cursor, Zed, Codex, etc.) to **[Apier](https://www.apier.no)'s hosted Norwegian compliance MCP server** at `https://www.apier.no/api/mcp`.

Apier exposes Norwegian government compliance data and actions — Brønnøysund company lookups, Altinn delegations, Skatteetaten obligations, deadline math, regulatory rules — as MCP tools that AI agents can call directly. This package is the local bridge: it runs over stdio in your MCP client and forwards every frame to Apier over Streamable HTTP.

## What it is (and what it isn't)

**Is:** a ~150-line transport-level passthrough. Your client speaks MCP over stdio; this proxy forwards every frame to `https://www.apier.no/api/mcp` with your `Authorization: Bearer ${APIER_API_KEY}` header attached.

**Isn't:** a re-implementation of MCP. All tool / resource / prompt semantics live server-side. When Apier ships a new tool, you don't reinstall this package — the new tool surfaces immediately to your local client.

## Install

```sh
npm install -g @divisco/mcp
```

Or use `npx` directly in your MCP client config (recommended — no global install needed):

```sh
npx -y @divisco/mcp
```

## Get an API key

Sign up at [apier.no](https://www.apier.no) and visit your dashboard:

→ **<https://www.apier.no/dashboard/keys>**

The Free tier ships with one key and enough quota for evaluation. Keys are scoped — Apier rotates them and revokes per-key with no global rollover.

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "apier": {
      "command": "npx",
      "args": ["-y", "@divisco/mcp"],
      "env": {
        "APIER_API_KEY": "apier_live_<your_key_here>"
      }
    }
  }
}
```

Restart Claude Desktop. The Apier tools (company lookup, obligations, deadlines, etc.) will appear in the tool picker.

## Cursor

Edit `~/.cursor/mcp.json` (or use Cursor's MCP settings UI):

```json
{
  "mcpServers": {
    "apier": {
      "command": "npx",
      "args": ["-y", "@divisco/mcp"],
      "env": {
        "APIER_API_KEY": "apier_live_<your_key_here>"
      }
    }
  }
}
```

Restart Cursor. Apier tools become available to Cursor's agent.

## Other MCP clients

Any MCP client that supports the stdio transport works. The pattern is the same: invoke `npx -y @divisco/mcp` with `APIER_API_KEY` in the environment.

## Available tools

See **<https://www.apier.no/docs>** for the live tool catalogue and parameter shapes. Tools are versioned server-side; the catalogue is the canonical reference.

A non-exhaustive snapshot:

- `company.lookup` — Brønnøysund company-registry lookups by org number
- `company.obligations` — current and upcoming regulatory obligations
- `company.deadlines` — deadline math (MVA filings, A-melding, årsregnskap, …)
- `delegations.list` — Altinn delegations for an org number
- `rules.evaluate` — run an evaluation against the live Apier Rulebook

## Configuration

| Variable               | Default                                | Description                                                    |
|------------------------|----------------------------------------|----------------------------------------------------------------|
| `APIER_API_KEY`        | **(required, no default)**             | Your Apier API key. Get one at the dashboard link above.       |
| `APIER_MCP_ENDPOINT`   | `https://www.apier.no/api/mcp`         | Override the server URL. **Must be `https://`**; `http://` is rejected. |

You can also pass `--endpoint <url>` as a CLI flag (env var has priority for the key — see Security below).

## Troubleshooting

**1. "APIER_API_KEY environment variable is required."**

The proxy could not find an `APIER_API_KEY` in its environment. In MCP-client configs, the env var goes inside the `"env"` object of the server entry — *not* as a CLI argument. Re-read the JSON snippets above; the proxy intentionally refuses CLI-flag keys because `ps aux` and Activity Monitor leak CLI arguments to other local users.

**2. "Endpoint must use https://"**

You set `APIER_MCP_ENDPOINT` (or `--endpoint`) to an `http://` URL. The proxy refuses plaintext — your API key would be visible to anything on the network path. Apier's production endpoint is `https://www.apier.no/api/mcp`; only override this for local Apier development behind an HTTPS-terminating proxy.

**3. Tool calls return "401 Unauthorized" or "403 Forbidden"**

Your API key was rejected by Apier. Check at <https://www.apier.no/dashboard/keys> that the key is active and not revoked. If the issue is `403 Forbidden` rather than `401 Unauthorized`, the key is valid but the requested tool requires a higher tier or a scope that the key doesn't carry — the dashboard shows per-key scopes.

## Security

The proxy is built for the worst case: a malicious or buggy MCP client running on the same machine.

- `APIER_API_KEY` is read from the environment **only**. CLI-flag keys are refused — `ps`-listable arguments are a leak channel.
- `https://` is enforced; `http://` is rejected at startup.
- The proxy never writes the API key value to stdout, stderr, log files, or error messages. Error formatting uses `err.constructor.name`, never `err.message` (which can carry HTTP header bytes).
- All diagnostic output goes to stderr; stdout is reserved exclusively for MCP JSON-RPC frames so a stray log line cannot corrupt the protocol stream and crash the client.

## Source + issues

- Source: <https://github.com/PowerLaunch/apier-mcp>
- Issues: <https://github.com/PowerLaunch/apier-mcp/issues>
- Apier docs: <https://www.apier.no/docs>

## Versioning

Semver. The proxy aims to be stable — most Apier feature additions land server-side and surface to local clients without a republish. Breaking changes to the proxy itself (CLI flags, env vars, supported Node versions) bump minor or major.

## License

[MIT](LICENSE) © 2026 PowerLaunch AS
