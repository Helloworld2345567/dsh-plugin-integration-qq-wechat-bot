import type {Output} from './types.js';
import {INPUT_LIMITS} from './limits.js';

/** Read the final prose once; code and link destinations are not useful speech. */
export function spokenReplyText(outputs:readonly Output[]):string|undefined {
  const source=outputs.filter(output=>output.type==='text').map(output=>output.text??'').join('\n\n');
  let fence:{marker:string;length:number}|undefined;
  const lines:string[]=[];
  for(const line of source.split(/\r?\n/)){
    const boundary=/^ {0,3}(`{3,}|~{3,})/.exec(line);
    if(fence){
      if(boundary&&boundary[1][0]===fence.marker&&boundary[1].length>=fence.length&&line.slice(boundary[0].length).trim()==='')fence=undefined;
      continue;
    }
    if(boundary){fence={marker:boundary[1][0],length:boundary[1].length};continue;}
    if(/^(?: {4}|\t)/.test(line)||/^ {0,3}\[[^\]]+\]:\s*\S+/.test(line))continue;
    lines.push(line);
  }
  const text=lines.join('\n')
    .replace(/!\[[^\]]*\]\((?:\\.|[^\\)])*\)/g,'')
    .replace(/\[([^\]]+)\]\((?:\\.|[^\\)])*\)/g,'$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g,'$1')
    .replace(/<?https?:\/\/[^\s<>]+>?/gi,'')
    .replace(/^ {0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/gm,'')
    .replace(/[`*_~]/g,'')
    .replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  return text&&Buffer.byteLength(text,'utf8')<=INPUT_LIMITS.textParameterBytes?text:undefined;
}

export function replyNotice(outputs:readonly Output[],notice:string):Output[] {
  const result=outputs.map(output=>({...output}));
  const text=result.findLast(output=>output.type==='text'&&!!output.text);
  if(text)text.text+=`\n\n${notice}`;
  else result.push({type:'text',text:notice});
  return result;
}

/** Policy/context loss is cancellation, never a successful text-only fallback. */
export class ReplyContextChangedError extends Error {
  constructor(){super('REPLY_CONTEXT_CHANGED');}
}
