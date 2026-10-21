param(
  [ValidateSet('install','start','stop','upgrade')][string]$Action='start',
  [string]$Source,
  [int]$Port=3000
)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $root
try {
  switch ($Action) {
    install { & node scripts/install.mjs; if($LASTEXITCODE){throw 'Installation failed'} }
    start { & node scripts/start.mjs --port $Port; if($LASTEXITCODE){throw 'Harness exited with an error'} }
    stop { & node scripts/stop.mjs; if($LASTEXITCODE){throw 'Stop failed'} }
    upgrade {
      if(-not $Source){throw 'Supply -Source with the new package directory or tarball'}
      & node scripts/stop.mjs
      & node scripts/install.mjs $Source
      if($LASTEXITCODE){throw 'Upgrade failed; the old configuration and data remain in BOT_HOME'}
      Write-Host 'Upgrade installed. Run start to launch the updated plugin.'
    }
  }
} finally { Pop-Location }
