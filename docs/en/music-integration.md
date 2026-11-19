# Music search and download

[简体中文](../music-integration.md) | English

The plugin calls a separately deployed Music project through the `musicdl_json_v1` subprocess protocol. Operators manage that project and its Python environment; the bot owns permissions, session candidates, attachments and delivery.

## Configure and use

1. Under **Services → Music download service**, choose the Music project directory, set the source order and save. `BOT_MUSIC_HOME` can provide an initial directory. A saved setting takes precedence, and an empty directory shows as unconfigured. Supported sources are `MiguMusicClient`, `KuwoMusicClient`, `QQMusicClient` and `NeteaseMusicClient`, with Migu and Kuwo enabled by default.
2. Enable **Bots → Media → Music search and download** and select the Profile. This also enables `bot_music` and `music-download`. Bot settings retain only the Profile reference, enabled state and lyrics preference; lyrics are off by default.
3. Download the best match by song/artist, or search and select a candidate. Candidates and original tracks belong to the current channel session; resetting the session invalidates old candidates.

The host selects the interpreter from the saved project directory and controls output paths and media URLs. When a source needs authorization, the host injects `MUSIC_QQ_COOKIES` or `MUSIC_NETEASE_COOKIES` into the subprocess as cookie JSON or a semicolon-separated string. Proxy configuration uses `MUSIC_HTTP_PROXY`. Harness manages the credentials and provides them to the controlled subprocess at execution time.

## Conversion and delivery

`bot_sing action=sing` accepts `song/artist` or a selected `candidateSet/candidate`. An existing original track in the current session is reused. A conversion-only request does not also send the original song. Library tracks count as mixed audio and require an available RVC Profile with separation configured; see [RVC voice conversion](singing-conversion.md).

Downloads and named-song conversions produce complete MP3 files strictly below **20,000,000 bytes**. Compliant MP3s are reused; other sources are encoded in full from the original. Encoding starts at 192 kbps and selects 160/128/96/64 kbps as duration requires. If the complete song still cannot fit, the operation fails without truncating it. This policy is independent of [QQ's platform limit](qq-media-delivery.md).

Validated files become attachments and job temporary directories are cleaned. Download completion, attachment registration and platform delivery are separate states. Delivery recovery reuses the existing attachment without searching, downloading or converting again. Disabling the capability or revoking permissions prevents subsequent execution and delivery.

## Checks and limitations

**Check health** verifies only the environment and protocol. Acceptance requires a real search and full download, duration/decode checks, any required lyrics and delivery on the target platform. Records bind persona and Profile revisions and must be renewed after changes.

Sources may disappear, require login or return previews; successful search does not guarantee a complete download. Validate new sources with a full download first. Music download supplies neither RVC/separation models nor music generation. Local input budgets and explicit-upload conversion limits are documented under [RVC voice conversion](singing-conversion.md).
