import {localizedError} from './errors.js';
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { BotInstance } from './types.js';

export function defaultWorkspaceRoot():string {
  return path.resolve(process.env.BOT_WORKSPACE_ROOT||path.join(process.cwd(),'.runtime','workspaces'));
}
export function workingDirectory(bot:BotInstance,key:string,home?:string):string {
  const root=process.env.BOT_WORKSPACE_ROOT||(home?path.join(home,'workspaces'):defaultWorkspaceRoot());
  return path.join(bot.workingDirectory||root,bot.id,key);
}
export function sessionWorkingDirectory(bot:BotInstance,key:string,sessionId:string,home?:string):string {
  return sessionDirectory(workingDirectory(bot,key,home),sessionId);
}
export function sessionDirectory(workspace:string,sessionId:string):string {
  if(!path.isAbsolute(workspace))throw Error('SESSION_WORKSPACE_PATH_INVALID');
  const root=path.resolve(workspace,'sessions'),directory=path.resolve(root,sessionId);
  if(path.dirname(directory)!==root)throw Error('SESSION_WORKSPACE_PATH_INVALID');
  return directory;
}
export function validateWorkingDirectory(directory:string):void {
  mkdirSync(directory,{recursive:true});
  if(!statSync(directory).isDirectory())throw localizedError('workspaceNotDirectory');
  realpathSync(directory);
}
export async function prepareWorkingDirectory(bot:BotInstance,key:string,home:string):Promise<string> {
  const directory=workingDirectory(bot,key,home);
  await mkdir(directory,{recursive:true});
  await Promise.all(['images','videos','audio','files',path.join('.bot','tmp')].map(folder=>mkdir(path.join(directory,folder),{recursive:true})));
  return realpath(directory);
}
