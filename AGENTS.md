# Repository guidance

- This is an independent DeepSeek Harness plugin, not an AstrBot plugin. Harness owns the agent loop, conversation history, compression, model requests and general command execution.
- On Windows use PowerShell 7 and rg. Put worktrees and temporary project copies under this repository's .codex/.
- Implementation belongs in src/, fixed media operations in python/, shared image client in skills/image-generation/. Do not create a divergent image client.
- Bot configurations are personas. Hot switching preserves session history and takes effect at the next turn. Freeze in-flight turn configuration; revoked permissions must be checked at execution time.
- Channel identity owns sessions, attachments, memories and outputs. Never trust model-supplied identity or host paths.
- Keep runtime data, personal endpoints, credentials and user IDs outside release files. Credentials belong to Harness credentials service; image keys come from environment variables.
- Build, typecheck, npm test, Python tests and check:release before packaging. Local simulation, live provider calls and real QQ/WeChat evidence are distinct.
- Do not push or publish without user authorization. Do not send platform messages outside an explicitly authorized verification run.
