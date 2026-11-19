import {parseCommand} from './commands.js';
import type {InboundMessage} from './types.js';
import type {SystemLocale} from '../i18n/common.js';
import {systemMessage,SystemMessageError,systemErrorText} from '../i18n/system.js';
import {isPublicPythonErrorCode} from './python-worker-errors.js';
import {INPUT_LIMITS} from './limits.js';

type ImageCommandParameters = {
  prompt: string;
  width?: number;
  height?: number;
  n?: number;
};

export type DirectImageCommand =
  | {kind:'request'; operation:'image_generate'|'image_edit'; parameters:ImageCommandParameters}
  | {kind:'invalid'};

/** Options precede the prompt. Its remaining text is opaque, including line breaks and slashes. */
export function parseDirectImageCommand(text:string):DirectImageCommand|undefined {
  let command=parseCommand(text);
  if(!command){
    const explicit=/^(生图|生成图片|修图|编辑图片)[：:]\s*([\s\S]*)$/u.exec(text.trim());
    if(!explicit)return;
    command={name:explicit[1]==='生图'||explicit[1]==='生成图片'?'draw':'edit',args:explicit[2]};
  }
  if(command.name!=='draw' && command.name!=='edit')return;
  let rest=command.args;
  const parameters:ImageCommandParameters={prompt:''};
  while(rest.startsWith('--')){
    const option=/^\S+/.exec(rest)![0];
    rest=rest.slice(option.length).trimStart();
    if(option==='--')break;
    if(option==='--size' && parameters.width===undefined){
      const size=/^(\d+)[x×](\d+)(?=\s|$)/iu.exec(rest);
      if(!size)return {kind:'invalid'};
      parameters.width=Number(size[1]);parameters.height=Number(size[2]);
      rest=rest.slice(size[0].length).trimStart();
    }else if(option==='--n' && parameters.n===undefined){
      const count=/^\d+(?=\s|$)/u.exec(rest);
      if(!count)return {kind:'invalid'};
      parameters.n=Number(count[0]);
      rest=rest.slice(count[0].length).trimStart();
    }else return {kind:'invalid'};
  }
  if(!rest)return {kind:'invalid'};
  parameters.prompt=rest;
  return {kind:'request',operation:command.name==='draw'?'image_generate':'image_edit',parameters};
}

export function validateDirectImageInputs(command:DirectImageCommand,messages:InboundMessage[]):void {
  if(command.kind==='invalid')throw new SystemMessageError('directImageUsage');
  const inputs=messages.flatMap(message=>[...message.attachments,...(message.quoted?.attachments??[])]);
  if(command.operation==='image_generate'&&inputs.length)throw new SystemMessageError('directImageDrawHasMedia');
  if(command.operation==='image_edit'&&(!inputs.length||messages.some(({quoted})=>quoted?.id&&!quoted.text&&!quoted.attachments?.length)))throw new SystemMessageError('directImageEditNeedsImage');
  if(inputs.some(input=>input.kind!=='image'))throw new SystemMessageError('directImageOnlyImages');
  if(new Set(inputs.map(input=>input.handle??input)).size>INPUT_LIMITS.attachmentCount)throw new Error('MEDIA_INPUT_LIMIT');
}

export function directImageFailureText(error:unknown,locale:SystemLocale):string {
  if(error instanceof SystemMessageError)return systemErrorText(error,locale,'directImageFailed');
  const code=error instanceof Error?error.message.split(':',1)[0]:'';
  if(code==='COMFYUI_REFERENCE_SLOT_UNAVAILABLE')return systemMessage(locale,'directImageWorkflowReference');
  const hostCodes=['IMAGE_RESOLUTION_INVALID','IMAGE_BATCH_INVALID','MEDIA_INPUT_LIMIT','MEDIA_CONCURRENCY_LIMIT','MISSING_PROVIDER_KEY','COMFYUI_WORKFLOW_REQUIRED','MEDIA_PROMPT_TOO_LARGE'];
  return systemMessage(locale,'directImageFailed',{code:isPublicPythonErrorCode(code)||hostCodes.includes(code)?code:'IMAGE_REQUEST_FAILED'});
}
