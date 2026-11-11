# Standalone Product Lifecycle Coordinator

[简体中文](README.md) | English

`dsh-bot-lifecycle` is a Harness bundle for the standalone product profile. The product installer installs it alongside the main plugin, and `scripts/start.mjs` supervises it. It is not an internal main-plugin service, a third-party runtime or an external Adapter platform.

## Source and build

Buildable source lives in this package's `src/`: coordinator, integrity, protocol, bundle entry and neutral contracts stay within the package boundary and do not import root-package `src/`. The package `source` is `./src/index.ts`. `npm run build` generates `dist/index.js`, a serializable compatibility export and `dist/lifecycle-build.json`. `npm run verify:build` / prepack compares source digests, the file list, package version, contract and output hashes; stale dist files cannot be silently packaged.

`src/contract/` is the single source for the protocol, artifact identity, journal and source integrity shared by the main plugin and coordinator. Do not duplicate version ranges, hashes or identity algorithms that can drift apart.

## Version compatibility protocol

The main plugin declares its runtime protocol, accepted coordinator API range, capabilities and required coordinator capabilities. The coordinator declares its API, accepted runtime protocol/main package ranges, capabilities and required main capabilities. Bundle package versions are independent of these protocol/API versions.

The runtime handshake also binds the instance nonce and both artifact identities. Missing or forged metadata and mismatches in protocol major, package range, required capability, instance, hash, version or identity fail closed with stable `LIFECYCLE_*` errors. Internal TypeScript interfaces are not the public protocol; only explicitly declared and tested combinations are supported.

## Hot upgrades and offline paired upgrades

- When the current coordinator and candidate main package both declare compatibility, the coordinator may drain the runtime and replace only the main package.
- Changes to coordinator API, protocol major, package range or required capability cannot hot-replace the old coordinator itself. Use `stop → install → start`; the supervisor launcher installs both bundles while stopped.
- Before changing a profile, the installer validates both archives, hashes, versions and contracts. The launcher then checks installation records against actual files.
- The paired installation journal records archive hashes, identities, package versions and contracts for current/previous artifacts. An interrupted installation restores the previous main package once, then the previous coordinator. Stop if either previous hash differs.

`installation.json` retains its original schema; `lifecycle-installation.json` records the paired current/previous combinations. An older installation without this file is not silently migrated: stop it and rerun the trusted installer.

## Data and failure semantics

Draining, unknown outcomes, no automatic replay, one rollback, supervised restart, cancellation and service fences retain their semantics. Upgrades and rollbacks preserve personas, sessions, attachments, credential references and workspace data. They do not resend messages already accepted by an external platform whose local status is unknown. The coordinator neither imports QQ/WeChat messaging nor sends platform messages.

An ordinary existing Harness profile installs only the main plugin, without this coordinator or a managed-upgrade commitment. See [standalone deployment](../../docs/en/deploy-product-profile.md), [ADR 0003](../../docs/en/adr/0003-lifecycle-and-uncertain-outcomes.md) and [ADR 0004](../../docs/en/adr/0004-lifecycle-bundle-compatibility.md).
