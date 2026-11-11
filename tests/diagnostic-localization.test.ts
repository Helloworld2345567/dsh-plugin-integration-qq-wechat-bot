import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnostic,diagnosticFields,diagnostics,formatDiagnostic,resourceLabels} from '../src/i18n/diagnostics.js';
import {healthResultSchema} from '../src/core/service-contract.js';
import {healthViewSchema,refreshViewSchema} from '../src/core/service-management.js';
import {serviceErrorSchema,ServiceContractError} from '../src/core/service-errors.js';
import {ConflictError} from '../src/core/errors.js';
import {adminErrorPayload} from '../src/harness/admin.js';
import {voiceLibrarySettingsSchema} from '../src/core/voice-model-library.js';
import {adminCommandRequestSchema} from '../src/harness/admin-contract.js';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {SqlitePersistence} from '../src/infrastructure/sqlite/persistence.js';
import {seedAppliedConfig} from './sqlite-fixtures.js';

test('diagnostics provide complete English text with matching interpolation parameters',()=>{
  const placeholders=(text:string)=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
  for(const [key,pair] of Object.entries(diagnostics)){
    assert.ok(pair.zh&&pair.en,key);assert.doesNotMatch(pair.en,/\p{Script=Han}/u,key);
    assert.deepEqual(placeholders(pair.zh),placeholders(pair.en),key);
  }
  for(const label of Object.keys(resourceLabels)){
    const message=diagnostic('resourceUnreadable',{resource:label});
    assert.doesNotMatch(formatDiagnostic(message,'en')!,/\p{Script=Han}/u);
    assert.notEqual(formatDiagnostic(message,'zh'),formatDiagnostic(message,'en'));
  }
  assert.equal(formatDiagnostic({key:'external.unknown'},'en'),undefined);
});

test('old and localized service results pass every strict presentation schema',()=>{
  const old={state:'ready',checkedAt:100,expiresAt:200,safeDiagnostic:'legacy provider detail'};
  assert.deepEqual(healthResultSchema.parse(old),old);
  const message=diagnostic('sovitsReachable'),health=healthResultSchema.parse({...old,message});
  const view=healthViewSchema.parse({...health,serviceId:'gpt-sovits',profileId:'voice',profileRevision:1,profileContentHash:'a'.repeat(64),cached:true});
  assert.deepEqual(view.message,message);
  assert.deepEqual(refreshViewSchema.parse({serviceId:'gpt-sovits',state:'missing',registeredRoots:0,scannedRoots:0,profileCount:0,checkedAt:0,...diagnosticFields('modelsRootMissing')}).message,diagnostic('modelsRootMissing'));
  const oldError={category:'INVALID_INPUT',retryable:false,blocksService:false};
  assert.deepEqual(serviceErrorSchema.parse(oldError),oldError);
  assert.deepEqual(serviceErrorSchema.parse({...oldError,message}).message,message);
});

test('admin error responses retain text and stable descriptors without disclosing private parameters',()=>{
  const error=new ServiceContractError({category:'PROVIDER_ERROR',retryable:false,blocksService:false,...diagnosticFields('requestFailed',{detail:'token=private-value https://private.invalid/path C:\\private\\model.ckpt'})});
  const payload=adminErrorPayload(error);
  assert.doesNotMatch(JSON.stringify(payload),/private-value|private\.invalid|model\.ckpt/);
  assert.match(formatDiagnostic(payload.message,'en')!,/^Request failed:/);
  assert.equal(adminErrorPayload(new ConflictError()).message?.key,'diagnostic.conflict');
  assert.equal(adminErrorPayload(Error('UPSTREAM_FAILURE')).error,'UPSTREAM_FAILURE');
});

test('validation sends safe field names and custom reasons instead of requiring Chinese sentence matching',()=>{
  const result=voiceLibrarySettingsSchema.safeParse({modelsRoot:'relative',gptSovitsUrl:'invalid'});
  assert.equal(result.success,false);if(result.success)return;
  const payload=adminErrorPayload(result.error);
  assert.match(formatDiagnostic(payload.message,'en')!,/modelsRoot/);
  assert.ok(payload.issues?.some(issue=>formatDiagnostic(issue.message,'en')==='The directory must be an absolute path.'));
  assert.ok(payload.issues?.some(issue=>formatDiagnostic(issue.message,'en')==='Enter a valid service URL.'));
  const command=adminCommandRequestSchema.parse({version:1,kind:'command',name:'service.settings.pick-directory',input:{locale:'en'}});
  assert.equal((command.input as {locale:string}).locale,'en');
});

test('new installations receive language-neutral personas while existing persona content survives reopening',async t=>{
  const root=await mkdtemp(path.resolve('.codex/i18n-seed-'));let store=new SqlitePersistence(path.join(root,'store'),path.join(root,'personas'));
  t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
  for(const id of ['default','sakura'])assert.match(store.personas.config(id).personaPrompt,/Follow the language of the user and conversation/);
  assert.match(store.personas.config('sakura').personaPrompt,/adult catgirl.*silver-white hair/);
  const original={...store.personas.config('default'),name:'我的中文人格',personaPrompt:'始终使用中文。用户自己保存的内容。'};
  seedAppliedConfig(store,original);store.close();store=new SqlitePersistence(path.join(root,'store'),path.join(root,'personas'));
  assert.equal(store.personas.config('default').name,original.name);assert.equal(store.personas.config('default').personaPrompt,original.personaPrompt);
});
