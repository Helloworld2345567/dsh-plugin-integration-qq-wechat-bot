/** Optimistic-concurrency failure surfaced to the operator and tool layers. */
export class ConflictError extends Error {
  constructor(message = '配置已被其他操作修改，请刷新后重试') { super(message); }
}
