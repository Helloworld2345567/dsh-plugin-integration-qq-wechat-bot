import {existsSync} from 'node:fs';
import type {SystemLocale} from '../i18n/common.js';
import {runJsonProcess} from './json-process.js';

// Both native choosers share their topmost owner and cancellable STA process.
const pickerScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$request=[Console]::In.ReadToEnd()|ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
$owner=[System.Windows.Forms.Form]::new()
$picker=$null
try {
  $owner.ShowInTaskbar=$false
  $owner.FormBorderStyle='None'
  $owner.StartPosition='CenterScreen'
  $owner.Size=[System.Drawing.Size]::new(1,1)
  $owner.Opacity=0
  $owner.TopMost=$true
  if($request.kind -eq 'file') {
    $picker=[System.Windows.Forms.OpenFileDialog]::new()
    $picker.Title=$request.title
    $picker.Filter='JSON (*.json)|*.json'
    $picker.CheckFileExists=$true
    $picker.Multiselect=$false
    if($request.initial) {
      if([System.IO.Directory]::Exists($request.initial)) {
        $picker.InitialDirectory=$request.initial
      } else {
        $parent=[System.IO.Path]::GetDirectoryName($request.initial)
        if($parent -and [System.IO.Directory]::Exists($parent)) {
          $picker.InitialDirectory=$parent
        }
        if([System.IO.File]::Exists($request.initial)) {
          $picker.FileName=[System.IO.Path]::GetFileName($request.initial)
        }
      }
    }
  } else {
    $picker=[System.Windows.Forms.FolderBrowserDialog]::new()
    $picker.Description=$request.title
    $picker.UseDescriptionForTitle=$true
    $picker.ShowNewFolderButton=$false
    if($request.initial -and [System.IO.Directory]::Exists($request.initial)) {
      $picker.SelectedPath=$request.initial
    }
  }
  $owner.Show()
  $owner.Activate()
  $owner.BringToFront()
  $selected=$null
  if($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    $selected=if($request.kind -eq 'file') {$picker.FileName} else {$picker.SelectedPath}
  }
  @{path=$selected}|ConvertTo-Json -Compress
} finally {
  if($picker) {$picker.Dispose()}
  $owner.Dispose()
}
`;

export async function pickWindowsPath(kind:'directory'|'file',initial:string|undefined,locale:SystemLocale,signal:AbortSignal,run:typeof runJsonProcess=runJsonProcess):Promise<unknown>{
  signal.throwIfAborted();
  const installed=[String.fromCharCode(67),':',String.fromCharCode(92),'Program Files (x86)',String.fromCharCode(92),'PowerShell',String.fromCharCode(92),'7',String.fromCharCode(92),'pwsh.exe'].join('');
  const command=existsSync(installed)?installed:'pwsh.exe';
  const title=kind==='file'?(locale==='en'?'Choose workflow file':'选择工作流文件'):(locale==='en'?'Choose directory':'选择目录');
  const result=await run(command,['-NoLogo','-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(pickerScript,'utf16le').toString('base64')],
    {kind,initial,title},
    {cwd:process.cwd(),env:process.env,signal,maxOutputBytes:64*1024});
  signal.throwIfAborted();
  return result?.path;
}
