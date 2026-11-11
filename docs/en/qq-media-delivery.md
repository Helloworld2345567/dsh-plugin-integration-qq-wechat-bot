# QQ Media Delivery

[简体中文](../qq-media-delivery.md) | English

Total QQ media limits and the `file_data` direct-upload threshold are independent. The plugin applies the same hard limits to private/group chats, using official multipart upload for large files.

## Final attachments and formats

Media tools register attachments for delivery at turn end. Use `deliver=false` for intermediate downloads/generated material. Successful local conversion normally removes registered input attachments from the current turn and sends only results. Use `keepInputs=true` when the user explicitly requests both. Failure retains prior registration; original files are not deleted.

Register only the requested GIF/video/PNG format. After trusted-private-chat shell compression/transcoding, `bot_send_file(path=final-file, mime=actual-type)` replaces the turn's single same-kind automatic attachment to avoid duplicate original/compressed output. Multiple same-kind attachments are not guessed into pairs. `append=true` explicitly adds another version; other explicitly selected files remain. Registering the same file reuses its attachment.

For original images or exact original formats, use `bot_send_file(assetId=result-id, asFile=true)` to change that registration to file delivery rather than also sending a preview. This applies to QQ and WeChat.

## Voice bubbles

QQ audio replies become 24 kHz mono SILK, sent as playable voice bubbles. Local platform tests on 2026-11-02 succeeded at 15 and 300 seconds, with user confirmation of bubble display; 305/~320-second uploads returned `40093013`. The plugin therefore segments longer audio completely into at-most-300-second parts, each independently registered, queued and receipted, and additionally retains a full MP3. The original is not overwritten; shorter audio stays one bubble.

Explicit file requests use ordinary upload. Voice-preparation failure retains the original audio file. An explicit QQ `40093013` rejection also permits uploading complete audio as a file.

## Limits

| Type | Official soft limit | Delivery hard limit |
| --- | --- | --- |
| Image | 20 MB | 200 MiB |
| Video | 30 MB | 200 MiB |
| Audio | 20 MB | 200 MiB |
| File | 200 MB | 200 MiB |

Official docs say MB and illustrate 30 MB with `file_size=31457280`; the hard limit therefore uses `200 * 1024 * 1024` bytes. QQ decides file fallback above soft limits; the plugin does not reject locally. Ordinary files use `file_type=4`.

`file_data` applies only at or below 5,000,000 bytes, a conservative transport choice rather than an attachment limit. Larger files use multipart without operator-hosted public URLs. Both registered and actual disk sizes are checked, preventing metadata from bypassing the hard cap.

Audio input's 100 MiB is a local-processing budget. Generated audio/QQ delivery support 200 MiB. Complete MP3 below 20,000,000 bytes for Music/title-based covers is a feature policy, not QQ's maximum. Other channels retain their limits.

## Upload and send

Small files call `POST /v2/{users|groups}/{id}/files` with `file_name`, Base64 `file_data`, `srv_send_msg=false`.

Large files first call that target's `upload_prepare` with size, name, type, full MD5/SHA1 and MD5 of the first 10,002,432 bytes. PUT parts in response order using part numbers/sizes/presigned URLs, call `upload_part_finish` after each, then merge through `files` with `upload_id`. Presigned PUTs carry no bot authorization header; cancellation covers reads and all requests.

Message submission starts only after receiving `file_info`. Durable retries reuse the attachment and still-valid `file_info`; `ttl=0` means indefinite. Expired/unknown validity triggers reupload of the same attachment, not TTS/RVC/download reruns. Incomplete multipart uploads can create a fresh upload job.

Attachment delivery has a 15-minute total deadline and 60 seconds per upload request; text stays 90 seconds. Bot stop, session stop and cancellation still abort immediately, while large files avoid the former 90-second cutoff.

## States and errors

Generated files return `registeredForDelivery=true`, `deliveryState=registered`, `platformSent=false`: queued for host delivery at turn end, not already received. Requeueing is not success; only receipts confirm delivery.

Preparation/upload termination fails as `failed`. A network interruption after message submission with unconfirmed acceptance becomes `unknown`, avoiding blind resend. Delivery records retain HTTP status, platform code, sanitized explanation and trace ID for diagnosis, not complete responses, keys or upload signatures.

## Verification

Regressions cover actual files above the direct threshold, multipart above soft limits, hard caps, disk size, part integrity/checksums, cancellation, upload rejection, post-submission disconnect and registered/queued/delivered distinctions. Local adapters send no QQ messages; real-platform acceptance needs operator authorization.

## Official sources

Checked: 2026-11-01.

- [Private rich-media upload](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_files.post.html)
- [Private multipart preparation](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_prepare.post.html)
- [Private part completion](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_part_finish.post.html)
- [Group rich-media upload](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_files.post.html)
- [Group multipart preparation](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_prepare.post.html)
- [Group part completion](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_part_finish.post.html)
