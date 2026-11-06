# Apier MCP Server — Norwegian company data and compliance for AI agents

[Apier](https://apier.no) is a hosted [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that gives AI agents structured access to Norwegian company data and regulatory compliance. It resolves any 9-digit **organisasjonsnummer** (organisation number) against **Brønnøysundregistrene** (the Brønnøysund Register Centre / Enhetsregisteret), returns the register's coded signing rules for the company (**signaturrett** and **prokura**, uninterpreted), reads **annual accounts** (årsregnskap) from Regnskapsregisteret and computes **filing deadlines** for MVA, A-melding and Årsregnskap. It reads open public registers only: it submits nothing to government and brokers no government access. This repository is the thin, hardened npm proxy (`@apier-no/mcp`) that connects local stdio MCP clients to the hosted server.

## What you can ask

With this server connected, an AI agent can answer questions like:

- "What's the organisasjonsnummer for Equinor?" *(search_companies)*
- "What are the register's coded signing rules for org number 923 609 016, signaturrett and prokura?" *(get_company_authority)*
- "Is this company VAT-registered, and what regulatory obligations does it have?" *(get_company_summary)*
- "What filing deadlines is this company facing in the next six months?" *(get_company_deadlines)*
- "Show me the latest annual accounts (årsregnskap) for this company." *(get_company_accounts)*
- "What is the Altinn 3 equivalent of this old Altinn 2 role code?" *(get_altinn_migration_guidance)*
- "What's the current Norges Bank exchange rate for EUR to NOK?" *(get_exchange_rate)*

## Tools

The hosted server at `https://www.apier.no/api/mcp` publishes its current tool list, with each tool's full description and `required_scope`, at the keyless discovery endpoint `GET https://www.apier.no/api/mcp` (and through `tools/list`). That endpoint is the source of truth; this README keeps no count. On 2026-11-06 it listed:

- `get_company_summary`
- `get_public_obligations`
- `get_exchange_rate`
- `get_company_profile`
- `get_company_context`
- `get_company_deadlines`
- `get_company_obligations`
- `get_public_deadlines`
- `explain_compliance_error`
- `search_companies`
- `get_company_verification`
- `get_company_authority`
- `get_company_accounts`
- `get_company_evidence_pack`
- `list_changes`
- `get_altinn_migration_guidance`
- `get_pricing`
- `get_credit_balance`
- `redeem_issuance_token`

## Try without a key

**Starting this proxy requires `APIER_API_KEY`** (see [Quickstart](#quickstart)). The proxy forwards whatever bearer you give it as `Authorization: Bearer …` and never inspects the key's shape. Without a real key you still have two sandbox paths, both served from synthetic fixtures and never from a government register:

- **Direct HTTP to the sandbox mirror** under `/api/v1/sandbox/` on apier.no. Every Category B company endpoint has a mirror there. It is not zero-auth: it expects a *self-invented* sandbox bearer, `apier_sandbox_test_<suffix>` (any suffix of 1–64 characters from `A-Za-z0-9_-`), which the server recognises by its prefix and answers with fixtures — no signup and no key store behind it. A separate, truly zero-auth mirror lives under `/api/v1/sandbox/public/` for the single fixture org `999999999`.
- **The same sandbox bearer on the hosted MCP endpoint** `https://www.apier.no/api/mcp`. Send `Authorization: Bearer apier_sandbox_test_<suffix>` and the fixture-backed company tools (`get_company_context`, `get_company_obligations`, `get_company_deadlines`, `get_company_summary`, `get_company_verification`, `explain_compliance_error`, `get_company_authority`, `get_company_accounts`) are routed to the sandbox mirror, with `_meta.is_sandbox: true` on every result; the remaining tools answer exactly as they would without a key. Because this proxy forwards the bearer unchanged, setting `APIER_API_KEY` to such a value lets a stdio client rehearse those tools against fixtures too.

List the canonical sandbox test data (no auth at all):

```bash
curl -sL https://apier.no/api/v1/sandbox/fixtures
```

Trimmed response — `…` marks omitted fields:

```text
{"success":true,"data":{"schema_version":"1.0.0",
  "reserved_test_orgs":[{"org_number":"999000001","name":"Sandbox AS","entity_type":"AS","data_tier":"tier_1", …}],
  "realistic_orgs":[{"org_number":"818000006","name":"Fjellberg Regnskap AS","entity_type":"AS","data_tier":"tier_1_2"}, …],
  "magic_scenarios":[{"org_number":"999660010","state":"konkurs","label":"Bankrupt (konkurs)"}, …], …}}
```

Verify the bankrupt fixture company with a self-invented bearer — any suffix of 1–64 chars from `A-Za-z0-9_-` after `apier_sandbox_test_` works; here bash's `$RANDOM` supplies one. (This call goes to the `www` host directly: the apex→www 308 redirect makes curl drop the `Authorization` header.)

<!--
  CI COUPLING — keep $RANDOM in the command below; do not substitute a literal
  suffix. README.md ships inside the npm tarball, and the tarball-audit job in
  .github/workflows/ci.yml greps the packed files for secret-shaped strings.
  One of its patterns is the word Bearer, then whitespace, then 20 or more
  characters from [A-Za-z0-9._+/=-]. The sandbox token prefix on the next line
  is exactly 19 of those characters, and `$` falls outside the class, so the
  run stops at 19 and the pattern does not match. Any literal suffix pushes it
  to 20 or more and fails CI.
-->

```bash
curl -s -H "Authorization: Bearer apier_sandbox_test_$RANDOM" https://www.apier.no/api/v1/sandbox/company/999660010/verify
```

Trimmed response — `…` marks omitted fields:

```text
{"success":true,"data":{"org_number":"999660010","name":"Sandbox Konkurs AS",
  "verification_status":"fail",
  "signals":{"is_active":false,"not_bankrupt":false, …},
  "summary":"Selskapet er ikke aktivt registrert i Enhetsregisteret.", …}}
```

Don't confuse the two prefixes: a real API key is `apr_<tier>_…` (`apr_free_`, `apr_starter_`, `apr_pro_` or `apr_ent_`) and comes from signup via https://www.apier.no/docs/authentication, while `apier_sandbox_test_` is self-generated and needs no signup. (Earlier README versions mentioned `apier_live_` / `apier_test_` keys; no key of that shape was ever issued.) `GET /api/v1/sandbox/fixtures` is the canonical machine-readable table of sandbox test data.

## Quickstart

### Hosted endpoint (streamable HTTP)

The fastest path — no install. Point any streamable-HTTP-capable MCP client at:

```text
https://www.apier.no/api/mcp
```

Discovery is **keyless**: `initialize`, `tools/list`, resources and prompts all work without credentials, so an agent can explore the full catalogue before authenticating. An API key (`Authorization: Bearer apr_<tier>_…`) is needed only for protected tool calls. See https://www.apier.no/docs/authentication for how to get a key, then create one in the dashboard at https://www.apier.no/dashboard.

### npx stdio proxy (`@apier-no/mcp`)

For stdio-only clients, this package wraps [`mcp-remote`](https://github.com/punkpeye/mcp-remote), reads `APIER_API_KEY` from your environment, removes it from the spawned child's environment, redacts it from stderr, and hands the bearer value over out-of-band so it never appears on the child's command line — see [SECURITY.md](./SECURITY.md).

`mcp-remote` moved from `geelen/mcp-remote` to `punkpeye/mcp-remote`; the npm package name is unchanged, and 0.8.1 is published with SLSA provenance attestations.

**Published as `@apier-no/mcp`.** The `@apier` scope was unavailable, so this package ships under the `@apier-no` scope.

**Claude Desktop / Cursor** (`claude_desktop_config.json` / `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "apier": {
      "command": "npx",
      "args": ["-y", "@apier-no/mcp"],
      "env": { "APIER_API_KEY": "apr_<tier>_<your_key_here>" }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "apier": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@apier-no/mcp"],
      "env": { "APIER_API_KEY": "apr_<tier>_<your_key_here>" }
    }
  }
}
```

**Zed** (`settings.json`):

```json
{
  "context_servers": {
    "apier": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "@apier-no/mcp"],
      "env": { "APIER_API_KEY": "apr_<tier>_<your_key_here>" }
    }
  }
}
```

Ready-to-paste config files for each client live in [`examples/`](./examples).

## Configuration

| Variable | Required | Default |
|---|---|---|
| `APIER_API_KEY` | yes | — |
| `--endpoint <url>` | no | `https://www.apier.no/api/mcp` |
| `MCP_REMOTE_CONFIG_DIR` | no | `~/.mcp-auth` |

## Security

- `APIER_API_KEY` is read by the parent process and **scrubbed from the spawned child's environment**, and stderr is passed through a redactor that strips `Bearer …`, bare `apr_<tier>_…` keys and `apr_issue_…` key-issuance tokens, the legacy `apier_(live|test)_…` shape, `ghp_…`, and `Authorization:` substrings.
- **The key never appears in the child's command line.** The `--header` argument carries only the placeholder `Authorization:${APIER_MCP_AUTH_HEADER}`; the bearer value is passed out-of-band in that variable and expanded by `mcp-remote` at request time. Command lines are world-readable on Linux (`/proc/<pid>/cmdline`), process environments are not — so this is no longer readable by other local users ([#33](https://github.com/PowerLaunch/apier-mcp/issues/33), fixed in 1.2.0). An attacker already running as you can still read the environment — see [SECURITY.md](./SECURITY.md).
- Non-https endpoints are rejected before spawn; `mcp-remote` is exact-pinned and releases are published with npm provenance via GitHub Actions Trusted Publishing (OIDC).
- Treat client config files (`claude_desktop_config.json`, `.cursor/mcp.json`, …) like `.env` files — never commit them with a real key.

Full threat model and disclosure policy: [SECURITY.md](./SECURITY.md).

## Documentation

- MCP server docs: https://www.apier.no/docs/mcp
- Apier platform docs: https://apier.no/docs

## License

MIT
