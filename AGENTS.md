# Repository guidance

- Use PowerShell 7 and `rg` on Windows.
- Keep implementation in `src/`, media workers in `python/`, shared image operations in `skills/image-generation/`, and tests in `tests/`.
- Bot configurations are personas. Switching a persona preserves session history and applies from the next turn; freeze in-flight configuration and recheck revoked permissions at execution time.
- Channel identity owns sessions, attachments, memories and outputs. Do not trust model-supplied identity or paths.
- Keep runtime data, credentials, endpoints and user IDs out of release files. Credentials belong to the Harness credentials service; image keys come from environment variables.
- Before packaging run `npm run typecheck`, `npm test`, Python tests, `npm run build` and `npm run check:release`.
- Do not push, publish or send platform messages unless the user explicitly authorizes it.
- Do not add project archives or checked-in temporary artifacts.
