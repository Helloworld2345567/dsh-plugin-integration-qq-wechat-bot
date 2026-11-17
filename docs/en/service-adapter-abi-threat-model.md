# Third-party Service Adapter boundaries

[简体中文](../service-adapter-abi-threat-model.md) | English

**Third-party Service Adapter ABI is not implemented or available.** The internal TypeScript `ServiceAdapter` interface serves built-in implementations, not a stable ABI for third-party packages. This page records why the proposal stopped; it does not describe deployed isolation capabilities.

## Current boundary

The host owns identity, permissions, Profile revisions, credentials, input resolution, job directories, cancellation, Asset registration, acceptance and delivery. Built-in adapters receive current-job data through controlled ports. Personas, skills, workspaces and model responses cannot discover or load third-party executable code.

The Windows process port uses `taskkill /T /F` for process-tree cleanup, a reduced environment and bounded stdout. This supports trusted-worker process management but does not isolate malicious adapters: processes retain the host user's privileges, cwd does not restrict file access, and there is no restricted token, non-breakaway Job Object or network sandbox. Local process termination also cannot prove a remote request stopped.

## Requirements before reassessment

Any future third-party support needs a separate design and evidence for:

- Explicit artifact installation, registration, trust and revocation, rejecting incompatible versions, capabilities or dependencies.
- Process, filesystem, inherited-handle and network isolation on supported platforms; an ordinary launcher or operator assertion is not isolation evidence.
- Bounded protocol input/output, minimal per-job credentials and sanitized diagnostics, with host-owned path/output validation.
- Process-tree termination on cancellation, timeout and host exit; unknown state fences the service and recovery queries the original job instead of resubmitting inference.
- Repeatable isolation, revocation, restart-recovery and packaging tests that exclude fixtures, private keys, credentials and test adapters from release packages.

A candidate protocol may be reviewed as an explicit draft. Until these requirements are met, do not export a stable ABI, automatically trust npm packages or introduce workspace-driven dynamic imports. Schema, permission, delivery or lifecycle changes need a separate ADR and migration/rollback design.

The supported extension path remains reviewed built-in implementations under [architecture boundaries](architecture-boundaries.md#extension-steps).
