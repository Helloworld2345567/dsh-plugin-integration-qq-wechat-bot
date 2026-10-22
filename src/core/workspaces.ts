import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { cp, mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BotInstance } from './types.js';

export function defaultWorkspaceRoot():string {
  return path.resolve(process.env.BOT_WORKSPACE_ROOT||path.join(process.cwd(),'.runtime','workspaces'));
}
export function workingDirectory(bot:BotInstance,key:string):string {
  return bot.workingDirectory||path.join(defaultWorkspaceRoot(),key);
}
export function validateWorkingDirectory(directory:string):void {
  mkdirSync(directory,{recursive:true});
  if(!statSync(directory).isDirectory())throw new Error('工作目录必须是文件夹');
  realpathSync(directory);
}
export async function prepareWorkingDirectory(bot:BotInstance,key:string,legacyHome:string):Promise<string> {
  const directory=workingDirectory(bot,key);
  if(!bot.workingDirectory){
    const legacy=path.join(legacyHome,'workspaces',key);
    let exists=true;try{await stat(directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;exists=false;}
    if(!exists&&path.resolve(legacy)!==path.resolve(directory)){
      let oldExists=false;try{oldExists=(await stat(legacy)).isDirectory();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(oldExists)await cp(legacy,directory,{recursive:true,force:false,errorOnExist:true});
    }
  }
  await mkdir(directory,{recursive:true});return realpath(directory);
}
