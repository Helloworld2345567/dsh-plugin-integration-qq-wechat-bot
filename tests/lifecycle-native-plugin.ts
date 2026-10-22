import type {Context} from '@deepseek-ai/cordis';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {LifecycleJournal,type EvolutionTask} from '../src/lifecycle/protocol.js';

export const name='bot-lifecycle-native-fixture';
export const inject=['pluginManager'];
export function apply(ctx:Context):void{
  const folder=process.env.LIFECYCLE_NATIVE_FOLDER!;const fixture=JSON.parse(readFileSync(path.join(folder,'fixture.json'),'utf8'));
  const journal=new LifecycleJournal(fixture.home);const result=path.join(folder,'result.json');let running=false;let instance:unknown;
  const timer=setInterval(()=>{if(running)return;running=true;
    try{
      const current=(globalThis as any)[Symbol.for('sakura.lifecycle.coordinator')];if(!instance)instance=current;
      const task=journal.read('native-upgrade');
      if(task.phase==='failed'||task.phase==='rolled-back')throw Error(`Native upgrade failed: ${JSON.stringify(task)}`);
      if(task.phase!=='succeeded')return;
      if(instance&&current!==instance)throw Error('Coordinator was recreated during bot unload');
      let failure:EvolutionTask|undefined;try{failure=journal.read('native-failure');}catch{}
      if(!failure){journal.write({id:'native-failure',kind:'upgrade',scopeKey:'fixture',configId:'fixture',goal:'Inject activation failure to verify rollback',phase:'queued',createdAt:Date.now(),updatedAt:Date.now(),artifact:fixture.broken,previous:fixture.next,events:[]});return;}
      if(failure.phase==='failed')throw Error(`Automatic rollback failed: ${JSON.stringify(failure)}`);
      if(failure.phase!=='rolled-back')return;
      const trace=readFileSync(path.join(folder,'trace.txt'),'utf8');if(!trace.includes('old:dispose')||!trace.includes('next:ready')||!trace.includes('old:drain'))throw Error(`Missing drain/unload/activation trace: ${trace}`);
      if(instance&&current!==instance)throw Error('Independent coordinator did not survive rollback');
      writeFileSync(result,JSON.stringify({status:'PASS',upgrade:task.phase,activationMode:task.events.some(event=>event.phase==='restarting')?'supervised-restart':'hot-reload',rollback:failure.phase,rollbackAttempted:failure.rollbackAttempted,coordinatorSurvived:true,trace},null,2));clearInterval(timer);
    }catch(error){writeFileSync(result,JSON.stringify({status:'FAIL',error:String(error)},null,2));clearInterval(timer);}finally{running=false;}
  },100);ctx.effect(()=>()=>clearInterval(timer));
}
