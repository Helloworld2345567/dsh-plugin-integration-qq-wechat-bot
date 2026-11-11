/** Shared, browser-safe language primitives. User content is never translated. */
export type SystemLocale = 'zh' | 'en';
export interface MessageDescriptor {key:string;params?:Record<string,string|number>}
export interface DiagnosticDetail {text:string;message?:MessageDescriptor}

export function interpolate(template:string,params?:Record<string,unknown>):string {
  return params ? template.replace(/\{(\w+)\}/g,(match,key)=>Object.hasOwn(params,key)?String(params[key]):match) : template;
}
