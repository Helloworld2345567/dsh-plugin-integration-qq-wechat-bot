import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceStoragePanel} from '../../../src/client/workspace-storage-panel.js';
import {chinese} from '../../../src/client/locale.js';

const nodes=(node:any):any[]=>Array.isArray(node)?node.flatMap(nodes):node&&typeof node==='object'?[node,...(node.children??[]).flatMap(nodes)]:[];
test('storage cleanup submits only previewed eligible IDs after confirmation and reports skipped changes',async()=>{
  const items=[{id:'old',name:'old.png',kind:'image',origin:'generated',size:100,createdAt:1,pinned:false},{id:'kept',name:'kept.png',kind:'image',origin:'received',size:200,createdAt:1,pinned:true,protection:'retained'}];
  const report={items,total:{count:2,bytes:300},matched:{count:2},reclaimable:{count:1,bytes:100},groups:[],hasMore:false};
  const states:any[]=[{kind:'',origin:'',before:'',offset:0},report,false,0];let cursor=0;
  const React={Fragment:'fragment',createElement:(type:any,props:any,...children:any[])=>({type,props,children}),useState:(initial:any)=>{const index=cursor++;if(!(index in states))states[index]=initial;return[states[index],(value:any)=>{states[index]=typeof value==='function'?value(states[index]):value;}];},useEffect:()=>{}};
  const calls:any[]=[],questions:string[]=[],notices:string[]=[],errors:any[]=[];
  const props={React,t:chinese,botId:'bot',query:async()=>report,api:async(name:string,input:any)=>{calls.push({name,input});return {count:0,bytes:0,skipped:[{id:'old',reason:'delivery'}]};},confirm:async(question:string)=>{questions.push(question);return true;},onError:(error:any)=>errors.push(error),onNotice:(notice:string)=>notices.push(notice)};
  const tree=nodes(WorkspaceStoragePanel(props));
  tree.find(node=>node.type==='button'&&node.children[0]==='清理本页可清理附件').props.onClick();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[{name:'workspace.cleanup',input:{botId:'bot',assetIds:['old']}}]);assert.match(questions[0],/1 个附件/);assert.match(notices[0],/跳过 1 项/);assert.deepEqual(errors,[]);
  calls.length=0;cursor=0;const next=nodes(WorkspaceStoragePanel(props));
  next.find(node=>node.props?.['aria-label']==='保留 kept.png').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[{name:'workspace.pin',input:{botId:'bot',assetId:'kept',pinned:false}}]);
});
