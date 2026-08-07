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

All 25 tools exposed by the hosted server at `https://www.apier.no/api/mcp` (discovered live via `tools/list`):

| Tool | Description |
|---|---|
| `get_company_summary` | Retrieve a one-shot compliance summary for a Norwegian organisation by its 9-digit organisasjonsnummer (organisation number, the public ID issued by the Brønnøysund Register Centre / Enhetsregisteret — Central Register of Legal Entities). |
| `get_public_obligations` | Retrieve the universal obligation set for a Norwegian entity type. |
| `get_exchange_rate` | Fetch the most recent Norges Bank (Norway's central bank, Norges Bank in Norwegian — the official issuer of the krone) exchange-rate reference for a currency against NOK. |
| `list_acting_capacity` | Resolve every Norwegian regulatory action a person is currently authorised to perform on behalf of a specific organisation. |
| `get_company_profile` | Resolve a Norwegian organisasjonsnummer (9-digit org number) into a structured company profile sourced from Brønnøysund Enhetsregisteret (data.brreg.no). |
| `check_authorization` | Return the authorisation snapshot for the calling consumer's delegation on a Norwegian organisation. |
| `get_company_context` | Retrieve the structured Brønnøysund identity slice for a Norwegian organisation by its 9-digit organisasjonsnummer (organisation number, the public ID issued by the Brønnøysund Register Centre / Enhetsregisteret — Central Register of Legal Entities). |
| `get_company_deadlines` | Compute the upcoming Norwegian regulatory filing calendar for a specific organisation, looking horizon_months into the future. |
| `get_company_obligations` | Evaluate the Apier Rulebook for a Norwegian organisation and return every applicable regulatory obligation with its current state and the legal reference it derives from. |
| `get_public_deadlines` | Compute the universal Norwegian regulatory filing calendar — the set of deadlines that apply to every Norwegian business of the covered categories (MVA, A-melding, Årsregnskap), independent of any specific organisation. |
| `validate_action` | Run the Apier dry-run validator against a proposed regulatory action without producing ANY upstream side effect — no Maskinporten call, no Altinn / Skatteetaten / NAV submission. |
| `explain_compliance_error` | Resolve a structured Apier compliance error code into a Norwegian-bokmål Explanation envelope sourced from the Apier Compliance Explainer (PR-049). |
| `search_companies` | Resolve a Norwegian company NAME to its 9-digit organisasjonsnummer (organisation number). |
| `get_company_verification` | Get the deterministic verification verdict for a Norwegian organisation by its 9-digit organisasjonsnummer (organisation number, the public ID issued by the Brønnøysund Register Centre / Enhetsregisteret). |
| `get_company_authority` | Use this to answer "who can legally sign for this Norwegian company, and how?" before acting on its behalf. |
| `get_company_accounts` | Use this for a current-snapshot read of a Norwegian company's annual accounts (årsregnskap) from the OPEN Regnskapsregisteret tier. |
| `get_company_filing_history` | Use this to reconcile a Norwegian company's Altinn 3 filing history against the filings YOUR consumer submitted through Apier — the accountant/auditor reconciliation wedge. |
| `list_changes` | Use this to read Apier's cross-source change archive — detected created / updated / deleted events across the upstreams Apier polls: Brønnøysund ingestion plus the multi-source pollers for Altinn schemas, DigDir policies, and Norges Bank rates. |
| `get_altinn_migration_guidance` | Use this to discover the Altinn 3 equivalent of an Altinn 2 service or role code. |
| `request_fullmakt` | Broker a fullmakt — a legally-grounded, scoped, revocable company→agent authority delegated through an Altinn systembruker (system user). |
| `check_fullmakt` | Check your fullmakt state for a Norwegian company BEFORE acting on its behalf — the read leg of AGT-02 Fullmakt Rails and the natural follow-up to request_fullmakt. |
| `revoke_fullmakt` | Revoke a fullmakt — withdraw an agent's delegated authority for a Norwegian company and retire the agent principal. |
| `get_pricing` | Call this BEFORE metered work to check per-call cost and whether billing enforcement is live. |
| `get_credit_balance` | Call this BEFORE a batch of metered calls to confirm the calling key's prepaid credit balance covers it, and AFTER a 402 INSUFFICIENT_CREDITS + human top-up to verify the funds landed before retrying. |
| `redeem_issuance_token` | Call this to convert an owner-issued key-issuance token into your own API key — the headless onboarding step for an agent that holds no credential yet. |

## Quickstart

### Hosted endpoint (streamable HTTP)

The fastest path — no install. Point any streamable-HTTP-capable MCP client at:

```text
https://www.apier.no/api/mcp
```

Discovery is **keyless**: `initialize`, `tools/list`, resources and prompts all work without credentials, so an agent can explore the full catalogue before authenticating. An API key (`Authorization: Bearer apier_live_…`) is needed only for protected tool calls. Get a key at https://www.apier.no/dashboard/keys.

### npx stdio proxy (`@apier-no/mcp`)

For stdio-only clients, this package wraps [`mcp-remote`](https://github.com/geelen/mcp-remote), reads `APIER_API_KEY` from your environment, removes it from the spawned child's environment, redacts it from stderr, and forwards it as an `Authorization: Bearer` header argument on the child's command line (visible to local process inspection on multi-user systems — see [SECURITY.md](./SECURITY.md)).

**Published as `@apier-no/mcp`.** The `@apier` scope was unavailable, so this package ships under the `@apier-no` scope.

**Claude Desktop / Cursor** (`claude_desktop_config.json` / `~/.cursor/mcp.json`):

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

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "apier": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@apier-no/mcp"],
      "env": { "APIER_API_KEY": "apier_live_<your_key_here>" }
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
      "env": { "APIER_API_KEY": "apier_live_<your_key_here>" }
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

- `APIER_API_KEY` is read by the parent process and **scrubbed from the spawned child's environment**, and stderr is passed through a redactor that strips `Bearer …`, `apier_(live|test)_…`, `ghp_…`, and `Authorization:` substrings. The key is still forwarded to the child as an `Authorization: Bearer` `--header` argument, which local process inspection (`ps aux`, `/proc/<pid>/cmdline`) can reveal on multi-user systems — see [SECURITY.md](./SECURITY.md).
- Non-https endpoints are rejected before spawn; `mcp-remote` is exact-pinned and releases are published with npm provenance via GitHub Actions Trusted Publishing (OIDC).
- Treat client config files (`claude_desktop_config.json`, `.cursor/mcp.json`, …) like `.env` files — never commit them with a real key.

Full threat model and disclosure policy: [SECURITY.md](./SECURITY.md).

## Documentation

- MCP server docs: https://www.apier.no/docs/mcp
- Apier platform docs: https://apier.no/docs

## License

MIT
