import {chinese,errorText,uiError,type DisplayText,type Translate} from './locale.js';

export type Api = (action:string,input?:any,signal?:AbortSignal)=>Promise<any>;
export type Mutation = (action:string,input?:any,message?:DisplayText)=>Promise<any>;

export const botStatus=(status:string,t:Translate=chinese)=>({connected:t('online'),connecting:t('connecting'),stopped:t('stopped'),error:t('error'),disconnected:t('offline'),reconnecting:t('reconnecting')}[status]??t('notConnected'));
export const list=(value:unknown):string[]=>Array.isArray(value)?value:[];

export function createUI(React:any,busy:boolean,onError:(message:any)=>void){
  const h=React.createElement;
  const run=(action:()=>unknown)=>{Promise.resolve().then(action).catch((error:Error)=>onError(errorText(error)));};
  const button=(label:string|any[],action:()=>unknown,props:any={})=>h('button',{type:'button',disabled:busy,onClick:()=>run(action),...props},label);
  const toggle=(label:string,checked:boolean,action:()=>unknown,props:any={})=>h('div',{className:'toggle-row'},
    h('span',null,label),h('button',{type:'button',role:'switch','aria-label':label,'aria-checked':checked,
      className:'toggle',disabled:busy,onClick:()=>run(action),...props},h('span',{className:'toggle-thumb','aria-hidden':true})));
  const field=(label:string,value:any,change:(value:string)=>void,type='text',props:any={})=>h('label',null,label,
    h('input',{type,disabled:busy,value:value??'',onChange:(event:any)=>change(event.target.value),...props}));
  const select=(label:string,value:string,options:any[],change:(value:string)=>unknown,props:any={})=>h('label',null,label,
    h('select',{value,disabled:busy,onChange:(event:any)=>{const next=event.target.value;run(()=>change(next));},...props},...[...(value&&!options.some(o=>o.id===value)?[{id:value,name:value}]:[]),...options].map(o=>h('option',{key:o.id,value:o.id,disabled:o.disabled},o.name??o.id))));
  const textarea=(label:string,value:string,change:(value:string)=>void,props:any={})=>h('label',{className:'full'},label,
    h('textarea',{value:value??'',disabled:busy,rows:4,onChange:(event:any)=>change(event.target.value),...props}));
  const details=(label:string,...children:any[])=>h('details',null,h('summary',null,label),h('div',{className:'detail-body'},...children));
  return {button,toggle,field,select,textarea,details};
}

export function dateInput(timestamp:number,timezone:string):string{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(timestamp);
  const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// datetime-local has no timezone. Interpret it in the selected zone, not the browser zone.
export function scheduledTime(value:string,timezone:string,t:Translate=chinese):number{
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw uiError('chooseRunTime',t);
  const wall=Date.parse(value+'Z');let instant=wall;
  if(!Number.isFinite(wall))throw uiError('invalidRunTime',t);
  for(let i=0;i<4;i++){
    const rendered=dateInput(instant,timezone);
    if(rendered===value)return instant;
    instant+=wall-Date.parse(rendered+'Z');
  }
  throw uiError('timeNotInZone',t);
}
