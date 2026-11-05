# Bundled image client contract

本文描述随插件发布的 `dsh_bot_runtime.skills.image_generation.image_api` 客户端，并不承诺所有兼容提供商都支持相同能力。插件和运营者的独立验证使用同一客户端。

## Connection and credentials

- Default base URL: `https://api.openai.com/v1`; override through `--base-url` or `OPENAI_BASE_URL`.
- Default model: `gpt-image-2`; override through `--model` for the chosen provider.
- 默认凭据变量为 `IMAGE_ACCESS_KEY`；已有 `SAKURA_IMAGE_API_KEY` 环境时兼容使用该变量，也可通过 `--api-key-env VARIABLE_NAME` 显式选择。
- Credentials are read from the environment and sent as a Bearer header. Only HTTPS API URLs without embedded credentials, query or fragment are accepted. Redirects are disabled.
- Standalone CLI use can prompt for a missing key; the plugin preflights the variable before starting the client. Configure unattended jobs with a process environment variable.

## Generation

`POST {base_url}/images/generations` with a JSON body containing `model`, `prompt`, `n`, and supported output options.

## Reference editing

`POST {base_url}/images/edits` with multipart form data. The text fields include `model`, `prompt`, `n`, and output options. Every selected input is uploaded as a repeated `image` field. An optional PNG mask uses `mask`.

```python
files = [
    ("image", (target.name, target_handle, target_mime)),
    ("image", (reference.name, reference_handle, reference_mime)),
]
```

Do not collapse these fields into a dictionary. Input count is independent of `n`. Preserve the actual selected source bytes, rather than replacing the reference with a text description.

## Parameters and limits

- `n`: 1–10; Sakura automatic illustration requests exactly 1 output.
- `output_format`: `png`, `jpeg`, or `webp`. JPEG is the default.
- `output_compression`: 0–100 for JPEG/WebP; default 96. Do not send it for PNG.
- `background`: optional `auto`, `opaque`, or `transparent`; transparency cannot use JPEG.
- The client omits `quality` and `size`; describe composition and framing in the prompt.
- Each input must be a non-empty PNG/JPEG/WebP file no larger than 10 MiB. Masks must be PNG. Combined input bytes must not exceed 22 MiB.
- Combined outputs are capped at 24 MiB. When `output_format=jpeg`, the script decodes and re-encodes every successful output as JPEG, even if a compatible provider returns PNG or WebP. Other formats retain their requested format.

Providers must support the parameters being sent. Use an actual provider-supported model; do not infer availability from its name or from another service's documentation.

## Results and failures

The client accepts an image body or JSON `data` items containing `b64_json` or an HTTPS image URL. It validates file signatures and caps downloads. It reports `requested_count` and `returned_count`, and preserves completed outputs.

付费或结果不确定的请求不会自动重放；认证、限流或网络错误也不静默重试。CLI 失败只输出稳定错误码，record 不保存 endpoint、credential、prompt、输入路径或 provider 正文；模型调用、输出检查和平台投递仍分别报告。
