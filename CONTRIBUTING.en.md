# Contributing

[简体中文](CONTRIBUTING.md) | English

Development uses Node.js 24+, Python 3.12/3.13 and DeepSeek Harness `0.2.1-rc.5`; use PowerShell 7 on Windows. See [development](docs/en/development.md) for setup and checks by change type, [testing](docs/en/testing.md) for command purposes, isolation and CI, and [architecture boundaries](docs/en/architecture-boundaries.md) for dependencies.

## Bilingual maintenance

- Chinese documents keep their existing paths. Root and package English documents use `.en.md`; detailed English pages live in `docs/en/`, with matching filenames and ADR numbers.
- Keep the top `简体中文 | English` links and prefer same-language navigation. Update behavior, commands, configuration, versions and limits in both languages together.
- UI, system messages and diagnostics use semantic keys and parameters with matching translations and placeholders. Do not translate names, user content or original third-party diagnostics automatically.
- Built-in skills and model operation instructions have one English runtime copy. `npm run check:docs` checks pairs and links; `npm run check:contracts` checks command consistency. Review translation meaning separately.

## Changes and review

- Create a short-lived branch from current `main`, describe the actual change in commits, and keep each PR focused.
- Explain behavior, compatibility or dependency effects, and checks actually run. State why native integration or external acceptance was omitted; fixtures do not establish real platform or model results.
- Use `npm run release:pack` for release archives. It includes the source gate and archive checks, so there is no need to run the same release gate immediately beforehand.
- Do not push, publish or send platform messages without explicit authorization.

## Dependencies and data

- Use the public npm registry in the lockfile. Harness/Cordis changes need compatibility evidence; do not upgrade dependencies to bypass failures or run `npm audit fix --force` directly.
- Explain each new dependency's purpose, source, license and environment validation. Python changes also update requirement ranges, CI test versions and [third-party notices](THIRD_PARTY_NOTICES.en.md). Resolve unknown provenance or licenses before merging.
- Harness credentials owns secrets; image keys use controlled environment injection. Keep runtime data, endpoints, user IDs, signed URLs, databases, logs, weights, external service projects and local profiles out of commits and packages.
- Put temporary files and test artifacts under the project's `.codex/` or designated temporary directory, then clean them up. Do not commit caches, virtual environments, archives or intermediate build output.
