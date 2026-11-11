# Security Policy

[简体中文](SECURITY.md) | English

## Supported versions

Only the latest `0.2.x` release (currently `0.2.10`) and maintained security fixes on `main` are supported. Earlier releases, unpublished local modifications and incompatible Harness runtimes are outside this scope. The plugin currently requires DeepSeek Harness `0.2.1-rc.5`; this does not imply that all of its upstream transitive dependencies can be upgraded independently.

## Reporting a vulnerability

Use GitHub private vulnerability reporting:

<https://github.com/Helloworld2345567/dsh-plugin-integration-qq-wechat-bot/security/advisories/new>

If that entry is unavailable, contact a maintainer privately on GitHub to request a reporting channel. Do not paste vulnerability details into public Issues, PRs, discussions or platform group chats. Include affected versions, minimal reproduction steps, impact and suggested remediation, with real data removed wherever possible.

Maintainers will acknowledge the report, assess severity and affected scope, and update an advisory when a fix or mitigation can be made public. Do not disclose an uncoordinated vulnerability before the fix is released.

## Information to exclude

Do not publicly disclose any of the following in security reports or ordinary Issues:

- API keys, cookies, passwords, Harness credentials, QQ/WeChat tokens or other credentials.
- QQ account numbers, WeChat user IDs, group IDs, message contents or real attachments.
- Platform tokens, download signatures, URLs containing authorization parameters or absolute local paths.
- Unsanitized logs, databases, session files, model weights or runtime archives.

Channel credentials must use the Harness credentials service. Do not put them in personas, repository files, command-line arguments or release packages.

## Supply chain and archive boundaries

- npm installation is constrained by `package-lock.json` and integrity checks from the public npm registry. Pinned Harness dependencies and deferred transitive dependency findings are documented in the [dependency audit](docs/en/dependency-audit.md).
- Do not use `npm audit fix` or `npm audit fix --force` as automatic remediation. Before upgrading Harness, Cordis or other core packages, establish compatibility with the current runtime and complete native tests.
- Base Python dependencies and optional voice-generation dependencies are separate. External Music, RVC, GPT-SoVITS, CUDA, model weights and services are outside the main package supply chain.
- Release packages pass `npm run check:release` and actual temporary archive validation. Archives must not include runtime data, credentials, databases, logs, model weights, `.codex`, `.runtime`, `node_modules` or temporary `.tgz` files.
- See [third-party notices](THIRD_PARTY_NOTICES.en.md) for attribution and source boundaries.
