import {existsSync} from 'node:fs';
import type {SystemLocale} from '../i18n/common.js';
import {runJsonProcess} from './json-process.js';

// The native dialog belongs to a topmost window for its whole lifetime. The
// helper has no console window and is terminated with the request on cancel.
const pickerScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$request=[Console]::In.ReadToEnd()|ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
$owner=[System.Windows.Forms.Form]::new()
$picker=[System.Windows.Forms.FolderBrowserDialog]::new()
try {
  $owner.ShowInTaskbar=$false
  $owner.FormBorderStyle='None'
  $owner.StartPosition='CenterScreen'
  $owner.Size=[System.Drawing.Size]::new(1,1)
  $owner.Opacity=0
  $owner.TopMost=$true
  $picker.Description=$request.title
  $picker.UseDescriptionForTitle=$true
  $picker.ShowNewFolderButton=$false
  if($request.initial -and [System.IO.Directory]::Exists($request.initial)) {
    $picker.SelectedPath=$request.initial
  }
  $owner.Show()
  $owner.Activate()
  $owner.BringToFront()
  $selected=$null
  if($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    $selected=$picker.SelectedPath
  }
  @{path=$selected}|ConvertTo-Json -Compress
} finally {
  $picker.Dispose()
  $owner.Dispose()
}
`;

export async function pickWindowsDirectory(initial:string|undefined,locale:SystemLocale,signal:AbortSignal,run:typeof runJsonProcess=runJsonProcess):Promise<unknown>{
  signal.throwIfAborted();
  const installed=[String.fromCharCode(67),':',String.fromCharCode(92),'Program Files (x86)',String.fromCharCode(92),'PowerShell',String.fromCharCode(92),'7',String.fromCharCode(92),'pwsh.exe'].join('');
  const command=existsSync(installed)?installed:'pwsh.exe';
  const result=await run(command,['-NoLogo','-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(pickerScript,'utf16le').toString('base64')],
    {initial,title:locale==='en'?'Choose directory':'选择目录'},
    {cwd:process.cwd(),env:process.env,signal,maxOutputBytes:64*1024});
  signal.throwIfAborted();
  return result?.path;
}
