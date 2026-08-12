# Changelog

All notable changes to `@apier-no/mcp` are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-08-12

### Added
- README "Try without a key" section: live-verified examples for the keyless sandbox mirror under `/api/v1/sandbox/` on apier.no, plus the `apier_test_` vs `apier_sandbox_test_` prefix disambiguation. Closes audit finding P13 (OPERATION-SANDBOX-RAINY-DAY §7).
- One keyless-sandbox sentence in the npm `package.json` description, so the sandbox is visible on npm at the next release. `APIER_API_KEY` stays `isRequired: true` — production tools still require a key.
- `.coderabbit.yaml` (template from apier-quickstart, pruned to this repo's CI: auto-reviews OFF, profile chill, scanner tools disabled).

### Changed
- CI's `build` job gained an offline `.registry/server.json` assertion: the manifest must parse, its description must stay within the schema's 100-character limit, and every `version` field in it must equal `package.json`'s. No network fetch, so CI never depends on registry availability.
- README: a non-rendering comment above the keyless-sandbox `verify` example records why the example bearer's suffix is `$RANDOM`. The token prefix alone is 19 characters — one short of the tarball-audit secret-blocklist threshold — so substituting a literal suffix would fail CI.

### Fixed
- `.registry/server.json` description shortened from 261 to 85 characters. The `2025-12-11` server schema that the file itself declares caps `ServerDetail.description` at 100 characters, so the longer text would have been rejected on submission to the MCP registry; nothing in this repo publishes the manifest, so the rejection would only have surfaced at submission time. The keyless-sandbox sentence was dropped from this manifest rather than relocated — the schema defines no long-form prose field to carry it — and `package.json`'s unconstrained description still carries it, so npm search visibility is unaffected.

## [1.2.0] - 2026-08-11

### Security
- **`APIER_API_KEY` no longer appears in the spawned child's command line** ([#33](https://github.com/PowerLaunch/apier-mcp/issues/33)). The `--header` argv element previously interpolated the live key as `Authorization: Bearer <key>`, which any local user could read from `/proc/<pid>/cmdline` (world-readable on Linux) or `ps aux`. It now carries only the literal placeholder `Authorization:${APIER_MCP_AUTH_HEADER}`, and the bearer value is handed to `mcp-remote` in the `APIER_MCP_AUTH_HEADER` environment variable, which it expands into the request header. Process environments are readable only by the owner and root, so the key is no longer exposed to other local users.
- `mcp-remote` logs its custom headers *before* expanding the placeholder, so its `Using custom headers: …` diagnostic now prints `${APIER_MCP_AUTH_HEADER}` instead of the live key.
- The key no longer feeds `mcp-remote`'s `getServerUrlHash()`, so it is not part of the md5 that names files under `~/.mcp-auth`.

### Changed
- The API key is trimmed before becoming a header value, so stray surrounding whitespace — a trailing space pasted into `claude_desktop_config.json`, or a newline from a `.env` loader that does not strip one — no longer produces an opaque invalid-header failure.
- `~/.mcp-auth` session directories for a given endpoint are now shared across different API keys rather than one per key, because the URL hash sees the placeholder rather than the key. No practical effect: this proxy authenticates with a static bearer token and does not use `mcp-remote`'s OAuth token store.

### Added
- Tests pinning that no element of the spawn argv contains the key, that the bearer value reaches the child via `APIER_MCP_AUTH_HEADER`, that a caller-supplied `APIER_MCP_AUTH_HEADER` cannot be spoofed through the parent env, and contract tests for `mcp-remote`'s `--header` parse regex and `${VAR}` substitution.

### Compatibility
- No change to the public configuration surface. Existing `npx -y @apier-no/mcp` client configs keep working unchanged.

### Fixed
- Key-provisioning link corrected everywhere it appears (README, CLI help and error text, registry draft): `https://www.apier.no/dashboard/keys` returned HTTP 404; links now point at `https://www.apier.no/docs/authentication` (with the dashboard at `https://www.apier.no/dashboard` as the follow-up step in the README). Closes audit finding AUDIT-MCP-RAINYDAY-01 P2.

## [0.1.1] - 2026-05-14

### Added
- `SECURITY.md` with responsible-disclosure contact for security@apier.no.
- Pre-publish tarball-surface secret-leak grep in CI and release workflows.
- Dependabot configuration for npm and GitHub Actions dependencies.

### Security
- `release.yml` now verifies the git tag matches `package.json#version` before publishing — prevents stray tags from minting phantom releases.
- `release.yml` now gated to `github.repository == 'PowerLaunch/apier-mcp'` — forks cannot accidentally publish under the `@apier-no` scope.
- Both `ci.yml` and `release.yml` extract `npm pack` output and scan the tarball surface for token-shaped strings before publish. Any match fails the workflow.

## [0.1.0] - 2026-05-13

### Added
- Initial release: thin MCP server proxy bridging local stdio MCP clients (Claude Desktop, Cursor) to the hosted MCP server at https://www.apier.no/api/mcp.
- HTTPS-only endpoint enforcement.
- Token canary test pinning that `APIER_API_KEY` never appears in stderr.
- SLSA v1 build provenance attestation on published artifact.
