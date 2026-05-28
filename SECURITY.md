# Security policy — @apier-no/mcp

## Threat model

This package is a local proxy. It sits between your MCP client (Claude Desktop, Cursor, etc.) and Apier's hosted endpoint. It does not itself process Norwegian compliance data; that happens server-side.

### What we defend against

1. **API key leakage into spawned child processes.** `APIER_API_KEY` is read by the parent, then removed from the env object passed to `mcp-remote`. The child process never sees the key in its environment.
2. **API key leakage via diagnostic output.** All stderr from this process and from the spawned child is passed through a redactor that strips `Bearer …`, `apier_(live|test)_…`, `ghp_…`, and `Authorization:` substrings.
3. **Mistargeted endpoints.** Non-https URLs are rejected before spawn.
4. **Supply-chain drift.** `mcp-remote` is exact-pinned (no caret, no tilde). Releases are published with npm provenance via GitHub Actions Trusted Publishing (OIDC). Tarball contents are extracted and grepped for secret-shaped strings in CI.

### Residual risks (accepted, documented)

These are explicitly out of scope for this package. They sit at the local-machine layer.

1. **Shell history.** If you run `npx -y @apier-no/mcp` with the key inlined on the command line, your shell will record it. Prefer the `APIER_API_KEY` env variable.
2. **MCP client config files.** Some users will paste the key into `claude_desktop_config.json` or `.cursor/mcp.json` and may accidentally commit those files. Treat these files as you treat `.env` — never commit.
3. **Local process inspection.** On multi-user systems, `ps aux` or equivalent can reveal the `--header` argv to other local users with sufficient privilege. This package runs in user space; it cannot defend against an attacker who already has user-level shell access on your machine.
4. **`mcp-remote` itself.** This package depends on `mcp-remote`. A compromise of that package or its transitive dependencies would compromise this one. We exact-pin and watch advisories.

## Reporting a vulnerability

Email **security@apier.no**.

Please include reproduction steps and the version of `@apier-no/mcp` you tested against. We aim to acknowledge within 48 hours and to publish a fix within 7 days for high-severity issues.

Do not file public GitHub issues for security reports.
