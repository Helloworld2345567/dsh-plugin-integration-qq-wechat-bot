import {realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import type {SystemLocale} from '../i18n/common.js';
import {localizedError,LocalizedError} from '../core/errors.js';
import {pickWindowsFile} from './windows-file-picker.js';

export async function pickFile(initial:string|undefined,locale:SystemLocale,signal:AbortSignal=new AbortController().signal,platform:NodeJS.Platform=process.platform,pick:typeof pickWindowsFile=pickWindowsFile):Promise<string|undefined>{
  const combined=AbortSignal.any([signal,AbortSignal.timeout(300000)]);
  let selected:unknown;
  try{
    combined.throwIfAborted();
    if(platform!=='win32')throw localizedError('filePickerUnsupported');
    selected=await pick(initial,locale,combined);
    combined.throwIfAborted();
  }catch(error){
    if(error instanceof LocalizedError)throw error;
    const detail=signal.aborted?'FILE_PICKER_CANCELLED':combined.aborted?'FILE_PICKER_TIMEOUT':'FILE_PICKER_FAILED';
    throw localizedError('filePickerFailed',{detail});
  }
  if(selected===null)return undefined;
  if(typeof selected!=='string'||!path.isAbsolute(selected)||path.extname(selected).toLowerCase()!=='.json')throw localizedError('filePickerPath');
  try{
    const resolved=await realpath(selected);
    if(!(await stat(resolved)).isFile())throw localizedError('fileNotFile');
    if(combined.aborted)throw localizedError('filePickerFailed',{detail:signal.aborted?'FILE_PICKER_CANCELLED':'FILE_PICKER_TIMEOUT'});
    return resolved;
  }catch(error){
    if(error instanceof LocalizedError)throw error;
    throw localizedError('fileInaccessible');
  }
}
