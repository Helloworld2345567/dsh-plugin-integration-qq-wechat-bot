import {zh} from '../i18n/ui.zh.js';
import {en} from '../i18n/ui.en.js';
import type {MessageDescriptor,SystemLocale} from '../i18n/common.js';
import {formatDiagnostic} from '../i18n/diagnostics.js';
import {formatSystemMessage} from '../i18n/system.js';

export {zh,en};
export const LOCALE_NS='botIntegration';
export type LocaleKey=keyof typeof zh;
export type Translate=(key:LocaleKey,params?:Record<string,unknown>)=>string;
export interface ValidationMessage {path:string;message:MessageDescriptor}
export type DisplayText=string|(MessageDescriptor&{fallback?:string;issues?:ValidationMessage[]});
export const message=(key:LocaleKey,params?:Record<string,string|number>):MessageDescriptor=>({key:`ui.${key}`,...params?{params}:{}});
export const translator=(locale:SystemLocale):Translate=>(key,params)=>{
  const template=(locale==='en'?en:zh)[key]??en[key]??key;
  return params?template.replace(/\{(\w+)\}/g,(match,name)=>name in params?String(params[name]):match):template;
};
export const chinese=translator('zh');
export const english=translator('en');
export const displayLocale=(locale?:string):SystemLocale=>locale?.startsWith('en')?'en':'zh';
export function renderText(value:DisplayText|undefined,t:Translate=chinese,locale:SystemLocale='zh'):string{
  if(typeof value==='string')return value;
  if(!value)return '';
  const summary=value.key.startsWith('ui.')?t(value.key.slice(3) as LocaleKey,value.params):formatDiagnostic(value,locale)??formatSystemMessage(value,locale)??value.fallback??value.key;
  return [summary,...value.issues?.map(issue=>`${issue.path}: ${renderText(issue.message,t,locale)}`)??[]].join('\n');
}
export class PanelError extends Error {
  constructor(text:string,readonly localizedMessage?:MessageDescriptor,readonly issues?:ValidationMessage[]){super(text);this.name='PanelError';}
}
export function uiError(key:LocaleKey,t:Translate=chinese):PanelError{return new PanelError(t(key),message(key));}
export function errorText(error:unknown):DisplayText{
  const descriptor=(error as {localizedMessage?:MessageDescriptor}|undefined)?.localizedMessage;
  if(descriptor?.key)return {...descriptor,fallback:error instanceof Error?error.message:undefined,issues:(error as PanelError).issues};
  return error instanceof Error?error.message:String(error);
}
/** Diagnostics remain raw when they originate outside this package. */
export function diagnosticText(value:{message?:MessageDescriptor;safeDiagnostic?:string}|undefined,locale:SystemLocale='zh'):string|undefined{
  return formatDiagnostic(value?.message,locale)??value?.safeDiagnostic;
}
export function reportDiagnostics(report:any,locale:SystemLocale='zh'):string|undefined{
  return report?.diagnosticDetails?.map((item:any)=>formatDiagnostic(item.message,locale)??item.text).join('\n')??report?.diagnostics?.join('\n');
}
