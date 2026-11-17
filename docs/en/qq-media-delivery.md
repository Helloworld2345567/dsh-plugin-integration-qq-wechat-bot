# QQ media delivery

[简体中文](../qq-media-delivery.md) | English

QQ private and group chats use the same plugin size limits, with official multipart uploads for large files. Generation or download success means a file is available; only a platform receipt confirms delivery.

## Select final attachments

Media tools register outputs for delivery at the end of the turn. Use `deliver=false` for intermediate material. Successful local conversion sends only the result by default; use `keepInputs=true` when the user also wants originals. Failed conversion retains the original registration and never deletes the source file.

`bot_send_file(path=final-file, mime=actual-type)` replaces the turn's sole automatic attachment of the same kind, avoiding duplicate original/compressed versions. It does not infer correspondence among multiple matching attachments. `append=true` explicitly adds a version; registering the same file reuses its attachment. Use `bot_send_file(assetId=result-id, asFile=true)` for original images or exact-format files. This option also applies to WeChat.

QQ audio is normally prepared as 24 kHz mono SILK voice bubbles. Audio over 300 seconds is split completely into independently queued segments, with a full MP3 sent as well; the original is retained. Explicit file requests, failed voice preparation or upload error `40093013` can use ordinary-file delivery.

## Size and upload

| Type | QQ documented soft limit | Plugin hard delivery limit |
| --- | --- | --- |
| Image | 20 MB | 200 MiB |
| Video | 30 MB | 200 MiB |
| Audio | 20 MB | 200 MiB |
| Ordinary file | 200 MB | 200 MiB |

The hard limit is `200 * 1024 * 1024` bytes, checked against both registered and actual file sizes. QQ decides whether to downgrade media above soft limits to files; the plugin does not reject it early. Ordinary files use `file_type=4`.

Files up to **5,000,000 bytes** use Base64 `file_data`. Larger files use `upload_prepare`, part PUTs, `upload_part_finish` and final `files` assembly without requiring a public file URL. Presigned PUTs do not carry bot authorization headers. Message submission follows receipt of `file_info`.

An attachment delivery can take up to 15 minutes, with 60-second upload-request timeouts; text retains a 90-second timeout. Stopping a task or bot still cancels uploads immediately. See [qq-upload.ts](../../src/channels/qq-upload.ts) for the protocol implementation.

The 100 MiB local audio-input budget and [Music's](music-integration.md) complete-MP3 policy below 20,000,000 bytes are independent of QQ limits. WeChat has its own channel limits.

## States and recovery

| State | Meaning and handling |
| --- | --- |
| `registered` / queued | Awaiting delivery with `platformSent=false`; not yet received |
| Platform-confirmed | Message submission returned a platform receipt |
| `failed` | Preparation or upload explicitly failed; act on the recorded error |
| `unknown` | Connection interrupted after submission, with acceptance uncertain; do not blindly resend |

Recovery reuses the original attachment and valid cached `file_info`. `ttl=0` means indefinite validity; expired or missing expiry information triggers another upload without generating, converting or downloading again. Incomplete multipart uploads may start a new upload job. Delivery records retain sanitized status, business error codes and trace identifiers for panel diagnostics.

Local tests do not send QQ messages. Real platform acceptance requires actual delivery and receipt verification; see [testing](testing.md) for development coverage.

## Official API references

- [Private-chat media upload](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_files.post.html)
- [Private-chat upload preparation](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_prepare.post.html) and [part completion](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_part_finish.post.html)
- [Group media upload](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_files.post.html)
- [Group upload preparation](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_prepare.post.html) and [part completion](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_part_finish.post.html)
