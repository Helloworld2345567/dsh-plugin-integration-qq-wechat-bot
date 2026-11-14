import type {Asset} from '../core/types.js';

/** QQ's /files documentation uses MB and byte examples in MiB. The conservative
 * 5M threshold only selects direct versus multipart upload.
 * https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_files.post.html
 */
export const QQ_MEDIA_LIMITS=Object.freeze({
  directUploadBytes:5_000_000,
  image:Object.freeze({hardBytes:200*1024*1024}),
  video:Object.freeze({hardBytes:200*1024*1024}),
  audio:Object.freeze({hardBytes:200*1024*1024}),
  file:Object.freeze({hardBytes:200*1024*1024}),
});

export function assertQQUploadSize(kind:Asset['kind'],size:number):void{
  if(!Number.isSafeInteger(size)||size<0)throw new Error('QQ_INVALID_FILE_SIZE');
  if(size>QQ_MEDIA_LIMITS[kind].hardBytes)throw new Error('QQ_OUTPUT_TOO_LARGE');
}

export function qqFileType(kind:Asset['kind']):number{
  return kind==='image'?1:kind==='video'?2:kind==='audio'?3:4;
}
