import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';

export interface ComfyWorkflowModel {
  readonly family:'anima'|'krea2'|'unknown';
  readonly variant:'base'|'aesthetic'|'turbo'|'raw'|'unknown';
  readonly checkpoints:readonly string[];
}

export const UNKNOWN_COMFY_WORKFLOW_MODEL:Readonly<ComfyWorkflowModel>=Object.freeze({family:'unknown',variant:'unknown',checkpoints:Object.freeze([])});
type Node={class_type:string;inputs:Record<string,unknown>};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const normalizedType=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');

function identify(checkpoint:string):Pick<ComfyWorkflowModel,'family'|'variant'> {
  const name=checkpoint.toLowerCase();
  const family=/(?:^|[ _.-])anima(?=[ _.-]|$)/.test(name)?'anima':/(?:^|[ _.-])krea[ _.-]*2(?=[ _.-]|$)/.test(name)?'krea2':'unknown';
  const variants=(family==='anima'?['base','aesthetic','turbo']:family==='krea2'?['raw','turbo']:[])
    .filter(variant=>new RegExp(`(?:^|[ _.-])${variant}(?=v?\\d|[ _.-]|$)`).test(name));
  return {family,variant:variants.length===1?variants[0] as ComfyWorkflowModel['variant']:'unknown'};
}

/** Infer only from checkpoint names on the image-producing branch, never prompt text or workflow names. */
export function inspectComfyWorkflowModel(workflow:unknown):Readonly<ComfyWorkflowModel> {
  if(!record(workflow))return UNKNOWN_COMFY_WORKFLOW_MODEL;
  const nodes=record(workflow.prompt)?workflow.prompt:workflow;
  const entries=Object.entries(nodes);
  if(!entries.length||entries.some(([,node])=>!record(node)||typeof node.class_type!=='string'||!record(node.inputs)))return UNKNOWN_COMFY_WORKFLOW_MODEL;
  const graph=nodes as Record<string,Node>,pending:string[]=[],visited=new Set<string>();
  const linkedNode=(value:unknown):string|undefined=>Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Number.isInteger(value[1])&&Object.hasOwn(graph,value[0])?value[0]:undefined;
  for(const node of Object.values(graph)){
    if(!/^(save|preview|imagesaver)/.test(normalizedType(node.class_type)))continue;
    // Metadata inputs can reference unrelated loaders; only follow the saved pixels.
    for(const field of ['images','image']){const id=linkedNode(node.inputs[field]);if(id)pending.push(id);}
  }
  const candidates:Array<{checkpoint?:string;family:ComfyWorkflowModel['family'];variant:ComfyWorkflowModel['variant']}>=[];
  while(pending.length){
    const id=pending.pop()!;if(visited.has(id))continue;visited.add(id);
    const node=graph[id],type=normalizedType(node.class_type);
    if(/(?:unet|checkpoint|diffusion).*load|load.*(?:unet|checkpoint|diffusion)/.test(type)&&!/lora|controlnet|upscale/.test(type)){
      const value=node.inputs.unet_name??node.inputs.ckpt_name??node.inputs.model_name??node.inputs.diffusion_model;
      const checkpoint=typeof value==='string'?path.posix.basename(value.replaceAll('\\','/')).trim():'';
      candidates.push(checkpoint?{checkpoint,...identify(checkpoint)}:{family:'unknown',variant:'unknown'});
    }
    for(const value of Object.values(node.inputs)){const linked=linkedNode(value);if(linked)pending.push(linked);}
  }
  if(!candidates.length)return UNKNOWN_COMFY_WORKFLOW_MODEL;
  const family=candidates.every(candidate=>candidate.family===candidates[0].family)?candidates[0].family:'unknown';
  const variant=family!=='unknown'&&candidates.every(candidate=>candidate.variant===candidates[0].variant)?candidates[0].variant:'unknown';
  const checkpoints=Object.freeze([...new Set(candidates.flatMap(candidate=>candidate.checkpoint?[candidate.checkpoint]:[]))].sort());
  return Object.freeze({family,variant,checkpoints});
}

/** A missing or unsupported workflow must not prevent ordinary chat turns. */
export function readComfyWorkflowModel(workflowPath:string):Readonly<ComfyWorkflowModel> {
  try{
    const info=statSync(workflowPath);
    if(!info.isFile()||info.size<=0||info.size>4*1024*1024)return UNKNOWN_COMFY_WORKFLOW_MODEL;
    return inspectComfyWorkflowModel(JSON.parse(readFileSync(workflowPath,'utf8')));
  }catch{return UNKNOWN_COMFY_WORKFLOW_MODEL;}
}
