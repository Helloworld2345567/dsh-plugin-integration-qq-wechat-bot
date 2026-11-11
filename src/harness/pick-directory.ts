import type {DirectoryPicker} from '@deepseek-ai/dsh-host-directory-picker';
import {localizedError,LocalizedError} from '../core/errors.js';
import {realpath,stat} from 'node:fs/promises';
import path from 'node:path';

export type DirectoryPickerHost=Pick<DirectoryPicker,'capability'>;

/** Use the host's native chooser so its desktop activation and worker lifecycle stay together. */
export async function pickDirectory(host:DirectoryPickerHost|undefined,signal:AbortSignal=new AbortController().signal):Promise<string|undefined>{
  const combined=AbortSignal.any([signal,AbortSignal.timeout(300000)]);
  let selected:unknown;
  try{
    combined.throwIfAborted();
    const capability=host?.capability();
    if(capability?.kind!=='native')throw localizedError('directoryPickerUnsupported');
    selected=await capability.pick(combined);
    combined.throwIfAborted();
  }catch(error){
    if(error instanceof LocalizedError)throw error;
    const detail=signal.aborted?'DIRECTORY_PICKER_CANCELLED':combined.aborted?'DIRECTORY_PICKER_TIMEOUT':'DIRECTORY_PICKER_FAILED';
    throw localizedError('directoryPickerFailed',{detail});
  }
  if(selected===null)return undefined;
  if(typeof selected!=='string'||!path.isAbsolute(selected))throw localizedError('directoryPickerPath');
  try{
    const resolved=await realpath(selected);
    if(!(await stat(resolved)).isDirectory())throw localizedError('directoryNotFolder');
    return resolved;
  }catch(error){
    if(error instanceof LocalizedError&&error.localizedMessage.key==='diagnostic.directoryNotFolder')throw error;
    throw localizedError('directoryInaccessible');
  }
}
