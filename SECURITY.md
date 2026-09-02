# Security policy — @apier-no/mcp

## Threat model

This package is a local proxy. It sits between your MCP client (Claude Desktop, Cursor, etc.) and Apier's hosted endpoint. It does not itself process Norwegian compliance data; that happens server-side.

### What we defend against

1. **API key leakage into spawned child processes.** The child environment is built by deny-list then allow-list: every *caller-supplied* variable whose name contains `TOKEN`/`SECRET`/`BEARER`/`KEY`/`PASSWORD`/`CREDENTIAL`/`APIER` is dropped, `APIER_API_KEY` included, and anything not on the explicit allow-list is dropped too.

   Exactly one variable is then added back by this proxy, after that filtering: `APIER_MCP_AUTH_HEADER`, holding `Bearer <key>`, which `mcp-remote` expands into its `Authorization` request header. Its name deliberately contains `APIER`, so a *caller-supplied* value of that name is stripped by the deny-list pass before the real value is assigned and cannot be spoofed through the parent environment. `APIER_API_KEY` under its own name never reaches the child.
2. **API key leakage into the child's command line.** The `--header` argv element contains only the literal placeholder `Authorization:${APIER_MCP_AUTH_HEADER}` — no key material. Process-listing interfaces that expose command lines (`ps aux`, `/proc/<pid>/cmdline`, Windows WMI `Win32_Process.CommandLine`) reveal nothing usable. This closes [#33](https://github.com/PowerLaunch/apier-mcp/issues/33).
3. **API key leakage via diagnostic output.** All stderr from this process and from the spawned child is passed through a redactor that strips `Bearer …`, `apier_(live|test)_…`, `ghp_…`, and `Authorization:` substrings. `mcp-remote`'s `Using custom headers: …` diagnostic lists header *names* only, so no header value — neither the `${APIER_MCP_AUTH_HEADER}` placeholder nor the live key — is written to that log line.
4. **Mistargeted endpoints.** Non-https URLs are rejected before spawn.
5. **Supply-chain drift.** `mcp-remote` is exact-pinned (no caret, no tilde). Releases are published with npm provenance via GitHub Actions Trusted Publishing (OIDC). Tarball contents are extracted and grepped for secret-shaped strings in CI.

### Residual risks (accepted, documented)

These are explicitly out of scope for this package. They sit at the local-machine layer.

1. **Shell history.** If you run `npx -y @apier-no/mcp` with the key inlined on the command line, your shell will record it. Prefer the `APIER_API_KEY` env variable.
2. **MCP client config files.** Some users will paste the key into `claude_desktop_config.json` or `.cursor/mcp.json` and may accidentally commit those files. Treat these files as you treat `.env` — never commit.
3. **Local process inspection.** The key is no longer exposed on the child's command line — as of 1.2.0 the `--header` argv element carries only a placeholder, and the bearer value travels in the child's environment instead (see "What we defend against" #2). This matters because the two are not equally protected: on Linux `/proc/<pid>/cmdline` is world-readable, so *any* local user could previously read the key out of a running proxy, whereas `/proc/<pid>/environ` is readable only by the process owner and root.

   What remains: an attacker who is already running as your user, or as root, can still read the value out of the process environment (`/proc/<pid>/environ`, a debugger, a core dump) — as they could read it from your MCP client's config file or your shell environment anyway. This package runs in user space and cannot defend against an attacker who already has your privileges. Rotate the key in the dashboard at https://www.apier.no/dashboard if you suspect local compromise.
4. **`mcp-remote` itself.** This package depends on `mcp-remote`. A compromise of that package or its transitive dependencies would compromise this one. We exact-pin and watch advisories.

## Reporting a vulnerability

Email **security@apier.no**.

Please include reproduction steps and the version of `@apier-no/mcp` you tested against. We aim to acknowledge within 48 hours and to publish a fix within 7 days for high-severity issues.

Do not file public GitHub issues for security reports.
