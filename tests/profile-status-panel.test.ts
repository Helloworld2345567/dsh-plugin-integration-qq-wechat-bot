import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currentProfileAcceptance,currentProfileHealth,currentProfileValidation} from '../src/client/profile-status.js';
import {singingCard} from '../src/client/singing.js';
import {createUI} from '../src/client/ui.js';
import {configSchema} from '../src/core/types.js';
import type {AcceptanceView,HealthView,PublicServiceProfile} from '../src/core/service-management.js';

const profile:PublicServiceProfile={serviceId:'rvc',profileId:'klee',revision:3,contentHash:'a'.repeat(64),state:'ready',capabilities:['rvc.convert'],displayName:'可莉',updatedAt:1};
const persona=configSchema.parse({schemaVersion:4,id:'first',name:'First',revision:2,personaPrompt:'Persona',media:{singing:{enabled:true,profileRef:{serviceId:'rvc',profileId:'klee'}}}});
const acceptance:AcceptanceView={serviceId:'rvc',profileId:'klee',profileRevision:3,profileContentHash:profile.contentHash,personaId:'first',personaRevision:2,operation:'rvc.convert',state:'PASS',expiresAt:2000};
const health:HealthView={serviceId:'rvc',profileId:'klee',profileRevision:3,profileContentHash:profile.contentHash,state:'ready',checkedAt:100,expiresAt:2000,cached:false};
const status={revision:2,profileRef:{serviceId:'rvc',profileId:'klee'},profileRevision:3,profileContentHash:profile.contentHash,conversionValidation:{status:'PASS'}};

test('acceptance views require the exact persona, Profile, and operation binding',()=>{
  assert.equal(currentProfileAcceptance(acceptance,persona,profile,'rvc.convert',1000)?.state,'PASS');
  for(const next of [{...persona,id:'second'},{...persona,revision:3}])assert.equal(currentProfileAcceptance(acceptance,next,profile,'rvc.convert',1000),undefined);
  for(const next of [{...profile,profileId:'hutao'},{...profile,revision:4},{...profile,contentHash:'b'.repeat(64)}])assert.equal(currentProfileAcceptance(acceptance,persona,next,'rvc.convert',1000),undefined);
  assert.equal(currentProfileAcceptance(acceptance,persona,profile,'gpt-sovits.speak',1000),undefined);
  assert.equal(currentProfileAcceptance(acceptance,persona,profile,'rvc.convert',2000)?.state,'EXPIRED');
  assert.equal(acceptance.state,'PASS');
});

test('health and status fallback cannot outlive or cross the revisions they checked',()=>{
  assert.equal(currentProfileHealth(health,profile,1000)?.state,'ready');
  assert.equal(currentProfileHealth(health,profile,2000)?.state,'unknown');
  assert.equal(currentProfileHealth(health,{...profile,revision:4},1000),undefined);
  assert.equal(currentProfileValidation(status,persona,profile,'conversionValidation')?.status,'PASS');
  assert.equal(currentProfileValidation(status,{...persona,revision:3},profile,'conversionValidation'),undefined);
  assert.equal(currentProfileValidation(status,persona,{...profile,contentHash:'b'.repeat(64)},'conversionValidation'),undefined);
});

test('singing card never displays cached PASS for another persona or saved revision',()=>{
  const React={createElement:(type:any,props:any,...children:any[])=>({type,props,children})},ui=createUI(React,false,()=>{}),valid={...acceptance,expiresAt:Date.now()+60_000};
  const render=(config:typeof persona,summary:any,cached:AcceptanceView|undefined=valid)=>JSON.stringify(singingCard(React.createElement,ui,config,false,summary,[profile],{}, {'singing:rvc/klee':cached},()=>{},async()=>{},async()=>null,async()=>{},async()=>{}));
  assert.match(render(persona,status),/acceptance 已通过/);
  assert.match(render({...persona,id:'second'},undefined),/acceptance 尚未验收/);
  assert.match(render({...persona,revision:3},status),/acceptance 尚未验收/);
  assert.match(render(persona,{...status,profileRevision:2},{...valid,profileRevision:2}),/acceptance 尚未验收/);
});
