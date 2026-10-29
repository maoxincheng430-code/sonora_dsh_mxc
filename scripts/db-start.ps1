#requires -Version 5.1
<#
  Start the portable MariaDB server in the background (no Windows service, no admin).

  Idempotent: if 127.0.0.1:3307 already answers mysqladmin ping, it prints a notice and
  exits successfully. Logs:
    .mysql/mysqld.out.log  .mysql/mysqld.err.log  .mysql/data/error.log

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/db-start.ps1
#>
[CmdletBinding()]
param(
  [string]$Root = '',
  [int]$Port = 3307,
  [int]$WaitSeconds = 60
)

$ErrorActionPreference = 'Stop'

if (-not $Root) {
  if ($PSScriptRoot) { $Root = Split-Path -Parent $PSScriptRoot }
  else { $Root = (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$MysqlHome = Join-Path $Root '.mysql'
$DataDir = Join-Path $MysqlHome 'data'
$IniPath = Join-Path $MysqlHome 'my.ini'
$PidPath = Join-Path $MysqlHome 'mysqld.pid'

function Write-Info([string]$Message) { Write-Host "[db-start] $Message" }

function Find-MariadbRoot {
  param([string]$BaseDir)
  if (-not (Test-Path -LiteralPath $BaseDir)) { return $null }
  $direct = Join-Path $BaseDir 'bin\mysqld.exe'
  if (Test-Path -LiteralPath $direct) { return $BaseDir }
  $candidates = @(Get-ChildItem -LiteralPath $BaseDir -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\mysqld.exe') })
  if ($candidates.Count -gt 0) { return $candidates[0].FullName }
  return $null
}

function Test-TcpPort {
  param([string]$TargetHost, [int]$TargetPort, [int]$TimeoutMs = 1000)
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($TargetHost, $TargetPort, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
    $client.EndConnect($async)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-MysqlAlive {
  param([string]$MysqlAdmin, [int]$ListenPort)
  if (-not (Test-Path -LiteralPath $MysqlAdmin)) { return $false }
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $MysqlAdmin "--defaults-file=$IniPath" '--protocol=tcp' "--host=127.0.0.1" "--port=$ListenPort" '--user=root' 'ping' 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  return ($code -eq 0 -and ("$output" -match 'alive'))
}

$serverRoot = Find-MariadbRoot $MysqlHome
if (-not $serverRoot) {
  throw "Portable MariaDB is not installed under '$MysqlHome'. Run: powershell -ExecutionPolicy Bypass -File scripts/db-setup.ps1"
}
$mysqld = Join-Path $serverRoot 'bin\mysqld.exe'
$mysqladmin = Join-Path $serverRoot 'bin\mysqladmin.exe'

if (-not (Test-Path -LiteralPath $IniPath)) {
  throw "Missing config '$IniPath'. Run scripts/db-setup.ps1 first."
}
if (-not (Test-Path -LiteralPath (Join-Path $DataDir 'mysql'))) {
  throw "Data directory '$DataDir' is not initialized. Run scripts/db-setup.ps1 first."
}

if (Test-MysqlAlive -MysqlAdmin $mysqladmin -ListenPort $Port) {
  Write-Info "MariaDB is already running on 127.0.0.1:$Port (nothing to do)."
  return
}
if (Test-TcpPort -TargetHost '127.0.0.1' -TargetPort $Port -TimeoutMs 800) {
  throw "Port $Port is occupied by another program that is not this MariaDB instance. Stop it or use another port."
}

$errorLog = Join-Path $DataDir 'error.log'
# my.ini points tmpdir here; InnoDB needs a writable temp dir when starting on Windows.
New-Item -ItemType Directory -Force -Path (Join-Path $MysqlHome 'tmp') | Out-Null
Write-Info "Starting mysqld (port $Port, data dir $DataDir) ..."
# Launch detached WITHOUT inherited std handles: a piped caller (npm/CI/automation) would
# otherwise wait for EOF forever because mysqld keeps the pipe open. WMI's
# Win32_Process.Create starts a fully detached process; Start-Process is the fallback.
$startedPid = 0
$commandLine = '"{0}" --defaults-file="{1}"' -f $mysqld, $IniPath
try {
  $wmi = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
    -Arguments @{ CommandLine = $commandLine; CurrentDirectory = $serverRoot } -ErrorAction Stop
  if ($wmi.ReturnValue -eq 0 -and $wmi.ProcessId) { $startedPid = [int]$wmi.ProcessId }
} catch {
  Write-Info "WMI launch unavailable ($($_.Exception.Message)); falling back to Start-Process."
}
if ($startedPid -le 0) {
  $process = Start-Process -FilePath $mysqld `
    -ArgumentList @("--defaults-file=$IniPath") `
    -WorkingDirectory $serverRoot -WindowStyle Hidden -PassThru
  $startedPid = [int]$process.Id
}
Set-Content -LiteralPath $PidPath -Value $startedPid -Encoding ASCII
Write-Info "mysqld PID $startedPid (log: $errorLog)"

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  if (Test-MysqlAlive -MysqlAdmin $mysqladmin -ListenPort $Port) {
    Write-Info "MariaDB is ready: 127.0.0.1:$Port (database sonora, user root, empty password)."
    return
  }
  $alive = Get-Process -Id $startedPid -ErrorAction SilentlyContinue
  if (-not $alive) {
    Start-Sleep -Milliseconds 300
    if (Test-MysqlAlive -MysqlAdmin $mysqladmin -ListenPort $Port) {
      Write-Info "MariaDB is ready: 127.0.0.1:$Port (database sonora, user root, empty password)."
      return
    }
    $detail = ''
    if (Test-Path -LiteralPath $errorLog) { $detail = (Get-Content -LiteralPath $errorLog -Tail 40 | Out-String) }
    throw ("mysqld exited during startup (PID {0}).`n{1}" -f $startedPid, $detail)
  }
  Start-Sleep -Milliseconds 500
}

$detail = ''
if (Test-Path -LiteralPath $errorLog) { $detail = (Get-Content -LiteralPath $errorLog -Tail 40 | Out-String) }
throw ("MariaDB did not become ready within {0}s.`n{1}" -f $WaitSeconds, $detail)
