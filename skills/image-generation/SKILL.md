---
name: image-generation
description: Generate images or edit user-selected reference images through a configured OpenAI-compatible image API. Use for explicit image creation or editing requests; do not use for ordinary chat, slash commands, bracketed control instructions, or requests explicitly excluding images.
---

# Image generation and reference editing

在 Harness 插件中调用 `image_generation`：`prompt` 使用英文，`operation` 为 `generate` 或 `edit`，`inputs` 只填当前会话的参考附件 ID。宿主通过固定模块 `dsh_bot_runtime.skills.image_generation.image_api` 执行图片客户端并自动登记成品；人格图片连接设置与宿主默认值保持原有优先级。聊天输入不得运行脚本、指定 Python 模块或提供本机路径。`bot_media(image_generate/image_edit)` 仍是等价兼容入口。

## Decide whether to run

- Run for an explicit request to create or edit an image. A request without reference images can still create a new image; a reference-edit request must have the specified inputs.
- Do not generate for `/stop`, other slash commands, messages containing `[]` control instructions, or an explicit request not to generate an image.
- A failed attempt does not consume the turn's image allowance; another tool call can retry after correcting the cause. Do not call generation in parallel or produce a second successful image. Do not automatically retry a timeout or an unknown provider result.
- Follow the current tool permissions. This skill does not grant administrator access or bypass confirmation for host operations.
- If the user requests a reference edit, use their actual selected image(s), including their selected ordinal. If a specified image is missing, ask them to resend it; never substitute a text-only generation.

## Configure

Operators can set the HTTPS service address and credential environment variable name in a V4 persona's image configuration. `media.image.baseUrl`, `media.image.model` and `media.image.keyEnv` override the host defaults. The current plugin accepts only `schemaVersion: 4`: it does not read, migrate, or roll back V3 or earlier persona files. Recreate an older persona manually using the current V4 schema. The persona stores the variable name only; the backend reads its secret value from the environment.

Credentials come from `IMAGE_ACCESS_KEY` by default; existing `SAKURA_IMAGE_API_KEY` is supported as a fallback. Operators can set `BOT_IMAGE_KEY_ENV` to another variable's name, `BOT_IMAGE_BASE_URL` for the provider and `BOT_IMAGE_MODEL` for the model. Existing `SAKURA_IMAGE_BASE_URL`, `SAKURA_IMAGE_MODEL` and `OPENAI_BASE_URL` aliases are also supported. Never put the secret itself in a prompt, command argument, example, log or committed file. Generic defaults remain `https://api.openai.com/v1` and `gpt-image-2`; HTTPS is required.

The plugin and standalone client use the same environment contract. Optional per-persona overrides take precedence over the environment; absent values inherit, rather than disable, the skill. The UI has an explicit disable switch. Custom provider defaults belong in the operator's runtime environment, never in this portable source. Only the selected image key is forwarded to the media worker.

生产 worker 只接受发布包中的固定模块 entry，不从 `SKILL.md`、人格、聊天内容、cwd 或工作区发现 Python 代码。下面命令仅供运营者在已知发布包 Python 根且安装 `requests` 的环境中独立验证客户端；模型不得自行运行。

## Generate one image

```sh
python -B -P -m dsh_bot_runtime.skills.image_generation.image_api generate --prompt "An adult silver-haired catgirl maid greeting the viewer, expressive emerald eyes, soft light, simple background, anime illustration, 3:2 framing" --model gpt-image-2 --n 1 --output-format jpeg --output-compression 96 --output-dir assets
```

## Edit the selected reference image

```sh
python -B -P -m dsh_bot_runtime.skills.image_generation.image_api edit --prompt "Use the attached pose reference. Replace the main subject with adult Sakura, a silver-haired catgirl maid with emerald eyes. Preserve the action and camera framing; change only the character identity." --image reference.png --model gpt-image-2 --n 1 --output-format jpeg --output-dir assets
```

Repeat `--image` for additional user-selected references. State the role of each input in the prompt. `n` is the output count, not the number of inputs. Use `--mask mask.png` for an optional PNG mask. Paths in examples are placeholders for user-provided files.

`--dry-run` 只验证参数，不发送请求也不读取密钥；编辑模式仍要求输入文件存在。`--record assets/request.json` 只保存稳定状态、错误码、输出路径和计数，不保存 prompt、endpoint、credential、输入路径或 provider 正文；该文件仍属于作业私有产物，不应提交。

GPT Image 2.6 的生成请求可以使用 `--output-format svg` 或 `--output-format gif`。SVG 只支持生成、`n=1`，保存为 UTF-8 XML；GIF 只支持生成，可用 `--frame-count 2..64` 与 `--frame-duration-ms 20..2000` 控制动画。GIF/SVG 返回的实际签名必须与请求格式一致，provider 忽略格式时客户端会失败并不会把 PNG 冒充成目标格式。`--complexity low|medium|high` 可传递 GPT Image 2.6 的规划复杂度。

## Validate and deliver

Translate descriptive prompts into clear English, preserving exact requested lettering verbatim. Keep the requested subject, pose, style and edit invariants; do not add unrelated changes. The client uses only the options described in its contract, and makes no guarantee that a provider supports a particular model or parameter.

Inspect the saved output, verify the requested edit and actual image format, and report the returned count. JPEG is the default and the client normalizes provider PNG/WebP responses to JPEG when `--output-format jpeg` is selected. An HTTP success is not visual validation. Deliver the actual file using the host's image-send capability; do not expose a host-local path as if a remote chat user could open it. On failure, report the stage and available evidence without exposing secrets or claiming an image was generated or sent. Do not silently retry the whole batch or fall back from editing to generation.
