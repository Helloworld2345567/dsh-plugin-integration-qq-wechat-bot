import {localizedError,LocalizedError} from '../core/errors.js';
import {execFile,type ExecFileOptions} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import path from 'node:path';

export type FilePickerCommand=(command:string,args:string[],options:ExecFileOptions)=>Promise<{stdout:string}>;
const runCommand:FilePickerCommand=(command,args,options)=>new Promise((resolve,reject)=>{
  execFile(command,args,{...options,encoding:'utf8'},(error,stdout,stderr)=>{
    if(error){reject(localizedError('filePickerFailed',{detail:stderr.trim()||error.message}));return;}
    resolve({stdout});
  });
});

const windowsPickScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog=New-Object System.Windows.Forms.OpenFileDialog
$dialog.Filter='ComfyUI workflow (*.json)|*.json|JSON files (*.json)|*.json|All files (*.*)|*.*'
$dialog.CheckFileExists=$true
$dialog.Multiselect=$false
$initial=$env:BOT_PICK_FILE_INITIAL
if($initial){ try { $dialog.InitialDirectory=[System.IO.Path]::GetDirectoryName($initial) } catch { } }
$result=$dialog.ShowDialog()
if($result -eq [System.Windows.Forms.DialogResult]::OK){ @{selected=$dialog.FileName}|ConvertTo-Json -Compress }
else { @{selected=$null}|ConvertTo-Json -Compress }
`;

/** Open a native file chooser on the desktop host and return a canonical file path. */
export async function pickFile(initial:string|undefined,signal:AbortSignal=new AbortController().signal,run:FilePickerCommand=runCommand,platform:NodeJS.Platform=process.platform):Promise<string|undefined>{
  const combined=AbortSignal.any([signal,AbortSignal.timeout(300000)]);
  combined.throwIfAborted();
  let selected:unknown;
  try {
    if(platform!=='win32') throw localizedError('filePickerUnsupported');
    const command=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const options:ExecFileOptions={shell:false,windowsHide:true,timeout:310000,maxBuffer:64*1024,env:{...process.env,...initial?{BOT_PICK_FILE_INITIAL:initial}:{}}};
    const {stdout}=await run(command,['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(windowsPickScript,'utf16le').toString('base64')],options);
    combined.throwIfAborted();
    let result:any;try{result=JSON.parse(stdout.trim().replace(/^\uFEFF/,''));}catch{throw localizedError('filePickerResponse');}
    selected=result?.selected;
  } catch(error) {
    if(error instanceof LocalizedError) throw error;
    const detail=signal.aborted?'FILE_PICKER_CANCELLED':combined.aborted?'FILE_PICKER_TIMEOUT':'FILE_PICKER_FAILED';
    throw localizedError('filePickerFailed',{detail});
  }
  if(selected===null||selected===undefined||selected==='') return undefined;
  if(typeof selected!=='string'||!path.isAbsolute(selected)) throw localizedError('filePickerPath');
  try {
    const resolved=await realpath(selected),info=await stat(resolved);
    if(!info.isFile()) throw localizedError('fileNotFile');
    return resolved;
  } catch(error) {
    if(error instanceof LocalizedError&&error.localizedMessage.key==='diagnostic.fileNotFile') throw error;
    throw localizedError('fileInaccessible');
  }
}
