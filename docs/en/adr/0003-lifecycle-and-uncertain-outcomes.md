# ADR 0003: Independent Lifecycle and No Automatic Replay of Unknown Outcomes

[简体中文](../../adr/0003-lifecycle-and-uncertain-outcomes.md) | English

- Status: Accepted
- Date: 2026-11-03

## Context

The main bot bundle is the upgrade target and cannot reliably uninstall/replace itself. Network submission, remote inference and cancellation can have unconfirmed outcomes; automatic replay could duplicate inference or delivery.

## Decision

1. Standalone profiles use separate `dsh-bot-lifecycle` for draining, installation, supervised restart and one rollback, independent of the mutable `botIntegration` service.
2. Upgrades accept only archive/hash-validated artifacts. Rollback uses only a previous archive whose hash still matches.
3. Unconfirmed delivery/remote-job results after submission become `unknown`, without automatic retry, inference or delivery replay.
4. If remote cancellation cannot confirm stopping, keep the service fence and do not release the instance before confirming idle.
5. Explicit user recovery reuses the original job/Asset identity rather than silently regenerating content.

## Consequences

Recovery prioritizes avoiding duplicate execution. Existing-Harness installation has no separate coordinator and no managed-upgrade/automatic-rollback promise. [ADR 0004](0004-lifecycle-bundle-compatibility.md) defines versions, handshake, hot replacement and offline paired upgrades without changing unknown outcomes, no replay, one rollback or service fences.
