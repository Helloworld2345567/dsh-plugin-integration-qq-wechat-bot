import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installHostLeaveGuard} from '../src/client/host-leave-guard.js';

const settle=()=>new Promise(resolve=>setImmediate(resolve));

function fixture(){
  const listeners=new Map<string,Set<(event:any)=>void>>();
  const view={
    addEventListener(type:string,listener:(event:any)=>void,capture:boolean){assert.equal(capture,true);const list=listeners.get(type)??new Set();list.add(listener);listeners.set(type,list);},
    removeEventListener(type:string,listener:(event:any)=>void,capture:boolean){assert.equal(capture,true);listeners.get(type)?.delete(listener);},
  };
  const document:any={defaultView:view,activeElement:null,querySelectorAll:()=>layers};
  class Element{
    isConnected=true;clicks=0;parentElement:Element|null=null;children:Element[]=[];attrs:Record<string,string>={};
    ownerDocument=document;
    constructor(readonly name:string,readonly tag='div'){}
    append(...children:Element[]){for(const child of children){child.parentElement=this;this.children.push(child);}return this;}
    contains(target:Element):boolean{return target===this||this.children.some(child=>child.contains(target));}
    getAttribute(name:string){return this.attrs[name]??null;}
    closest(selector:string):Element|null{if(selector==='button'&&this.tag==='button'||selector==='[data-shortcut-modal="settings"]'&&this===host)return this;return this.parentElement?.closest(selector)??null;}
    querySelector(selector:string):Element|null{
      if(this===host&&selector===':scope > nav')return nav;
      if(this===host&&selector===':scope > div > div:first-child > button')return close;
      if(this===overlay&&selector===':scope > [aria-hidden="true"]')return mask;
      return null;
    }
    focus(){document.activeElement=this;}
    click(){const event=dispatch('click',this);if(!event.stopped)this.clicks++;return event;}
  }
  const overlay=new Element('overlay'),host=new Element('settings'),nav=new Element('navigation','nav'),close=new Element('close','button'),mask=new Element('mask');
  const current=new Element('current','button'),other=new Element('other','button'),panel=new Element('panel'),field=new Element('field','input');
  current.attrs['aria-current']='true';overlay.append(mask,host);host.append(nav,close,panel);nav.append(current,other);panel.append(field);field.focus();
  let layers:Element[]=[host],dirty=true,dialogOpen=false,confirmations=0;
  let resolveConfirmation!:(accepted:boolean)=>void;
  const errors:unknown[]=[];
  const dispatch=(type:string,target:Element,properties:Record<string,any>={})=>{
    const event={type,target,button:0,key:'Escape',isComposing:false,ctrlKey:false,altKey:false,metaKey:false,shiftKey:false,repeat:false,prevented:false,stopped:false,...properties,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
    for(const listener of listeners.get(type)??[])listener(event);
    return event;
  };
  const dispose=installHostLeaveGuard(panel as unknown as HTMLElement,{hasUnsaved:()=>dirty,dialogOpen:()=>dialogOpen,confirmLeave:()=>{confirmations++;return new Promise(resolve=>{resolveConfirmation=resolve;});},onError:error=>errors.push(error)});
  return{host,panel,close,mask,current,other,field,listeners,document,dispose,dispatch,errors,get confirmations(){return confirmations;},setDirty(value:boolean){dirty=value;},setDialog(value:boolean){dialogOpen=value;layers=value?[host,panel]:[host];},async answer(value:boolean){resolveConfirmation(value);await settle();}};
}

test('clean host controls and panel controls keep their original behavior',()=>{
  const f=fixture();f.setDirty(false);
  for(const target of [f.close,f.other,f.mask])assert.equal(target.click().prevented,false);
  assert.equal(f.dispatch('keydown',f.field).prevented,false);
  f.setDirty(true);assert.equal(f.field.click().prevented,false);assert.equal(f.current.click().prevented,false);
  assert.equal(f.confirmations,0);f.dispose();
});

test('host close cancellation preserves the field and acceptance replays exactly once',async()=>{
  const f=fixture();const first=f.close.click();assert.equal(first.prevented,true);assert.equal(first.stopped,true);
  await settle();assert.equal(f.confirmations,1);await f.answer(false);
  assert.equal(f.close.clicks,0);assert.equal(f.document.activeElement,f.field);
  f.close.click();await settle();await f.answer(true);
  assert.equal(f.confirmations,2);assert.equal(f.close.clicks,1);f.dispose();
});

test('host navigation and mask preserve their respective accepted gestures',async()=>{
  for(const name of ['other','mask'] as const){
    const f=fixture();assert.equal(f[name].click().stopped,true);await settle();await f.answer(true);
    assert.equal(f[name].clicks,1);assert.equal(f.close.clicks,0);assert.equal(f.confirmations,1);f.dispose();
  }
});

test('Escape guards only the host modal and leaves internal confirmations untouched',async()=>{
  const f=fixture();
  for(const properties of [{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true},{isComposing:true},{key:'Tab'}])assert.equal(f.dispatch('keydown',f.field,properties).prevented,false);
  f.setDialog(true);assert.equal(f.dispatch('keydown',f.field).prevented,false);assert.equal(f.close.click().prevented,true);await settle();assert.equal(f.confirmations,0);
  f.setDialog(false);assert.equal(f.dispatch('keydown',f.field,{repeat:true}).prevented,true);assert.equal(f.confirmations,0);
  assert.equal(f.dispatch('keydown',f.field).prevented,true);await settle();await f.answer(true);
  assert.equal(f.close.clicks,1);f.dispose();
});

test('duplicate leave attempts share one confirmation and unmount cancels pending replay',async()=>{
  const f=fixture();f.close.click();f.other.click();f.mask.click();await settle();assert.equal(f.confirmations,1);
  f.dispose();await f.answer(true);assert.equal(f.close.clicks,0);assert.equal(f.other.clicks,0);assert.equal(f.mask.clicks,0);
  assert.equal(f.listeners.get('click')?.size,0);assert.equal(f.listeners.get('keydown')?.size,0);
  assert.equal(f.close.click().prevented,false);
});
