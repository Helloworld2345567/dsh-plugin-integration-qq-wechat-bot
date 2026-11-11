import {diagnostic,formatDiagnostic} from '../i18n/diagnostics.js';
import type {SystemLocale} from '../i18n/common.js';
import {localizedError,LocalizedError} from '../core/errors.js';
import {execFile,type ExecFileOptions} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import path from 'node:path';

export type DirectoryPickerCommand=(command:string,args:string[],options:ExecFileOptions)=>Promise<{stdout:string}>;

const runCommand:DirectoryPickerCommand=(command,args,options)=>new Promise((resolve,reject)=>{
  execFile(command,args,{...options,encoding:'utf8'},(error,stdout,stderr)=>{
    if(error){reject(localizedError('directoryPickerFailed',{detail:stderr.trim()||error.message}));return;}
    resolve({stdout});
  });
});

// The picker runs in a short-lived STA PowerShell process so the web panel can
// receive a real local path. Pass the initial path through the environment;
// never interpolate it into the script.
const windowsPickScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog=New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description=$env:BOT_PICK_DIRECTORY_TITLE
$dialog.ShowNewFolderButton=$false
$initial=$env:BOT_PICK_DIRECTORY_INITIAL
if($initial -and (Test-Path -LiteralPath $initial -PathType Container)) {$dialog.SelectedPath=(Get-Item -LiteralPath $initial).FullName}
try {
  if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){@{path=$dialog.SelectedPath}|ConvertTo-Json -Compress}
  else {@{path=$null}|ConvertTo-Json -Compress}
} finally {$dialog.Dispose()}
`;

function parsePath(stdout:string,isAbsolute:(value:string)=>boolean):string|undefined {
  let value:unknown;
  try {value=JSON.parse(stdout.trim().replace(/^\uFEFF/,''))?.path;} catch {throw localizedError('directoryPickerResponse');}
  if(value===null||value===undefined||value==='')return undefined;
  if(typeof value!=='string'||!isAbsolute(value))throw localizedError('directoryPickerPath');
  return value;
}

export async function pickDirectory(initial:string|undefined,run:DirectoryPickerCommand=runCommand,platform:NodeJS.Platform=process.platform,locale:SystemLocale='zh'):Promise<string|undefined>{
  const options:ExecFileOptions={shell:false,windowsHide:true,timeout:300000,maxBuffer:64*1024};
  const title=formatDiagnostic(diagnostic('directoryPickerTitle'),locale)!;
  let selected:string|undefined;
  if(platform==='win32'){
    const command=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const {stdout}=await run(command,['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(windowsPickScript,'utf16le').toString('base64')],{...options,env:{...process.env,BOT_PICK_DIRECTORY_INITIAL:initial??'',BOT_PICK_DIRECTORY_TITLE:title}});
    selected=parsePath(stdout,path.win32.isAbsolute);
  }else if(platform==='darwin'){
    const {stdout}=await run('osascript',['-e',`POSIX path of (choose folder with prompt "${title}")`],options);
    selected=stdout.trim()||undefined;
  }else if(platform==='linux'){
    const {stdout}=await run('zenity',['--file-selection','--directory',`--title=${title}`,...(initial?['--filename',`${initial}${path.sep}`]:[])],options);
    selected=stdout.trim()||undefined;
  }else throw localizedError('directoryPickerUnsupported');
  if(!selected)return undefined;
  try{
    const resolved=await realpath(selected);
    if(!(await stat(resolved)).isDirectory())throw localizedError('directoryNotFolder');
    return resolved;
  }catch(error){
    if(error instanceof LocalizedError&&error.localizedMessage.key==='diagnostic.directoryNotFolder')throw error;
    throw localizedError('directoryInaccessible');
  }
}
