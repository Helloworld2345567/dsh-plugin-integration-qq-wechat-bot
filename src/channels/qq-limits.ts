import type {Asset} from '../core/types.js';

const MiB=1024*1024;
/** QQ's /files documentation uses MB and byte examples in MiB. Soft limits
 * change the platform's presentation to a file; they are not rejection limits.
 * The conservative 5M threshold only selects direct versus multipart upload.
 * https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_files.post.html
 */
export const QQ_MEDIA_LIMITS=Object.freeze({
  directUploadBytes:5_000_000,
  image:Object.freeze({softBytes:20*MiB,hardBytes:200*MiB}),
  video:Object.freeze({softBytes:30*MiB,hardBytes:200*MiB}),
  audio:Object.freeze({softBytes:20*MiB,hardBytes:200*MiB}),
  file:Object.freeze({softBytes:200*MiB,hardBytes:200*MiB}),
});

export function assertQQUploadSize(kind:Asset['kind'],size:number):void{
  if(!Number.isSafeInteger(size)||size<0)throw new Error('QQ_INVALID_FILE_SIZE');
  if(size>QQ_MEDIA_LIMITS[kind].hardBytes)throw new Error('QQ_OUTPUT_TOO_LARGE');
}

export function qqFileType(kind:Asset['kind']):number{
  return kind==='image'?1:kind==='video'?2:kind==='audio'?3:4;
}
