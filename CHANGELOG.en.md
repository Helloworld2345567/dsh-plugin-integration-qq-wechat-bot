# Changelog

[简体中文](CHANGELOG.md) | English

This document records verifiable changes for users and maintainers. A third-party Adapter ABI or acceptance of external services must not be assumed complete.

## [Unreleased]

- Add the English management UI, plugin metadata and formal documentation, retaining Chinese entry points and reciprocal language navigation.
- Add project-wide `messageLocale`, independent of UI language. System messages use the language captured when an operation starts; running tasks and older data remain compatible.
- New persona templates follow UI language. Built-in personas on fresh installations follow the user's conversation language; existing personas are not rewritten.
- Standardize built-in skills and model operation instructions in English; add localizable structured diagnostics, bilingual maintenance rules and resource coverage checks.

## [0.2.10] - 2026-11-03

### Phase 0: Release hardening (completed)

- Strengthen build, package content, sensitive information, path and archive boundaries.
- Retain Harness native tests, lifecycle tests and standalone installation smoke tests as pre-release evidence.

### Phase 1: Plugin metadata and theme contract (completed)

- Align plugin metadata, Chinese locale, icons and theme contracts.
- Keep the project Chinese-only in this release; English locale/UI is outside that release's scope.

### Phase 2: Open-source governance and dependency security (completed)

- Add contribution, security, conduct, support and changelog documents, Issue/PR templates and Dependabot configuration.
- Normalize lockfile `resolved` sources to the public npm registry and update `ws` to security patch `8.22.1`; do not upgrade DeepSeek Harness, Cordis or other Harness core packages.
- Add dependency audits, license/source checks, Markdown/CI configuration checks and actual temporary archive validation.
- Define Python 3.12/3.13, base media and optional voice-generation dependency boundaries, and record Harness transitive dependencies whose security remediation must currently be deferred.
- Improve third-party notices: do not guess upstream commits/tags that cannot be verified from the checkout; document AGPL/PolyForm projects separately when they are references or optional external integrations.

### Phase 3: Installation, configuration and operations contract

- Add a unified getting-started guide, an actual environment-variable reference, a safe `.env.example` and structured troubleshooting.
- Define responsibility boundaries for installation, stopping, upgrading, rollback and removal in existing Harness profiles and standalone product profiles.
- Correct the image-generation skill to the V4-only persona contract; do not promise V3 migration or rollback.
- Expand lifecycle bundle documentation covering supervised recovery, one rollback, no replay of uncertain outcomes and no third-party Adapter ABI commitment.
- Strengthen checks for Markdown local links/anchors, CI structure, packaged documentation and sensitive contents.

### Phase 4: Development and testing contract

- Add Windows development entry points, test layers, a CI mapping and external acceptance boundaries.
- Add read-only environment preflight checks for Node/Harness/Python, FFmpeg/ffprobe, and base/optional Python dependencies.
- Change TypeScript, Python and the three Harness native acceptance runners to minimal environment allowlists, isolated HOME/temp directories, dynamic ports, controlled output and process-tree cleanup.
- Add checks for documented commands, CI versions, test variables, release gates and runner isolation; QQ/WeChat business behavior, permissions, media, credentials, personas and lifecycle runtime semantics remain unchanged.
