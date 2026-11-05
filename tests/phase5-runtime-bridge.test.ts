import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {Assets,MediaService} from '../src/core/media.js';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {ProfileStore} from '../src/core/profile-store.js';
import {botSchema,v4ConfigSchema,type CallerScope} from '../src/core/types.js';
import {freezeTurn} from '../src/core/policy.js';
import type {MediaWorkerJob,WorkerPort} from '../src/core/worker-port.js';

const scope:CallerScope={botId:'bot',platform:'qq',accountId:'account',kind:'private',channelId:'owner',senderId:'owner'};
test('v4 executes the frozen profile through ServiceRuntime without the generic worker',async t=>{await mkdir(path.resolve('.codex'),{recursive:true});const home=await mkdtemp(path.resolve('.codex/phase5-runtime-bridge-')),store=new SqlitePersistence(home,path.join(home,'personas')),assets=new Assets(store.repositories());assets.workspace=async()=>path.join(home,'workspace');const profiles=new ProfileStore(),profile=profiles.create({serviceId:'gpt-sovits',profileId:'default',state:'ready',capabilities:['gpt-sovits.speak'],displayName:'Voice',managedConfig:{private:'managed'}}),bot=store.bots.saveBot(botSchema.parse({id:'bot',name:'Bot',channel:'qq',accountId:'account',enabled:true}));t.after(async()=>{store.close();await rm(home,{recursive:true,force:true});});let workerCalls=0,serviceCalls=0,captured:any;
  const worker:WorkerPort={run:async(job:MediaWorkerJob)=>{workerCalls++;assert.equal(job.operation,'voice_speak');const file=path.join(job.output,'legacy.wav');await writeFile(file,'legacy');return{assets:[{path:file,name:'legacy.wav',mime:'audio/wav',kind:'audio'}]};}},serviceRuntime={execute:async(request:any)=>{serviceCalls++;captured=request;const file=path.join(request.outputDirectory,'profile.wav');await writeFile(file,'profile');return{outputs:[{kind:'audio',path:file,relativePath:'profile.wav',size:7,mime:'audio/wav',metadata:{}}]};}};
  const media=new MediaService(store.repositories(),assets,'python',undefined,worker,undefined,undefined,serviceRuntime as any);
  const current=v4ConfigSchema.parse({schemaVersion:4,id:'current',name:'Current',personaPrompt:'A',skills:['voice-generation'],tools:['bot_voice'],media:{voice:{enabled:true,profileRef:{serviceId:'gpt-sovits',profileId:'default'},replyMode:'on_demand',format:'wav'}}}),snapshot=freezeTurn(current,bot,scope,['source'],profiles);await media.run('v4-scope','voice_speak',current,[],{text:'profile',baseUrl:'http://evil.invalid',outputDirectory:'C:/evil'},new AbortController().signal,undefined,snapshot);assert.equal(workerCalls,0);assert.equal(serviceCalls,1);assert.equal(captured.operation,'gpt-sovits.speak');assert.equal(captured.profileRevision,profile.revision);assert.equal(captured.profileContentHash,profile.contentHash);assert.deepEqual(captured.inputHandles,[]);assert.notEqual(captured.outputDirectory,'C:/evil');assert.deepEqual(captured.parameters,{text:'profile',format:'wav'});
});
