import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { cp, mkdir, realpath, stat,rename,rm } from 'node:fs/promises';
import path from 'node:path';
import type { BotInstance } from './types.js';

export function defaultWorkspaceRoot():string {
  return path.resolve(process.env.BOT_WORKSPACE_ROOT||path.join(process.cwd(),'.runtime','workspaces'));
}
export function workingDirectory(bot:BotInstance,key:string,home?:string):string {
  const root=process.env.BOT_WORKSPACE_ROOT||(home?path.join(home,'workspaces'):defaultWorkspaceRoot());
  return bot.workingDirectory||path.join(root,bot.id,key);
}
export function validateWorkingDirectory(directory:string):void {
  mkdirSync(directory,{recursive:true});
  if(!statSync(directory).isDirectory())throw new Error('工作目录必须是文件夹');
  realpathSync(directory);
}
export async function prepareWorkingDirectory(bot:BotInstance,key:string,legacyHome:string):Promise<string> {
  const directory=workingDirectory(bot,key,legacyHome);
  if(!bot.workingDirectory){
    const root=process.env.BOT_WORKSPACE_ROOT||path.join(legacyHome,'workspaces');
    const candidates=[path.join(root,key),path.join(legacyHome,'workspaces',key)];
    const legacy=candidates.find(candidate=>{try{return statSync(candidate).isDirectory();}catch{return false;}})??candidates[0];
    let exists=true;try{await stat(directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;exists=false;}
    if(!exists&&path.resolve(legacy)!==path.resolve(directory)){
      let oldExists=false;try{oldExists=(await stat(legacy)).isDirectory();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(oldExists){await mkdir(path.dirname(directory),{recursive:true});try{await rename(legacy,directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='EXDEV')throw error;await cp(legacy,directory,{recursive:true,force:false,errorOnExist:true});await rm(legacy,{recursive:true});}}
    }
  }
  await mkdir(directory,{recursive:true});
  await Promise.all(['history','images','videos','audio','files','outputs',path.join('.bot','tmp')].map(folder=>mkdir(path.join(directory,folder),{recursive:true})));
  return realpath(directory);
}
