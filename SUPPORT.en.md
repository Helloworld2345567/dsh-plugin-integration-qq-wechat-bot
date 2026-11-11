# Getting Support

[简体中文](SUPPORT.md) | English

Start with the plugin version (currently `0.2.10`), Node/Python/FFmpeg versions, installation mode and checks already run. Remove credentials, user and group IDs, local paths, signed URLs, message contents and unsanitized logs first.

## Usage questions

For installation, configuration, personas, skills, media limits and Harness profiles, read the [README](README.en.md), [getting started](docs/en/getting-started.md), [configuration reference](docs/en/configuration.md) and [troubleshooting guide](docs/en/troubleshooting.md). If the issue remains, open a Discussion or Issue with minimal reproduction steps.

## Bugs

For incorrect code behavior, use the Bug Issue template to describe expected behavior, actual behavior, reproduction steps, environment and test evidence. Do not upload databases, runtime directories, complete logs, attachments or model weights. Provide only sanitized error categories and necessary excerpts.

## Security vulnerabilities

Do not report vulnerabilities publicly. Follow the private reporting process in [SECURITY.en.md](SECURITY.en.md), and exclude credentials, platform tokens, user IDs, local paths and signed download links.

## QQ/WeChat platform issues

Login, authorization, event permissions, message formats, rate limits and platform availability are controlled by QQ or WeChat. Without exposing tokens or user data, describe the platform, event type, time range, sanitized error category and platform-side status. These issues cannot always be fixed by this plugin.

## External TTS, Music and RVC services

Edge TTS, Music, RVC, GPT-SoVITS, CUDA, models and external services are optional or separately deployed by the operator. Provide the service profile's sanitized status, whether a capability is `missing` or `blocked`, interpreter versions and a reproducible service error. Do not upload external service credentials or model files to repository Issues.
