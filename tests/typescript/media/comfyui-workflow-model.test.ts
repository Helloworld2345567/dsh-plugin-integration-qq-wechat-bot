import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {inspectComfyWorkflowModel,readComfyWorkflowModel,UNKNOWN_COMFY_WORKFLOW_MODEL} from '../../../src/core/comfyui-workflow-model.js';

const node=(class_type:string,inputs:Record<string,unknown>)=>({class_type,inputs});
const workflow=(name:string,type='UNETLoader',field='unet_name')=>({
  '1':node(type,{[field]:name}),
  '2':node('Lora Loader (LoraManager)',{model:['1',0],lora_name:'unrelated-style.safetensors'}),
  '3':node('KSampler',{model:['2',0],positive:['6',0]}),
  '4':node('VAEDecode',{samples:['3',0]}),
  '5':node('Image Saver Simple',{images:['4',0]}),
  '6':node('CLIPTextEncode',{text:'draw anything',clip:['7',0]}),
  '7':node('CLIPLoader',{clip_name:'qwen.safetensors'}),
});

test('identifies Anima and Krea 2 checkpoint families and variants through model adapters',()=>{
  for(const [name,family,variant,type,field] of [
    ['anima_baseV10.safetensors','anima','base','UNETLoader','unet_name'],
    ['Anima-Aesthetic-v1.0.safetensors','anima','aesthetic','CheckpointLoaderSimple','ckpt_name'],
    ['anima_turbo-Q8_0.gguf','anima','turbo','UnetLoaderGGUF','unet_name'],
    ['krea2_turbo_nvfp4.safetensors','krea2','turbo','UNet loader with Name (Image Saver)','unet_name'],
    ['krea-2-raw.safetensors','krea2','raw','DiffusionModelLoader','model_name'],
    ['anima-preview.safetensors','anima','unknown','UNETLoader','unet_name'],
  ])assert.deepEqual(inspectComfyWorkflowModel(workflow(name,type,field)),{family,variant,checkpoints:[name]});
});

test('uses saved image ancestors and ignores workflow text, idle loaders and metadata branches',()=>{
  const graph:Record<string,ReturnType<typeof node>>=workflow('krea2_turbo_nvfp4.safetensors');
  graph['5'].inputs.metadata=['8',0];
  graph['6'].inputs.text='Anima aesthetic masterpiece';
  graph['7'].inputs.clip_name='anima_base.safetensors';
  graph['8']=node('UNETLoader',{unet_name:'anima_base.safetensors'});
  graph['9']=node('CheckpointLoaderSimple',{ckpt_name:'anima_aesthetic.safetensors'});
  graph['10']=node('SAMLoader',{model_name:'anima_turbo.safetensors'});
  graph['3'].inputs.detector=['10',0];
  assert.deepEqual(inspectComfyWorkflowModel({prompt:graph,client_id:'fixture'}),{family:'krea2',variant:'turbo',checkpoints:['krea2_turbo_nvfp4.safetensors']});
  assert.equal(inspectComfyWorkflowModel(workflow('animagine-xl.safetensors')).family,'unknown');
  assert.equal(inspectComfyWorkflowModel(workflow('anima_turbo.safetensors','LoraLoader','lora_name')).family,'unknown');
  assert.equal(inspectComfyWorkflowModel(workflow('krea2_turbo.safetensors','UpscaleModelLoader','model_name')).family,'unknown');
});

test('returns path-free immutable model information',()=>{
  for(const name of ['D:\\models\\Anima\\anima_baseV10.safetensors','/models/anima_baseV10.safetensors']){
    const result=inspectComfyWorkflowModel(workflow(name));
    assert.deepEqual(result,{family:'anima',variant:'base',checkpoints:['anima_baseV10.safetensors']});
    assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.checkpoints));
  }
  assert.ok(Object.isFrozen(UNKNOWN_COMFY_WORKFLOW_MODEL));assert.ok(Object.isFrozen(UNKNOWN_COMFY_WORKFLOW_MODEL.checkpoints));
});

test('keeps conflicting or unresolved loaders unknown instead of choosing one',()=>{
  const graph:Record<string,ReturnType<typeof node>>=workflow('anima_baseV10.safetensors');
  graph['8']=node('UNETLoader',{unet_name:'krea2_turbo.safetensors'});
  graph['3'].inputs.other_model=['8',0];
  assert.deepEqual(inspectComfyWorkflowModel(graph),{family:'unknown',variant:'unknown',checkpoints:['anima_baseV10.safetensors','krea2_turbo.safetensors']});
  graph['8'].inputs.unet_name='anima_aesthetic.safetensors';
  assert.equal(inspectComfyWorkflowModel(graph).family,'anima');assert.equal(inspectComfyWorkflowModel(graph).variant,'unknown');
  graph['8'].inputs.unet_name=['9',0];graph['9']=node('PrimitiveString',{value:'krea2_turbo.safetensors'});
  assert.equal(inspectComfyWorkflowModel(graph).family,'unknown');
  graph['8'].inputs.unet_name='unrecognized.safetensors';
  assert.equal(inspectComfyWorkflowModel(graph).family,'unknown');
});

test('reads valid API files while missing, invalid or oversized workflows return unknown',async t=>{
  await mkdir(path.resolve('.codex'),{recursive:true});
  const root=await mkdtemp(path.resolve('.codex/comfy-model-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const file=path.join(root,'anima-misleading-workflow-name.json');
  assert.equal(readComfyWorkflowModel(file),UNKNOWN_COMFY_WORKFLOW_MODEL);
  for(const content of ['', '{', JSON.stringify({nodes:[]}), ' '.repeat(4*1024*1024+1)]){
    await writeFile(file,content);assert.equal(readComfyWorkflowModel(file),UNKNOWN_COMFY_WORKFLOW_MODEL);
  }
  await writeFile(file,JSON.stringify(workflow('krea2_turbo_nvfp4.safetensors')));
  assert.deepEqual(readComfyWorkflowModel(file),{family:'krea2',variant:'turbo',checkpoints:['krea2_turbo_nvfp4.safetensors']});
  assert.equal(readComfyWorkflowModel(root),UNKNOWN_COMFY_WORKFLOW_MODEL);
  for(const invalid of [null,[],{}, {nodes:[]}, {'1':{class_type:'UNETLoader'}}, {'1':node('UNETLoader',{unet_name:'anima_base.safetensors'})}])assert.equal(inspectComfyWorkflowModel(invalid),UNKNOWN_COMFY_WORKFLOW_MODEL);
});
