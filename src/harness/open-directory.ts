import {execFile,type ExecFileOptions} from 'node:child_process';
import {realpath,stat} from 'node:fs/promises';
import path from 'node:path';

export type DirectoryCommand=(command:string,args:string[],options:ExecFileOptions)=>Promise<{stdout:string}>;
const runCommand:DirectoryCommand=(command,args,options)=>new Promise((resolve,reject)=>{
  execFile(command,args,{...options,encoding:'utf8'},(error,stdout,stderr)=>{
    if(error){reject(new Error(`打开配置目录失败：${stderr.trim()||error.message}`));return;}
    resolve({stdout});
  });
});

// Hide this console helper only. SW_HIDE on explorer.exe also hides the folder window.
// Pass the validated path through the environment so it is never interpreted as code.
const windowsOpenScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$target=$env:BOT_OPEN_DIRECTORY
$shell=New-Object -ComObject Shell.Application
try {
  $explorer=Join-Path $env:SystemRoot 'explorer.exe'
  Start-Process -FilePath $explorer -ArgumentList ('"{0}"' -f $target) -WindowStyle Normal -ErrorAction Stop
  $deadline=[DateTime]::UtcNow.AddSeconds(10)
  do {
    foreach($window in $shell.Windows()) {
      try {
        if($window.Visible -and $window.HWND -ne 0 -and [string]::Equals($window.Document.Folder.Self.Path.TrimEnd('\'),$target.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)) {
          @{opened=$true;directory=$target}|ConvertTo-Json -Compress
          exit 0
        }
      } catch { }
    }
    Start-Sleep -Milliseconds 150
  } while([DateTime]::UtcNow -lt $deadline)
  throw 'Explorer did not show the configuration directory within 10 seconds. Open the displayed path manually.'
} finally {
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
}
`;

export async function openDirectory(directory:string,run:DirectoryCommand=runCommand,platform:NodeJS.Platform=process.platform):Promise<void> {
  const target=await realpath(directory);if(!(await stat(target)).isDirectory())throw new Error('配置目录不存在');
  const options:ExecFileOptions={shell:false,windowsHide:true,timeout:15000,maxBuffer:64*1024};
  if(platform==='win32'){
    const command=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const {stdout}=await run(command,['-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(windowsOpenScript,'utf16le').toString('base64')],{...options,env:{...process.env,BOT_OPEN_DIRECTORY:target}});
    let result;try{result=JSON.parse(stdout.trim().replace(/^\uFEFF/,''));}catch{}
    if(result?.opened!==true||result.directory!==target)throw new Error('未确认配置目录窗口已打开，请手动打开面板显示的路径');
  }else await run(platform==='darwin'?'open':'xdg-open',[target],options);
}
