# ADR 0002: Load Only Trusted Adapters and Freeze Profile Revisions

[简体中文](../../adr/0002-trusted-adapters-and-profiles.md) | English

- Status: Accepted
- Date: 2026-11-03

## Context

Media adapters can access local processes, model resources and endpoints. Dynamically loading code from persona directories, workspaces or chat would bypass channel identity, job directory, permission, quota and output-validation boundaries.

## Decision

1. Load only reviewed built-in Service Adapters compiled with the main package.
2. Personas store business choices and `profileRef`; endpoints, paths, weights and credentials belong to private Profiles.
3. Immutable Profile revisions/content hashes are frozen at turn/job start. Grants/configuration apply next turn; revocation/disabling immediately blocks further execution/delivery.
4. Adapter output must return to the host-assigned job directory and pass host validation before Asset registration.
5. Health means detectable now. Actual TTS/RVC/full-download acceptance uses records bound to persona and Profile revisions.

## Consequences

Third-party Adapters do not yet have a stable runtime ABI. Opening one requires a separate signing, provenance, revocation, subprocess-isolation and compatibility policy. Internal TypeScript interfaces are not a public commitment.
