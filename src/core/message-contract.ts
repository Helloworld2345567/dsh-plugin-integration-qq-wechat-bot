import {z} from 'zod';

export const messageDescriptorSchema=z.object({
  key:z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,159}$/),
  params:z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,79}$/),z.union([z.string().max(1000),z.number().finite()])).optional(),
}).strict();
