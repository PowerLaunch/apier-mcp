# @apier-no/mcp

Hardened thin npm proxy that connects local MCP clients (Claude Desktop, Cursor, Zed, Codex) to **[Apier](https://www.apier.no)'s hosted Norwegian compliance MCP server** at `https://www.apier.no/api/mcp`.

**Replaces `@apier-no/mcp`.** Old package is deprecated on npm with a pointer here.

## What this is

A small wrapper around [`mcp-remote`](https://github.com/geelen/mcp-remote) that:

- Reads `APIER_API_KEY` from your environment.
- **Scrubs it from the spawned child process environment** before invoking `mcp-remote`.
- Forwards the key only via `--header "Authorization: Bearer …"` argv.
- Refuses non-https endpoints.
- Redacts any `Bearer …`, `apier_(live|test)_…`, `ghp_…`, or `Authorization:` substring from stderr before writing.

All tool semantics live server-side at https://www.apier.no/api/mcp.

## Install
npm install -g @apier-no/mcp

or invoke ephemerally via `npx`:
npx -y @apier-no/mcp

## Get an API key

https://www.apier.no/dashboard/keys

## Claude Desktop / Cursor config

```json
{
  "mcpServers": {
    "apier": {
      "command": "npx",
      "args": ["-y", "@apier-no/mcp"],
      "env": { "APIER_API_KEY": "apier_live_<your_key_here>" }
    }
  }
}
```

## Configuration

| Variable | Required | Default |
|---|---|---|
| `APIER_API_KEY` | yes | — |
| `--endpoint <url>` | no | `https://www.apier.no/api/mcp` |
| `MCP_REMOTE_CONFIG_DIR` | no | `~/.mcp-auth` |

## Security

See [SECURITY.md](./SECURITY.md) for the full threat model and disclosure policy.

## License

MIT
