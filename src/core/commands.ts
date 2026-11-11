import type {SystemLocale} from '../i18n/common.js';
import {systemMessage} from '../i18n/system.js';
/** Channel command parsing never normalizes arguments or dispatches arbitrary tool names. */
export interface ParsedCommand {name:string;args:string}
export function parseCommand(text:string):ParsedCommand|undefined {
  const value=text.trim().replace(/^\[(.*)\]$/s,'$1');
  if(value.startsWith('//'))return undefined;
  const match=/^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(value);
  return match?{name:match[1].toLowerCase(),args:match[2]?.trim()??''}:undefined;
}
export function unescapeChat(text:string):string {return text.trimStart().startsWith('//')?text.replace(/^(\s*)\//,'$1'):text;}
export function commandHelp(privileged:boolean,hostTools=privileged,locale:SystemLocale='zh'):string {
  return systemMessage(locale,'helpBasic')+(privileged?systemMessage(locale,'helpTrusted'):'')+(privileged&&hostTools?systemMessage(locale,'helpHost'):'')+systemMessage(locale,'helpNatural');
}
