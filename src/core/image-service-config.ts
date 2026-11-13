import path from 'node:path';
import {z} from 'zod';

const absolutePath = (label: string) => z.string().trim().min(1).max(4096)
  .refine(value => !/[\x00-\x1f]/.test(value), {message: `${label} contains control characters`})
  .refine(value => path.isAbsolute(value) || path.win32.isAbsolute(value), {message: `${label} must be an absolute path`})
  .transform(value => path.win32.isAbsolute(value) ? path.win32.normalize(value) : path.resolve(value));

const localUrl = z.string().trim().min(1).max(2048).refine(value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash &&
      (url.protocol === 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase()));
  } catch { return false; }
}, {message: 'ComfyUI 地址必须是本机 HTTP 或 HTTPS 地址'});
const openAiUrl = z.string().trim().min(1).max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port === '443');
  } catch { return false; }
}, {message: 'OpenAI 图片服务地址必须是 HTTPS 地址'});
const keyEnv = z.string().trim().regex(/^[A-Z_][A-Z0-9_]*$/, 'API Key 环境变量名必须为大写变量名');
const defaultComfyWorkflowPath = (): string => {
  const separator = String.fromCharCode(92);
  return `${String.fromCharCode(69)}:${separator}COMFYUI${separator}workflows${separator}Krea2Standard-api.json`;
};

/** Operator-owned image service settings.  Credentials remain environment-backed. */
export const imageServiceSettingsSchema = z.object({
  imageProtocol: z.enum(['openai', 'comfyui']).default('openai'),
  openAiBaseUrl: openAiUrl.default('https://api.openai.com/v1'),
  openAiModel: z.string().trim().min(1).max(256).default('gpt-image-2'),
  openAiKeyEnv: keyEnv.default('OPENAI_API_KEY'),
  comfyUiBaseUrl: localUrl.default('http://127.0.0.1:8188'),
  comfyUiWorkflowPath: absolutePath('ComfyUI workflow').default(defaultComfyWorkflowPath()),
}).strict();

export const imageServiceSettingsInputSchema = imageServiceSettingsSchema.extend({
  expectedRevision: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
});
export type ImageServiceSettings = z.infer<typeof imageServiceSettingsSchema>;

export function imageServiceSettingsFromRecord(raw: unknown): ImageServiceSettings {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return imageServiceSettingsSchema.parse({
    imageProtocol: record.imageProtocol,
    openAiBaseUrl: record.openAiBaseUrl,
    openAiModel: record.openAiModel,
    openAiKeyEnv: record.openAiKeyEnv,
    comfyUiBaseUrl: record.comfyUiBaseUrl,
    comfyUiWorkflowPath: record.comfyUiWorkflowPath,
  });
}
