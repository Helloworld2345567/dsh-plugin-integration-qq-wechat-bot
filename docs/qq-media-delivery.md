# QQ 媒体投递

QQ 的媒体总大小限制与 `file_data` 直传限制独立。插件对单聊和群聊统一执行媒体硬限制，大文件使用官方分片接口。

## 语音气泡

QQ 音频回复先转换为 24 kHz 单声道 SILK，以可直接点击播放的语音气泡发送。2026-11-02 本机实测：15 秒与 300 秒语音发送成功，用户确认显示为语音气泡；305 秒及约 320 秒上传返回 `40093013`。插件据此将超过 300 秒的音频完整分段，各段独立登记、排队和保存发送回执，并额外保留整曲 MP3 文件；原始音频不覆盖，未超过 300 秒的音频保持单条语音。

明确要求发送文件的输出按普通文件上传。准备语音失败时保留原音频文件；QQ 上传明确返回 `40093013` 时，也可将完整音频改按普通文件上传。

## 限制

| 类型 | 官方软限制 | 投递硬上限 |
| --- | --- | --- |
| 图片 | 20 MB | 200 MiB |
| 视频 | 30 MB | 200 MiB |
| 音频 | 20 MB | 200 MiB |
| 普通文件 | 200 MB | 200 MiB |

官方文档把大小写为 MB，并给出 30 MB 对应 `file_size=31457280` 的示例；硬上限据此使用 `200 * 1024 * 1024` 字节。超过软限制时由 QQ 降级为文件，不在插件中拒绝。普通文件使用官方 `file_type=4`。

`file_data` 只用于不超过 5,000,000 字节的文件；这是保守的直传选择阈值，不是附件硬上限。超过阈值自动分片，不要求运营者配置公网文件地址。上传前同时检查登记大小与磁盘实际大小，不能通过伪造附件元数据绕过硬上限。

音频输入的 100 MiB 是本地处理预算；生成音频和 QQ 投递支持到 200 MiB。音乐下载与按歌名翻唱的完整 MP3 小于 20,000,000 字节，仍是该功能既定交付策略，不代表 QQ 平台上限。其他渠道保持各自限制。

## 上传与发送

小文件调用 `POST /v2/{users|groups}/{id}/files`，传递 `file_name`、Base64 `file_data` 和 `srv_send_msg=false`。

大文件先调用同一目标的 `upload_prepare`，传递文件大小、名称、类型、完整 MD5/SHA1 和前 10,002,432 字节的 MD5。按响应中的分片编号、大小及预签名 URL 顺序 PUT，每片成功后调用 `upload_part_finish`，最后用 `upload_id` 调用 `files` 合并。预签名 PUT 不携带机器人鉴权头；取消信号贯穿文件读取和所有网络请求。

取得 `file_info` 后才调用消息提交接口。持久投递重试复用原附件及仍在官方 `ttl` 有效期内的 `file_info`；`ttl=0` 表示长期有效，过期或未记录有效期时重新上传原附件，不重新运行 TTS、RVC 或歌曲下载。没有完成的分片上传可重新建立上传任务。

附件单次投递最长 15 分钟，每个上传请求仍有 60 秒超时；文字投递保持 90 秒。关闭机器人、停止会话或取消任务时仍立即中止上传，避免大文件被原有 90 秒总时限提前打断。

## 状态与错误

工具生成文件后返回 `registeredForDelivery=true`、`deliveryState=registered`、`platformSent=false`。这些状态表示等待宿主在本轮结束后投递，不能表述为用户已经收到。重试重新排队也不是发送成功；只有平台回执才确认送达。

准备或上传阶段终止失败时标记 `failed`。消息提交后网络中断、无法确认平台是否接受时保留 `unknown`，避免盲目重发。平台 HTTP 状态、业务错误码、经过脱敏的错误说明及追踪标识保留在投递记录中，供管理页诊断；不保存完整响应、密钥或上传签名 URL。

## 验证

回归测试覆盖真实超过直传阈值的文件、跨软限制的分片、硬上限、实际文件大小、分片完整性与校验、取消、上传拒绝、提交后断线，以及登记/排队/已送达的状态区别。本地测试适配器不向 QQ 发送消息，真实平台消息验收需运营者授权。

## 官方来源

核对日期：2026-11-01。

- [单聊富媒体上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_files.post.html)
- [单聊分片预上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_prepare.post.html)
- [单聊分片完成](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_part_finish.post.html)
- [群聊富媒体上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_files.post.html)
- [群聊分片预上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_prepare.post.html)
- [群聊分片完成](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_part_finish.post.html)
