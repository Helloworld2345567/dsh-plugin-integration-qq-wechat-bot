# 能力边界、模型目录与服务插件化实施计划

日期：2026-11-02
状态：已审计，待分阶段实施
目标分支：main

## 1. 目标与决策

本计划把 QQ/微信 Bot 的能力、外部推理服务、模型运行数据和安装方式分开，使新增服务只需要实现受信任的适配器，不需要把服务代码、模型路径或服务协议写入 DSH 插件核心。

采用“独立服务 + 受信任 Service Adapter Plugin”的方案：

- DSH 插件负责渠道、身份、会话、权限、任务、附件、投递、统计和管理面板。
- `E:\TTS_and_STS` 与 `E:\Music` 保持独立项目、独立环境、独立测试和独立升级。
- 服务通过中立的 manifest、profile、health、execute 和 cancel 契约接入。
- 传输方式按服务保留：GPT-SoVITS 使用 loopback HTTP，Music 使用 `musicdl_json_v1` JSON 子进程，RVC 使用 CLI/受控 worker。
- 不执行人格目录写入的任意代码；只加载随包发布或明确登记的受信任插件。
- 旧人格配置自动迁移并兼容读取，新保存只写精简结构。

不把所有服务强行改成同一种 RPC，也不把外部服务源码并入 DSH 插件。这样可以保持各服务已有的命令和测试边界，同时统一 Bot 侧的权限、取消、资源和投递行为。

## 2. 当前能力边界

### 宿主共性

以下能力属于 DSH/插件宿主，不由外部服务实现：

- QQ 官方渠道、微信 iLink 渠道、凭据和连接生命周期。
- 渠道身份、会话绑定、人格快照、模型选择和权限交集。
- 会话历史、记忆、工作区、附件归属、Asset 注册和投递队列。
- 任务取消、超时、重复 job 防护、配额、并发、失败记录和统计。
- 定时任务、主动会话、长任务进度、人格管理、生命周期和升级。
- 面板 API、配置 revision、profile revision 和真实能力验收记录。

模型或外部服务不能提供渠道身份、用户 ID、会话 ID、Asset 路径、工作目录、凭据或投递目标。

### 能力层

能力以固定 operation 注册到现有的 `operations.json -> MediaOperationRegistry -> WorkerPort -> Asset/投递队列` 链路：

- 图片生成/编辑：调用配置的 image provider，输出由宿主登记。
- ASR/视频分析：复用 Harness 当前模型连接，服务配置只允许 profile 覆盖。
- 图片转换、压缩、缩放和 GIF：本地 worker，使用宿主分配的处理槽位。
- 语音朗读：Edge TTS 或 GPT-SoVITS。
- 歌曲搜索/下载：Music provider。
- 歌曲音色转换：Music 获取源音频，可选分离，再交给 RVC。
- 文件和社交读取：继续使用宿主权限和现有工具。

`bot_voice`、`bot_music`、`bot_sing` 的模型可见参数保持业务语义；服务地址、路径、模型文件、索引、凭据和内部 locator 不进入工具参数。

### 外部项目边界

`E:\TTS_and_STS` 当前包含两个独立领域：

- `GPT-SoVITS/`：单进程、有状态的 loopback HTTP TTS 服务，默认 `127.0.0.1:9880`。服务读取本机 GPT/SoVITS 权重和参考音频。
- `RVC/`：CLI-only 的离线变声与人声分离，稳定入口为 `rvc convert` 和 `rvc separate infer`。外部 RVC 项目不提供 Bot 所需的 HTTP 服务；现有 `rvc_http_v1` 是 Bot 侧 worker facade。

`E:\Music` 提供 `musicdl_json_v1` 单次 JSON 子进程协议，动作包括 `health`、`search` 和 `acquire`。宿主负责输出目录、deadline、取消、结果校验和 Asset 登记。

## 3. 目标服务插件契约

### Manifest

主插件增加稳定的 `ServicePluginHost`/`ServicePluginRegistrar` API，并在创建 `MediaService`、工具 schema 和 `NativeHarness` 前完成插件加载和校验。

```ts
interface ServicePluginManifest {
  id: string;
  version: string;
  hostRange: string;
  capabilities: CapabilityDescriptor[];
  profileSchema: unknown;
  dependencies: DependencyDescriptor[];
  defaults: Record<string, unknown>;
}

interface CapabilityDescriptor {
  operation: string;
  tool?: string;
  inputKinds: string[];
  outputKinds: string[];
  parameterSchema: unknown;
  permissionTool: string;
  quotaUnits: number;
  concurrency: number;
  deliver: boolean;
}
```

Manifest 必须校验：ID、版本、宿主版本范围、operation 唯一性、schema、依赖、输入/输出类型、权限工具和并发限制。重复 service ID、非法路径、未知协议和未满足依赖必须在启动时拒绝。

### Adapter

```ts
interface ServiceAdapter {
  listProfiles(signal: AbortSignal): Promise<readonly ServiceProfile[]>;
  health(profileId: string, signal: AbortSignal): Promise<HealthResult>;
  execute(request: ServiceJob, signal: AbortSignal): Promise<ServiceResult>;
  cancel(jobId: string): Promise<void>;
}
```

宿主向 adapter 提供：固定 job ID、作用域、隔离 job 目录、解析后的输入 Asset、业务参数、profile 引用、凭据引用和 `AbortSignal`。adapter 返回文本、输出文件和诊断；宿主检查输出路径、大小、格式、时长、非静音、会话归属，再登记 Asset 和投递。

统一错误类别至少包括：

- `NOT_CONFIGURED`
- `DEPENDENCY_UNAVAILABLE`
- `INVALID_INPUT`
- `TIMEOUT`
- `CANCELLED`
- `PROVIDER_ERROR`
- `OUTPUT_INVALID`

外部服务不访问 DSH Store、渠道适配器、身份对象或投递队列。

## 4. 配置收敛

### 人格配置

人格只保存用户选择和少量业务偏好：

```json
{
  "media": {
    "image": { "enabled": true, "profileId": "default" },
    "asr": { "enabled": true, "profileId": "default" },
    "video": { "enabled": true, "profileId": "default" },
    "voice": { "enabled": true, "profileId": "klee-tts", "replyMode": "on_demand" },
    "singing": { "enabled": true, "profileId": "hutao-rvc" },
    "music": { "enabled": true, "includeLyrics": false }
  }
}
```

- image/asr/video：`enabled`，可选 `profileId`；缺省跟随宿主环境或聊天模型。
- voice：`enabled`、`profileId`，保留 `replyMode` 作为业务偏好。
- singing：`enabled`、`profileId`。
- music：`enabled`、`includeLyrics`；来源顺序和本机路径放在全局 Music profile。
- 聊天主模型继续使用已有 `{provider, model}`；会话级 `modelOverride` 和轮次快照保持现有语义。

GPT-SoVITS 的 base URL、模型版本、GPT/SoVITS 权重、参考音频、参考文本和语言，RVC 的服务地址、角色权重、索引、F0、设备、speaker、pitch 默认值和分离模型，全部移到本机 profile。

### Profile

Profile 放在运行数据目录或服务项目的受管 profile 目录，不进入人格文件、GitHub 发布包或聊天上下文。面板只显示：

- `id`
- 显示名称
- 服务类型
- 能力列表
- 模型版本/角色名称
- `ready`、`partial`、`blocked` 状态
- 脱敏诊断

不返回路径、端口细节、凭据、下载 locator 或权重文件名给模型。

### 迁移

将配置 schema 从 v3 迁移到 v4：

1. 读取旧人格中的详细服务字段。
2. 规范化 endpoint、模型和路径，写入本机受管 profile。
3. 人格替换为 `enabled + profileId`。
4. 旧形状短期只读兼容；下一次保存只写新结构。
5. profile 创建失败时保留旧数据并显示 `blocked`，不静默丢失或回退到另一个模型。
6. 能力验收记录同时绑定人格 revision 和 profile revision。

迁移必须幂等，不能影响会话、附件、记忆、机器人身份和历史记录。

## 5. 模型目录整理与迁移

### 标准目录

```text
E:\TTS_and_STS\models\
  catalog.json
  shared\
    rvc\hubert_base\
    rvc\rmvpe\
    separation\vocals\
    separation\vocals-aggressive\
  voices\
    klee\
      manifest.json
      tts\gpt.ckpt
      tts\sovits.pth
      tts\references\default.wav
      rvc\model.pth
      rvc\index.index
    hutao\manifest.json
    noelle-zh\manifest.json
    paimon-zh\manifest.json
    xiangling-zh\manifest.json
    yoimiya-zh\manifest.json
```

规则：

- 目录使用稳定 ASCII ID；显示名称和原始名称写入 manifest。
- TTS 角色固定 `gpt.ckpt`、`sovits.pth`、`references/default.wav`。
- RVC 角色固定 `model.pth` 和可选 `index.index`。
- 共享 HuBERT、RMVPE 和分离模型只保留一份。
- 文件名不用于伪造模型版本；版本通过 manifest 和实际检查点识别。
- `train.log`、`prompt-assistant.zip` 和 `泡沫.mp3` 等非模型文件不进入模型目录。

### 已发现的资源

- 可莉：GPT-SoVITS v4 角色对、参考音频、RVC v2/F0 模型和 index；E:\TTS_and_STS 已有副本，D:\Web_Download\v4 中有重复副本。
- 胡桃：RVC v2/F0 模型和 index；`泡沫.mp3` 是输入歌曲。
- 派蒙：RVC v2/F0 模型和 index，同时有 GPT-SoVITS v4 角色对和参考音频。
- 诺艾尔、香菱、宵宫：GPT-SoVITS v4 角色对和参考音频。
- GPT-SoVITS v4 角色权重需要共享 v4 基座，不能只移动角色 `.pth`/`.ckpt`。
- RVC 还需要共享 HuBERT、RMVPE 和相应的分离资源。

### 移动流程

1. 停止 DSH、GPT-SoVITS、RVC 和 Music 进程。
2. 扫描 `E:\TTS_and_STS` 与 `D:\Web_Download`，记录源路径、目标路径、大小和 SHA-256。
3. 对重复文件只保留一份 canonical 文件；跨盘迁移采用“复制、校验、再删除源文件”。
4. 生成 `models/catalog.json`、角色 manifest 和 service profiles。
5. 更新 GPT-SoVITS YAML、RVC profile、启动脚本和 DSH profile 引用。
6. 逐个执行 health、真实 TTS、真实 RVC/分离和 FFprobe 检查。
7. 迁移失败时保留源文件和旧 profile，不自动删除或覆盖。

## 6. 面板与模型选择

新增管理查询：

- `catalog.profiles`：列出 profile、能力和状态。
- `catalog.profile`：返回一个 profile 的非敏感详情和诊断。
- `catalog.models`：统一返回 provider、model、输入模态和 reasoning 能力，兼容现有 `models` action。
- `service.health`：执行指定 profile 的健康检查。
- `service.refresh`：重新扫描本机服务和模型 catalog。

面板流程：

1. 服务页显示发现的 GPT-SoVITS、RVC、Music 服务和依赖状态。
2. 能力卡只显示启用开关、profile 选择和业务偏好。
3. profile 选择器展示角色名、版本、能力和 ready/partial/blocked。
4. “检查服务”只执行 health，不伪造真实推理成功。
5. “登记验收”必须关联当前人格 revision、profile revision 和实际证据。
6. profile 或模型切换从下一轮生效；当前轮继续使用冻结快照。

模型上下文只看到当前能力是否可用和应填的业务参数，不看到服务路径、端口、凭据和内部文件名。

## 7. 各服务适配

### GPT-SoVITS

保留 `POST /tts` 和现有单进程服务。增加服务侧 profile 解析接口或 adapter 层：

- `GET /health`
- `GET /profiles`
- `POST /tts` 支持安全的 `profile` 引用。

profile 固定参考音频、提示文本、语言、模型版本和默认输出。Bot 请求只提交 `profile`、文本和允许的少量业务覆盖，拒绝模型或用户提交任意本机路径。保持单服务串行锁，输出 WAV 后由宿主检查可解码、有效帧和非静音。

### RVC

保留 RVC CLI-only 边界。adapter 通过受控 job 目录调用：

- `rvc convert --model ... --input ... --output ...`
- `rvc separate infer ... --input ... --output ...`

增加 profile/catalog 查询和 JSON 诊断，默认 pitch 0、F0 RMVPE、无 index 时 index rate 0。超时或取消必须终止进程树，释放 GPU，并清理 job 目录。现有 `rvc_http_v1` 只作为 Bot worker facade，不称为外部 RVC HTTP 服务。

### Music

继续使用 E:\Music 的 `musicdl_json_v1`。默认来源为已验收的 Migu 和 Kuwo；QQ/Netease 只有显式启用并完成真实搜索与完整下载验收后才加入 profile。Bot 只提交 song、artist、候选编号、歌词偏好和 profile；宿主保留输出目录、deadline、取消和 20 MB 完整音频限制。

## 8. GitHub 一键安装最小配置插件

当前 `scripts/install.mjs` 支持本地目录或 `.tgz`，不直接接受 GitHub URL。新增 `scripts/bootstrap-github.mjs` 和 Windows 包装脚本：

```text
-Repository
-Ref
-Sha256
-Home
-SourceDir
```

安装规则：

1. 默认只允许固定 release tag 或 commit；禁止直接跟随 `main`。
2. 优先下载 GitHub Release 的 `.tgz` 和 `.sha256`。
3. 校验 SHA-256 后才调用现有安装器。
4. 安装器继续使用 `npm pack --ignore-scripts`、发布白名单和 identity hash。
5. 自动创建最小 Harness profile、workspace 和 media venv。
6. 自动探测 E:\TTS_and_STS 与 E:\Music；找不到时显示未配置，不安装重型 CUDA/RVC 依赖。
7. 下载和临时 clone 放在项目 `.codex`，成功或失败后清理。

外部服务插件独立发布为 npm/tgz 包，通过 service contract 的 host range、entry、operations、profile schema、dependencies 和 checksum 校验后安装。运行数据、模型和凭据不进入 GitHub 包。

### 最小安装后配置

| 配置项 | 作用 | 默认值 |
|---|---|---|
| `BOT_HOME` | Harness 运行数据根目录 | 安装器默认产品目录 |
| `BOT_PYTHON` | 媒体 worker Python | 自动创建 media venv |
| `BOT_TTS_HOME` | GPT-SoVITS 服务根目录 | 自动探测 E:\TTS_and_STS |
| `BOT_RVC_HOME` | RVC 服务根目录 | 自动探测 E:\TTS_and_STS |
| `BOT_MUSIC_HOME` | Music 项目根目录 | 自动探测 E:\Music |
| `profileId` | 人格选择的服务/模型 | 面板选择或 default |
| `includeLyrics` | 音乐是否附歌词 | `false` |
| `replyMode` | 语音按需或自动朗读 | `on_demand` |

端口、模型路径、参考音频、索引、设备、来源顺序和凭据属于本机 profile，不要求用户在每个人格中重复填写。

## 9. 实施顺序

### 阶段 A：契约与只读发现

- 增加 service contract、manifest 校验和 `ServicePluginHost`。
- 增加本机服务 discovery、profile catalog 和 health 查询。
- 不改变现有人格 schema 和运行入口。
- 为模型扫描生成只读 catalog，不移动文件。

### 阶段 B：模型整理与独立服务 profile

- 停止相关服务后执行哈希校验、去重和跨盘迁移。
- 更新 E:\TTS_and_STS 的 GPT/RVC 配置与启动脚本。
- 给 E:\Music 增加 profile/catalog 读取。
- 运行真实 health 和媒体输出验收。

### 阶段 C：适配器迁移

- 先包装 Music adapter，再包装 GPT-SoVITS 和 RVC adapter。
- 保留 `MusicProcessWorker`、`bot_voice`、`bot_sing`、`bot_music` 作为兼容 facade。
- 将 endpoint/path/model 校验从人格 schema 移到 profile schema。
- 统一错误、取消、超时、输出和诊断。

### 阶段 D：人格 schema v4 与面板

- 自动迁移旧人格到 profile 引用。
- 面板改为 profile 选择和模型 catalog 选择。
- 保留旧 API 兼容查询。
- 绑定 profile revision 的真实验收记录。

### 阶段 E：GitHub 安装与独立发布

- 建立 release tag、`.tgz` 和 `.sha256`。
- 实现固定 ref 的 bootstrap 安装器。
- 发布独立 service contract/adapter 包。
- 验证最小环境安装和服务缺失时的 blocked 状态。

## 10. 验收标准

### 模型与服务

- E:\TTS_and_STS 与 D:\Web_Download 的重复模型哈希一致并完成去重。
- 所有可用角色在 catalog 中显示能力、版本和 ready/partial 状态。
- 面板可以选择不同 TTS/RVC profile，并在下一轮使用新模型。
- 真实 TTS 输出可解码、非静音；真实 RVC/分离输出通过 FFprobe 和时长检查。
- Music health、search、acquire 完整通过，完整音频和歌词按配置交付。

### 宿主边界

- 权限撤销、会话切换、超时和取消会阻止后续投递。
- 子进程树、GPU 队列、串行锁和临时目录在失败后正确释放。
- 输出只能位于宿主 job 目录，Asset 只能登记到当前作用域。
- profile、凭据、路径和 locator 不出现在模型上下文、release 文件或聊天回复中。

### 插件与安装

- 非法 manifest、重复 ID、越权路径、未满足依赖和 host range 不匹配会被拒绝。
- E:\TTS_and_STS、E:\Music 不依赖 DSH 包，独立命令和测试继续通过。
- GitHub bootstrap 只安装固定 ref 并验证 SHA-256，临时下载目录会清理。
- 最小安装不强制安装 CUDA/RVC/Music 重型依赖。

### DSH 回归

```powershell
npm run typecheck
npm test
npm run test:python
npm run build
npm run check:release
npm run test:native
npm run test:lifecycle-native
npm run test:install-smoke
```

已有会话、人格、渠道、附件、记忆、统计、自动化和机器人删除规则保持通过。

## 11. 已知限制

- GPT-SoVITS 服务是单进程有状态服务，模型切换和参考缓存切换需要 adapter 串行化；客户端取消不保证服务端推理立即停止。
- RVC CLI 每次任务可能重新加载模型，耗时和显存占用随角色、音频长度和设备变化。
- Music 来源可能返回空结果、试听片段或下载失败；搜索成功不等于完整下载成功。
- 模型权重许可、第三方服务条款和共享基础模型许可需要按来源单独确认。
- 本计划只定义实施边界；代码迁移、真实模型移动和服务配置切换按阶段执行并逐项验收。
