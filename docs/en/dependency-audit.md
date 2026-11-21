# Dependency audits and upgrades

[简体中文](../cn/dependency-audit.md) | English

This page describes dependency sources, audit entry points and known deferrals. Vulnerability counts change with advisories and the lockfile; use the current report. A historical passing check does not establish that the current installation has no vulnerabilities.

## Installation sources

- Node uses lockfile v3 and `npm ci`. Committed `resolved` URLs point to `https://registry.npmjs.org/` and retain integrity values. Restricted networks can explicitly override the registry or use an organizational cache without committing private mirror URLs.
- [Python dependencies](python-dependencies.md) defines user ranges, CI snapshots, optional dependencies and external-service boundaries. Audit tools belong only in a temporary environment, outside runtime packages.
- See [third-party notices](THIRD_PARTY_NOTICES.md) for license inventories and redistribution obligations.

## Audit commands and interpretation

```powershell
npm run audit:dependencies
npm ls --all
```

`audit:dependencies` reports actual vulnerability counts and known deferrals. It rejects unknown package names, direct business-dependency vulnerabilities, non-public registry sources and missing license metadata. It **does not independently block changes in total counts or severity**; maintainers must still review new advisories and severity levels.

Use `npm outdated` when investigating upgrade scope, rather than immediately running `npm audit fix --force`. Direct dependencies can be fixed within compatible ranges. Harness upgrades require plugin/peer compatibility validation; forced overrides must not merely reduce audit counts.

Install CI dependencies and audit tools in a temporary Python environment under the project's `.codex/`, run the following, then remove that environment:

```powershell
python -m pip install -r requirements-ci.txt -r requirements-voice-generation-ci.txt -r requirements-audit-ci.txt
python -m pip check
pip-audit -r requirements.txt -r requirements-voice-generation.txt
pip-licenses --from=mixed --format=table
```

`pip check` detects installed dependency conflicts. For audit findings, check fixed versions and compatibility. Compare license results with upstream declarations. Before running these commands, confirm that `python` and the audit tools belong to the temporary environment.

## Known Harness deferrals

The 2026-11-03 audit recorded these deferred families. The current script still recognizes these package names; use a fresh report to determine whether findings remain:

| Scope | Reason |
| --- | --- |
| `@deepseek-ai/dsh*` and `@deepseek-ai/libreoffice-kit` | The plugin binds Harness `0.2.1-rc.5`; changes require a compatible version and native acceptance |
| `undici`, nested `zod`, `@modelcontextprotocol/client`, `fflate`, `picomatch` | Introduced by Harness's dependency tree and handled with compatible upstream releases |

This is not a zero-vulnerability claim. Vulnerabilities in top-level direct business dependencies still fail, and new risks under a known package name still require review. The package-name set is maintained in `scripts/audit-dependencies.mjs`.

## Change requirements

Upgrades must state their reason, source and license, retain lockfile integrity and pass relevant tests/release gates from the [development guide](development.md). Supported versions are Node 24, Python 3.12/3.13 and the current Harness contract.

Optional `edge-tts` carries LGPLv3 obligations. `pypdfium2` also involves PDFium and its third-party licenses, beyond the Python wrapper. Model weights and media sources have separate licenses that the main package license does not cover.
