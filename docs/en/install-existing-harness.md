# Install into an Existing DeepSeek Harness

[简体中文](../install-existing-harness.md) | English

This mode adds only the main plugin to an existing profile, without the standalone lifecycle coordinator. See [Getting started](getting-started.md) for prerequisites and initial setup. Choose [standalone deployment](deploy-product-profile.md) for supervised startup and managed upgrades.

## Install from source

Stop Harness using the target profile, then run these commands from the project root. Replace `my-profile` with the existing profile name:

```powershell
$profileName = 'my-profile'
npm ci
python -m pip install -r requirements.txt
npm run verify:release
dsh plugin --profile $profileName add .
dsh --profile $profileName --no-open
```

`verify:release` already includes the build. Install through the Harness plugin command; do not manually edit the profile's `package.json` or copy `cordis.patch.yml`.

Media workers use `python` by default. For another interpreter, set `BOT_PYTHON` before starting Harness and install dependencies with that Python 3.12/3.13 interpreter. For Edge TTS, also install into the same environment:

```powershell
python -m pip install -r requirements-voice-generation.txt
```

Confirm **Bot panel** appears in Harness settings, then follow [first setup and verification](getting-started.md) to create a persona, authorize a channel and test text. If the panel is absent, check that the target profile loads `dsh-plugin-integration-qq-wechat-bot` and Harness is `0.2.1-rc.5`.

## Update, rollback and removal

Use the existing profile's maintenance procedure to stop its process, back up data and replace the main package. Verify source releases with `npm run verify:release`; keep the previous trusted source or archive for offline recovery. This mode does not provide project-managed hot upgrades, supervised restarts or automatic rollback, and does not support undeclared version combinations.

Remove the plugin through that Harness version's Plugin Manager/settings action; do not manually delete dependencies or profile files. Plugin removal and runtime-data deletion are separate operations. Back up personas, sessions, attachments and credentials you need to retain first.

Deploy GPT-SoVITS, Music, RVC, CUDA and model weights separately. See [Configuration](configuration.md) for variables/paths and [Troubleshooting](troubleshooting.md) for failures.
