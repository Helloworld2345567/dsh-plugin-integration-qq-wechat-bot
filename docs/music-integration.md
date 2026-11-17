# 音乐搜索与下载

简体中文 | [English](en/music-integration.md)

插件通过 `musicdl_json_v1` 子进程协议调用独立 Music 项目。该项目及 Python 环境由运营者部署；机器人负责权限、会话候选、附件和投递。

## 配置与使用

1. 在受管 Music Profile 的私有 `home` 中登记项目根目录；服务面板设置来源顺序。支持 `MiguMusicClient`、`KuwoMusicClient`、`QQMusicClient` 和 `NeteaseMusicClient`，默认咪咕、酷我。
2. 在“机器人 → 媒体 → 音乐搜索与下载”开启能力并选择 Profile，同时启用 `bot_music` 和 `music-download`。机器人只保存 Profile 引用、开关和歌词偏好，歌词默认关闭。
3. 直接按歌名、歌手下载最高匹配歌曲，或先搜索再选候选。候选与原始歌曲属于当前渠道会话，重置会话后旧候选不可继续使用。

项目目录不在服务面板重复选择，解释器、输出路径和媒体地址不能由聊天模型指定。来源需要授权时，宿主向受控子进程注入 `MUSIC_QQ_COOKIES`、`MUSIC_NETEASE_COOKIES`（Cookie JSON 或分号分隔字符串），代理使用 `MUSIC_HTTP_PROXY`；凭据通过 Harness 管理，不写入机器人配置、候选或模型上下文。

## 歌曲转换与投递

`bot_sing action=sing` 接受 `song/artist` 或已选的 `candidateSet/candidate`。当前会话已有同曲源音频时复用原件；只请求翻唱时不额外发送原曲。曲库歌曲按含伴奏处理，需要可用的 RVC Profile 和人声分离配置，见 [RVC 音色转换](singing-conversion.md)。

下载与按歌名翻唱均输出完整且严格小于 **20,000,000 字节**的 MP3。合规 MP3 直接复用，其他来源从原件完整转码；默认 192 kbps，按时长降到 160/128/96/64 kbps。仍无法容纳时明确失败，不截短歌曲。该交付策略独立于 [QQ 平台上限](qq-media-delivery.md)。

文件验证后登记为附件，任务临时目录随后清理。下载成功、附件登记和平台送达是不同状态；投递恢复复用现有附件，不重新搜索、下载或转换。关闭能力或撤销权限会阻止后续执行和投递。

## 检查与限制

“检查 health”只验证环境和协议。真实验收需搜索并下载完整歌曲、检查时长和解码、验证所需歌词及目标平台投递；记录绑定人格与 Profile 版本，版本变化后重新验收。

来源可能失效、要求登录或只返回试听片段，搜索成功不保证完整下载。新增来源应先验证完整下载。音乐下载不提供 RVC 模型、人声分离模型或音乐生成；本地输入处理预算及显式上传转换限制见 [RVC 音色转换](singing-conversion.md)。
