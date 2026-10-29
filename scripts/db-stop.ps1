#requires -Version 5.1
<#
  Stop the portable MariaDB server started by scripts/db-start.ps1.

  Idempotent: if nothing is listening on the port it prints a notice and exits successfully.
  Uses mysqladmin shutdown first (graceful), then falls back to the recorded PID.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/db-stop.ps1
#>
[CmdletBinding()]
param(
  [string]$Root = '',
  [int]$Port = 3307,
  [int]$WaitSeconds = 30
)

$ErrorActionPreference = 'Stop'

if (-not $Root) {
  if ($PSScriptRoot) { $Root = Split-Path -Parent $PSScriptRoot }
  else { $Root = (Get-Location).Path }
}
$Root = [System.IO.Path]::GetFullPath($Root)
$MysqlHome = Join-Path $Root '.mysql'
$IniPath = Join-Path $MysqlHome 'my.ini'
$PidPath = Join-Path $MysqlHome 'mysqld.pid'

function Write-Info([string]$Message) { Write-Host "[db-stop] $Message" }

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

function Get-RecordedPid {
  if (-not (Test-Path -LiteralPath $PidPath)) { return 0 }
  $raw = (Get-Content -LiteralPath $PidPath -ErrorAction SilentlyContinue | Select-Object -First 1)
  $number = 0
  if ([int]::TryParse([string]$raw, [ref]$number)) { return $number }
  return 0
}

$serverRoot = Find-MariadbRoot $MysqlHome
$mysqladmin = $null
if ($serverRoot) { $mysqladmin = Join-Path $serverRoot 'bin\mysqladmin.exe' }

if (-not (Test-TcpPort -TargetHost '127.0.0.1' -TargetPort $Port -TimeoutMs 800)) {
  $recordedPid = Get-RecordedPid
  if ($recordedPid -gt 0 -and (Get-Process -Id $recordedPid -ErrorAction SilentlyContinue)) {
    $process = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -match 'mysqld') {
      Write-Info "Port $Port is closed but mysqld PID $recordedPid is still running; stopping it ..."
      Stop-Process -Id $recordedPid -Force
    }
  }
  if (Test-Path -LiteralPath $PidPath) { Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue }
  Write-Info "MariaDB is not running on 127.0.0.1:$Port (nothing to do)."
  return
}

$stopped = $false
if ($mysqladmin -and (Test-Path -LiteralPath $mysqladmin) -and (Test-Path -LiteralPath $IniPath)) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $mysqladmin "--defaults-file=$IniPath" '--protocol=tcp' '--host=127.0.0.1' "--port=$Port" '--user=root' 'shutdown' 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($code -eq 0) {
    $stopped = $true
    Write-Info 'Sent graceful shutdown via mysqladmin.'
  } else {
    Write-Info ("mysqladmin shutdown failed (exit {0}), will use PID fallback." -f $code)
  }
}

if (-not $stopped) {
  $recordedPid = Get-RecordedPid
  if ($recordedPid -gt 0) {
    $process = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -match 'mysqld') {
      Stop-Process -Id $recordedPid -Force
      $stopped = $true
      Write-Info "Force-stopped mysqld PID $recordedPid."
    }
  }
  if (-not $stopped) {
    $candidates = @(Get-Process -Name 'mysqld' -ErrorAction SilentlyContinue)
    if ($candidates.Count -ge 1) {
      $candidates | Stop-Process -Force
      $stopped = $true
      Write-Info 'Force-stopped a mysqld process found by name.'
    }
  }
}

$deadline = (Get-Date).AddSeconds($WaitSeconds)
while ((Get-Date) -lt $deadline) {
  if (-not (Test-TcpPort -TargetHost '127.0.0.1' -TargetPort $Port -TimeoutMs 500)) { break }
  Start-Sleep -Milliseconds 300
}

if (Test-TcpPort -TargetHost '127.0.0.1' -TargetPort $Port -TimeoutMs 500) {
  throw "MariaDB is still listening on port $Port after shutdown attempt."
}
if (Test-Path -LiteralPath $PidPath) { Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue }
Write-Info "MariaDB stopped (port $Port is closed)."
