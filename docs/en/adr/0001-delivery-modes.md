# ADR 0001: Separate Existing-Harness Installation and Standalone Product Profiles

[简体中文](../../adr/0001-delivery-modes.md) | English

- Status: Accepted
- Date: 2026-11-03

## Context

The project can join an existing profile as an ordinary Harness bundle, or deploy an isolated bot product profile using its installer, workspaces and coordinator. Previously both flows shared one installation chapter, obscuring what each changed and which lifecycle capabilities it supplied.

## Decision

Retain both delivery modes with separate documentation/responsibilities:

1. **Existing Harness** installs only the main bundle through `dsh plugin --profile <profile> add <package>`, without manually rewriting the profile or automatically adding a coordinator.
2. **Standalone product** uses `scripts/install.mjs` to manage an isolated `bots` profile, product data, workspaces, main bundle and `dsh-bot-lifecycle`.
3. The main package retains built-in `bot-unified-chat`; the duplicate `packages/bot-unified-chat` bundle is no longer published.
4. Documentation/UI support Chinese and English, with shared language resources/rules in both modes.

## Consequences

Ordinary users get a minimally invasive installation; product operators retain supervised startup, upgrades and rollback. Both share main-plugin code/archives, while their documentation explicitly distinguishes lifecycle capabilities.
