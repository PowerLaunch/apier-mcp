# Apier MCP Server — Norwegian company data and compliance for AI agents

[Apier](https://apier.no) is a hosted [MCP](https://modelcontextprotocol.io) (Model Context Protocol) server that gives AI agents structured access to Norwegian company data and regulatory compliance. It resolves any 9-digit **organisasjonsnummer** (organisation number) against **Brønnøysundregistrene** (the Brønnøysund Register Centre / Enhetsregisteret), answers who holds **signing authority** for a company (**signaturrett** and **prokura**), reads **annual accounts** (årsregnskap) from Regnskapsregisteret, computes **filing deadlines** for MVA, A-melding and Årsregnskap, and brokers **fullmakt** — scoped, revocable company→agent authority delegated through an **Altinn 3** systembruker, authenticated upstream via **Maskinporten** against **Skatteetaten** and other agencies. This repository is the thin, hardened npm proxy (`@apier-no/mcp`) that connects local stdio MCP clients to the hosted server.

## What you can ask

With this server connected, an AI agent can answer questions like:

- "What's the organisasjonsnummer for Equinor?" *(search_companies)*
- "Who can legally sign on behalf of org number 923 609 016 — and is it signaturrett or prokura?" *(get_company_authority)*
- "Is this company VAT-registered, and what regulatory obligations does it have?" *(get_company_summary)*
- "What filing deadlines is this company facing in the next six months?" *(get_company_deadlines)*
- "Show me the latest annual accounts (årsregnskap) for this company." *(get_company_accounts)*
- "What is the Altinn 3 equivalent of this old Altinn 2 role code?" *(get_altinn_migration_guidance)*
- "What's the current Norges Bank exchange rate for EUR to NOK?" *(get_exchange_rate)*
- "Request a fullmakt so I can act on behalf of this company, then verify it before filing." *(request_fullmakt, check_fullmakt)*

## Tools

All 25 tools exposed by the hosted server at `https://www.apier.no/api/mcp` (discovered live via `tools/list` on 2026-10-10; each row is the opening sentence of the live description, so the full text is one `tools/list` call away):

| Tool | Description |
|---|---|
| `get_company_summary` | A one-shot summary of obligations and deadlines for a Norwegian organisation: your FIRST call when you orient against a company. |
| `get_public_obligations` | Keyless. Retrieve the universal obligation set for a Norwegian entity type — every regulatory obligation that applies by virtue of BEING that organisational form, before per-company Tier-2 data is layered on. |
| `get_exchange_rate` | Keyless. Norges Bank reference exchange rate for a currency against NOK — the benchmark Norwegian tax and accounting rules accept for foreign-currency obligations. |
| `list_acting_capacity` | Resolve every Norwegian regulatory action a person is currently authorised to perform on behalf of a specific organisation. |
| `get_company_profile` | Resolve a Norwegian organisasjonsnummer (9 digits) into a structured company profile from Brønnøysund Enhetsregisteret: display name, form of organisation, NACE codes with descriptions, addresses, the dates of registration and dissolution, the `active` / `dissolved` status enum, the MVA-registered flag, and the role CODES of persons — never personal identifiers. |
| `check_authorization` | Return the authorisation snapshot for the calling consumer's delegation on a Norwegian organisation: the `status` enum (`full` / `partial` / `none`), `active_scopes`, `missing_scopes` (empty on `full`) and `delegated_rights`. |
| `get_company_context` | Brønnøysund identity slice for a Norwegian organisation: legal name, form of organisation, NACE codes, addresses, the dates it was formed or dissolved, and the signaturrett / prokura role-code summary (never personal identifiers). |
| `get_company_deadlines` | The upcoming filing calendar for one organisation, horizon_months ahead. |
| `get_company_obligations` | Evaluate the Apier Rulebook for a Norwegian organisation: one entry per rule with rule_id, obligation_name, evaluation_result (applicable, not_applicable or insufficient_data), a reason, the legal_reference, frequency, data_tier_required and the bokmål description, which is inherited byte for byte (never re-translate it). |
| `get_public_deadlines` | Keyless. The universal Norwegian filing calendar: the deadlines for every Norwegian business in the covered categories (MVA, A-melding, Skattemelding, Årsregnskap), which do not depend on any one organisation. |
| `validate_action` | Dry-run a proposed regulatory action with NO upstream side effect (no government call). |
| `explain_compliance_error` | Keyless. Resolve a structured Apier compliance error code into a Norwegian-bokmål Explanation envelope: summary, bokmål why, ordered fix_steps, optional documentation link + legal_basis, and an optional handover block (who / where / what / why) for errors a human must resolve. |
| `search_companies` | Resolve a Norwegian company NAME to its 9-digit organisasjonsnummer. |
| `get_company_verification` | Fast go / no-go trust check before you act for a Norwegian organisation. |
| `get_company_authority` | Who can legally sign for this Norwegian company, and how? |
| `get_company_accounts` | A current snapshot of a Norwegian company's annual accounts (årsregnskap) from the OPEN Regnskapsregisteret tier: `has_filed_annual_accounts` (null = unknown, never a fabricated false), `last_accounts_year` and that year's minimal `key_figures` (currency always surfaced, presentation basis, totals). |
| `get_company_filing_history` | Reconcile a company's Altinn 3 filing history against the filings YOUR consumer submitted through Apier: each Altinn instance paired with its Apier audit record (`filed_via_apier` + `apier_record`). |
| `list_changes` | Read Apier's cross-source change archive — created / updated / deleted events detected across the upstreams Apier polls (Brønnøysund, Altinn schemas, Norges Bank, NAV, Skatteetaten Tier-2; the Digdir poller is retired, so `digdir` is a valid but empty filter). |
| `get_altinn_migration_guidance` | Discover the Altinn 3 equivalent of an Altinn 2 service or role code. |
| `request_fullmakt` | Broker a fullmakt — scoped, revocable company→agent authority via an Altinn systembruker. |
| `check_fullmakt` | Check your fullmakt state for a Norwegian company BEFORE acting on its behalf. |
| `revoke_fullmakt` | Revoke a fullmakt — withdraw an agent's delegated authority for a Norwegian company and retire the agent principal. |
| `get_pricing` | Call this BEFORE metered work to check per-call cost and whether billing enforcement is live. |
| `get_credit_balance` | Call this BEFORE a batch of metered calls to confirm the calling key's prepaid credit balance covers it, and AFTER a 402 INSUFFICIENT_CREDITS + human top-up to verify the funds landed. |
| `redeem_issuance_token` | Convert an owner-issued key-issuance token into your own API key — the headless onboarding step for an agent that holds no credential yet. |

## Try without a key

**Starting this proxy requires `APIER_API_KEY`** (see [Quickstart](#quickstart)). The proxy forwards whatever bearer you give it as `Authorization: Bearer …` and never inspects the key's shape. Without a real key you still have two sandbox paths, both served from synthetic fixtures and never from a government register:

- **Direct HTTP to the sandbox mirror** under `/api/v1/sandbox/` on apier.no. Every Category B company endpoint has a mirror there. It is not zero-auth: it expects a *self-invented* sandbox bearer, `apier_sandbox_test_<suffix>` (any suffix of 1–64 characters from `A-Za-z0-9_-`), which the server recognises by its prefix and answers with fixtures — no signup and no key store behind it. A separate, truly zero-auth mirror lives under `/api/v1/sandbox/public/` for the single fixture org `999999999`.
- **The same sandbox bearer on the hosted MCP endpoint** `https://www.apier.no/api/mcp`. Send `Authorization: Bearer apier_sandbox_test_<suffix>` and the fixture-backed company tools (`get_company_context`, `get_company_obligations`, `get_company_deadlines`, `get_company_summary`, `get_company_verification`, `explain_compliance_error`, `get_company_authority`, `get_company_accounts`, `get_company_filing_history`) are routed to the sandbox mirror, with `_meta.is_sandbox: true` on every result; the remaining tools answer exactly as they would without a key. Because this proxy forwards the bearer unchanged, setting `APIER_API_KEY` to such a value lets a stdio client rehearse those tools against fixtures too.

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
