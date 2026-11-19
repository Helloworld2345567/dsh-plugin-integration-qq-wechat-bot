# QQ 媒体投递

简体中文 | [English](en/qq-media-delivery.md)

QQ 单聊与群聊使用相同的插件大小限制，大文件通过官方分片接口上传。生成或下载成功只表示文件可用，平台回执才确认送达。

## 选择最终附件

媒体工具默认登记附件，在本轮结束后投递。中间材料使用 `deliver=false`；本地转换成功后默认只发送成品，用户需要原件时使用 `keepInputs=true`。转换失败保留原登记，源文件不会删除。

`bot_send_file(path=最终文件, mime=实际类型)` 默认替换本轮唯一同类自动附件，避免同时发送原件和压缩版；存在多个同类附件时不猜测对应关系。`append=true` 明确追加，重复登记同一文件复用原附件。需要原图或指定格式文件时使用 `bot_send_file(assetId=成品ID, asFile=true)`，此选项也适用于微信。

QQ 音频优先转换为 24 kHz 单声道 SILK 语音气泡。超过 300 秒时完整分段，每段独立排队，并额外发送完整 MP3；原音频保留。明确要求文件、语音准备失败或上传返回 `40093013` 时可使用普通文件投递。

## 大小与上传

| 类型 | QQ 文档软限制 | 插件投递硬上限 |
| --- | --- | --- |
| 图片 | 20 MB | 200 MiB |
| 视频 | 30 MB | 200 MiB |
| 音频 | 20 MB | 200 MiB |
| 普通文件 | 200 MB | 200 MiB |

硬上限为 `200 * 1024 * 1024` 字节，上传前检查登记大小和实际文件大小。超过软限制由 QQ 决定是否降级为文件，插件不提前拒绝。普通文件使用 `file_type=4`。

不超过 **5,000,000 字节**时使用 Base64 `file_data` 直传；更大文件依次执行 `upload_prepare`、分片 PUT、`upload_part_finish` 和 `files` 合并，无需公网文件地址。预签名 PUT 不携带机器人鉴权头。获得 `file_info` 后再提交消息。

单附件投递最长 15 分钟，每次上传请求超时 60 秒；文字投递超时 90 秒。停止任务或关闭机器人仍立即取消上传。协议实现见 [qq-upload.ts](https://github.com/Helloworld2345567/dsh-plugin-integration-qq-wechat-bot/blob/main/src/channels/qq-upload.ts)。

本地音频输入的 100 MiB 预算和[音乐功能](music-integration.md)的完整 MP3 小于 20,000,000 字节策略，均与 QQ 平台上限独立；微信使用自己的渠道限制。

## 状态与恢复

| 状态 | 含义与处理 |
| --- | --- |
| `registered` / 已排队 | 等待投递，`platformSent=false`，不能称为已经收到 |
| 平台已确认 | 消息提交取得平台回执 |
| `failed` | 准备或上传明确失败，可按记录处理 |
| `unknown` | 提交后连接中断，不能确认平台是否接受，不盲目重发 |

投递恢复复用原附件及有效期内的 `file_info`；`ttl=0` 表示长期有效，过期或未记录有效期时重新上传，不重复生成、转换或下载。未完成分片可新建上传任务。投递记录保存脱敏的状态、业务错误码与追踪标识，供管理页诊断。

本地测试不向 QQ 发消息。真实平台验收需实际发送并核对回执；开发验证范围见[测试指南](testing.md)。

## 官方接口参考

- [单聊富媒体上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_files.post.html)
- [单聊分片预上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_prepare.post.html)与[分片完成](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_id_upload_part_finish.post.html)
- [群聊富媒体上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_files.post.html)
- [群聊分片预上传](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_prepare.post.html)与[分片完成](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_id_upload_part_finish.post.html)
