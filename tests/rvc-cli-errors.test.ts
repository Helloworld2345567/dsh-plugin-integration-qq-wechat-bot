import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {RvcCliServiceAdapter} from '../src/core/rvc-cli-adapter.js';
import {ProfileStore} from '../src/core/profile-store.js';
import {ServiceContractError} from '../src/core/service-errors.js';
import type {ControlledProcessPort} from '../src/harness/controlled-process.js';

const managed={protocol:'rvc_cli_v1',python:'C:/managed/python.exe',rvcRoot:'C:/managed/rvc',device:'cuda',modelVersion:'v2',singingModelId:'voice',singingWeightsPath:'C:/managed/voice.pth',speakerId:0,pitchShift:0,indexRate:0};
const scenarios=[
  {name:'nonzero exit preserves a valid failure',code:1,status:{status:'failed',error:{code:'SINGING_MODEL_INCOMPATIBLE'}},expected:'SINGING_MODEL_INCOMPATIBLE'},
  {name:'zero exit still rejects a valid failure',code:0,status:{status:'failed',error:{code:'SINGING_MODEL_INCOMPATIBLE'}},expected:'SINGING_MODEL_INCOMPATIBLE'},
  {name:'nonzero exit cannot succeed',code:1,status:{status:'succeeded'},expected:'SINGING_INFERENCE_FAILED'},
  {name:'nonzero exit without status',code:1,expected:'SINGING_INFERENCE_FAILED'},
  {name:'nonzero exit with invalid JSON',code:1,status:'invalid JSON',expected:'SINGING_INFERENCE_FAILED'},
  {name:'nonzero exit with unknown status',code:1,status:{status:'running',error:{code:'SINGING_MODEL_INCOMPATIBLE'}},expected:'SINGING_INFERENCE_FAILED'},
  {name:'nonzero exit with incomplete failure',code:1,status:{status:'failed'},expected:'SINGING_INFERENCE_FAILED'},
  {name:'nonzero exit with unsafe error code',code:1,status:{status:'failed',error:{code:'SINGING_FAILED:private-token'}},expected:'SINGING_INFERENCE_FAILED'},
  {name:'zero exit without status stays unknown',code:0,expected:'RVC_CLI_STATE_UNKNOWN'},
];

test('RVC CLI preserves valid runner failure codes while rejecting incomplete or contradictory completion',async t=>{
  for(const scenario of scenarios)await t.test(scenario.name,async t=>{
    await mkdir(path.resolve('.codex'),{recursive:true});const root=await mkdtemp(path.resolve('.codex/rvc-cli-errors-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const input=path.join(root,'input.wav');await writeFile(input,'input');let calls=0;
    const processes:ControlledProcessPort={run:async()=>{calls++;const record=JSON.parse(await readFile(path.join(root,'rvc-job.json'),'utf8'));await writeFile(record.output,'wav');if(scenario.status!==undefined)await writeFile(record.status,typeof scenario.status==='string'?scenario.status:JSON.stringify(scenario.status));return{code:scenario.code,stdout:Buffer.from('private provider diagnostics')};},cancel:async()=> 'cancelled'};
    const adapter=new RvcCliServiceAdapter(processes),profile=new ProfileStore().create({serviceId:'rvc',profileId:'managed',state:'ready',capabilities:['rvc.convert'],displayName:'RVC',managedConfig:managed});
    await assert.rejects(adapter.execute({jobId:'fixture',operation:'rvc.convert',profile,inputHandles:['asset'],inputs:[{handle:'asset',kind:'audio',path:input,name:'input.wav',mime:'audio/wav'}],parameters:{sourceType:'vocals',format:'mp3'},outputDirectory:root,idempotencyKey:'fixture',deadline:Date.now()+30_000},new AbortController().signal),error=>{
      assert.ok(error instanceof ServiceContractError);assert.equal(error.serviceError.providerCode,scenario.expected);assert.equal(error.serviceError.category,scenario.expected==='RVC_CLI_STATE_UNKNOWN'?'UNKNOWN_STATE':'PROVIDER_ERROR');assert.doesNotMatch(error.message,/private|managed|input.wav/);return true;
    });
    assert.equal(calls,1,'a failed runner never starts output encoding');
  });
});
