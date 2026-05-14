# Changelog

All notable changes to `@apier-no/mcp` are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
