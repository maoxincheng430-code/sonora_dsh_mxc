#requires -Version 5.1
<#
  Sonora portable MariaDB bootstrap (Windows, no admin rights).

  Idempotent: download -> extract -> init data dir -> start -> create database/table.
  Re-running the script never re-downloads a complete package, never re-initializes an
  initialized data directory and never wipes existing tracks.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/db-setup.ps1
    powershell -ExecutionPolicy Bypass -File scripts/db-setup.ps1 -Version 11.4.5
#>
[CmdletBinding()]
param(
  [string]$Root = '',
  [string]$Version = '11.4.5',
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
$CacheDir = Join-Path $MysqlHome 'cache'
$DataDir = Join-Path $MysqlHome 'data'
$TmpDir = Join-Path $MysqlHome 'tmp'
$IniPath = Join-Path $MysqlHome 'my.ini'
$ZipName = "mariadb-$Version-winx64.zip"
$ZipPath = Join-Path $CacheDir $ZipName
$ZipUrl = "https://archive.mariadb.org/mariadb-$Version/winx64-packages/$ZipName"
$SchemaPath = Join-Path $Root 'server\schema.sql'
$MinZipBytes = 80000000

function Write-Info([string]$Message) { Write-Host "[db-setup] $Message" }

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

function Get-ZipPackage {
  if ((Test-Path -LiteralPath $ZipPath) -and ((Get-Item -LiteralPath $ZipPath).Length -ge $MinZipBytes)) {
    Write-Info ("Using cached package: {0} ({1:N1} MB)" -f $ZipPath, ((Get-Item -LiteralPath $ZipPath).Length / 1MB))
    return
  }
  if (Test-Path -LiteralPath $ZipPath) {
    Write-Info 'Cached package is incomplete, downloading again.'
    Remove-Item -LiteralPath $ZipPath -Force
  }
  Write-Info "Downloading MariaDB $Version portable package ..."
  Write-Info "  $ZipUrl"
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    & $curl.Source -L --fail --retry 3 --retry-delay 3 --progress-bar -o $ZipPath $ZipUrl
    if ($LASTEXITCODE -ne 0) { throw "curl download failed (exit code $LASTEXITCODE)." }
  } else {
    try {
      [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    } catch { }
    Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
  }
  if (-not (Test-Path -LiteralPath $ZipPath)) { throw 'Download finished but the package file is missing.' }
  $size = (Get-Item -LiteralPath $ZipPath).Length
  if ($size -lt $MinZipBytes) { throw ("Downloaded package looks incomplete ({0} bytes)." -f $size) }
  Write-Info ("Downloaded {0:N1} MB" -f ($size / 1MB))
}

function Expand-ZipPackage {
  param([string]$PackagePath, [string]$Destination)
  Write-Info "Extracting package to $Destination (first run takes a while) ..."
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
  if ($tar) {
    & $tar.Source -xf $PackagePath -C $Destination
    if ($LASTEXITCODE -ne 0) { throw "tar extraction failed (exit code $LASTEXITCODE)." }
  } else {
    Expand-Archive -LiteralPath $PackagePath -DestinationPath $Destination -Force
  }
}

function Convert-ToIniPath {
  param([string]$Path)
  # MariaDB option files interpret backslash escapes inside quotes (\t becomes TAB),
  # so every Windows path written into my.ini uses forward slashes.
  return ($Path -replace '\\', '/')
}

function Write-MyIni {
  param([string]$ServerRoot, [string]$DataDirectory, [string]$TmpDirectory, [string]$IniFile, [int]$ListenPort)
  $lines = @(
    '[mysqld]',
    ('basedir="{0}"' -f (Convert-ToIniPath $ServerRoot)),
    ('datadir="{0}"' -f (Convert-ToIniPath $DataDirectory)),
    ('tmpdir="{0}"' -f (Convert-ToIniPath $TmpDirectory)),
    ('port={0}' -f $ListenPort),
    'bind-address=127.0.0.1',
    'skip-networking=0',
    'character-set-server=utf8mb4',
    'collation-server=utf8mb4_unicode_ci',
    'max_allowed_packet=256M',
    'innodb_buffer_pool_size=128M',
    'default-storage-engine=InnoDB',
    'lower_case_table_names=1',
    ('log-error="{0}"' -f (Convert-ToIniPath (Join-Path $DataDirectory 'error.log'))),
    ('pid-file="{0}"' -f (Convert-ToIniPath (Join-Path $DataDirectory 'mysqld.pid'))),
    'sql_mode=STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION',
    '',
    '[client]',
    ('port={0}' -f $ListenPort),
    'host=127.0.0.1',
    'default-character-set=utf8mb4'
  )
  $text = ($lines -join "`r`n") + "`r`n"
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($IniFile, $text, $utf8NoBom)
  Write-Info "Wrote $IniFile"
}

function Initialize-DataDirectory {
  param([string]$ServerRoot, [string]$IniFile, [string]$DataDirectory, [int]$ListenPort)
  if (Test-Path -LiteralPath (Join-Path $DataDirectory 'mysql')) {
    Write-Info 'Data directory already initialized, keeping existing tracks.'
    return
  }
  # A previous failed attempt may have left a half-initialized data dir behind.
  # Keep it for inspection instead of deleting, then initialize a fresh one.
  New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
  $existing = @(Get-ChildItem -LiteralPath $DataDirectory -Force -ErrorAction SilentlyContinue)
  if ($existing.Count -gt 0) {
    $backup = $DataDirectory + '.broken-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    Move-Item -LiteralPath $DataDirectory -Destination $backup
    New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
    Write-Info "Moved incomplete data directory to $backup"
  }

  $outLog = Join-Path $MysqlHome 'init.out.log'
  $errLog = Join-Path $MysqlHome 'init.err.log'
  $installDb = Join-Path $ServerRoot 'bin\mysql_install_db.exe'
  $basedir = $ServerRoot
  if (Test-Path -LiteralPath $installDb) {
    # MariaDB Windows packages initialize with mysql_install_db.exe (there is no
    # MySQL-style --initialize-insecure). An empty --password= gives root no password.
    Write-Info 'Initializing data directory with mysql_install_db.exe (root has an empty password, local only) ...'
    $proc = Start-Process -FilePath $installDb `
      -ArgumentList @("--datadir=$DataDirectory", "--port=$ListenPort", '--password=', "--config=$IniFile") `
      -WorkingDirectory $basedir -WindowStyle Hidden -Wait -PassThru `
      -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $tool = 'mysql_install_db.exe'
  } else {
    Write-Info 'Initializing data directory with mysqld --initialize-insecure (root has an empty password, local only) ...'
    $proc = Start-Process -FilePath (Join-Path $ServerRoot 'bin\mysqld.exe') `
      -ArgumentList @("--defaults-file=$IniFile", '--initialize-insecure', '--console') `
      -WorkingDirectory $basedir -WindowStyle Hidden -Wait -PassThru `
      -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    $tool = 'mysqld --initialize-insecure'
  }
  if ($proc.ExitCode -ne 0) {
    $detail = ''
    foreach ($log in @($errLog, $outLog)) {
      if (Test-Path -LiteralPath $log) { $detail += (Get-Content -LiteralPath $log -Tail 40 | Out-String) }
    }
    throw ("{0} failed (exit code {1}).`n{2}" -f $tool, $proc.ExitCode, $detail)
  }
  if (-not (Test-Path -LiteralPath (Join-Path $DataDirectory 'mysql'))) {
    throw "Initialization finished but '$DataDirectory\mysql' is missing. Check $errLog."
  }
  Write-Info 'Data directory initialized.'
}

function Invoke-MysqlScript {
  param([string]$MysqlExe, [string]$IniFile, [string]$SqlPath)
  if (-not (Test-Path -LiteralPath $SqlPath)) { throw "SQL file not found: $SqlPath" }
  Write-Info "Applying schema from $SqlPath ..."
  # Redirect the SQL file into mysql.exe stdin byte-for-byte (no shell/codepage surprises).
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $MysqlExe
  $psi.Arguments = '--defaults-file="' + $IniFile + '" --protocol=tcp --user=root'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.WorkingDirectory = $Root
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  [void]$process.Start()
  $stdin = $process.StandardInput.BaseStream
  $bytes = [System.IO.File]::ReadAllBytes($SqlPath)
  $stdin.Write($bytes, 0, $bytes.Length)
  $stdin.Flush()
  $stdin.Close()
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw ("Applying schema failed (exit code {0}).`n{1}{2}" -f $process.ExitCode, $stdout, $stderr)
  }
}

function Invoke-MysqlQuery {
  param([string]$MysqlExe, [string]$IniFile, [string]$Sql)
  # The client prints a harmless "WARNING: option --ssl-verify-server-cert is disabled"
  # line on stderr for a passwordless root login. Capture it without letting
  # $ErrorActionPreference = 'Stop' turn it into a terminating error, then filter it out.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $raw = & $MysqlExe "--defaults-file=$IniFile" '--protocol=tcp' '--user=root' '--batch' "--execute=$Sql" 2>&1
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  $lines = @($raw | ForEach-Object { "$_" } | Where-Object { $_ -notmatch '^WARNING: option --ssl-verify-server-cert is disabled' })
  if ($code -ne 0) { throw ("Verification query failed (exit code {0}):`n{1}" -f $code, ($lines -join [Environment]::NewLine)) }
  return $lines
}

# ---------------- main ----------------

New-Item -ItemType Directory -Force -Path $MysqlHome | Out-Null
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

$serverRoot = Find-MariadbRoot $MysqlHome
if (-not $serverRoot) {
  Get-ZipPackage
  Expand-ZipPackage -PackagePath $ZipPath -Destination $MysqlHome
  $serverRoot = Find-MariadbRoot $MysqlHome
  if (-not $serverRoot) {
    throw "Extraction finished but bin\mysqld.exe was not found under '$MysqlHome'."
  }
  Write-Info "MariaDB portable server ready: $serverRoot"
} else {
  Write-Info "MariaDB portable server already present: $serverRoot"
}

$mysqld = Join-Path $serverRoot 'bin\mysqld.exe'
$mysqlExe = Join-Path $serverRoot 'bin\mysql.exe'

New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null
Write-MyIni -ServerRoot $serverRoot -DataDirectory $DataDir -TmpDirectory $TmpDir -IniFile $IniPath -ListenPort $Port
Initialize-DataDirectory -ServerRoot $serverRoot -IniFile $IniPath -DataDirectory $DataDir -ListenPort $Port

$startScript = Join-Path $PSScriptRoot 'db-start.ps1'
if (-not (Test-Path -LiteralPath $startScript)) { throw "Missing script: $startScript" }
& $startScript -Root $Root -Port $Port -WaitSeconds $WaitSeconds

Invoke-MysqlScript -MysqlExe $mysqlExe -IniFile $IniPath -SqlPath $SchemaPath

Write-Info 'Verifying database ...'
$verifySql = "SHOW DATABASES LIKE 'sonora'; SELECT table_name FROM information_schema.tables WHERE table_schema='sonora' ORDER BY table_name; SELECT COUNT(*) AS track_count FROM sonora.tracks; SELECT VERSION() AS server_version;"
$rows = Invoke-MysqlQuery -MysqlExe $mysqlExe -IniFile $IniPath -Sql $verifySql
$rows | ForEach-Object { Write-Host $_ }

Write-Host ''
Write-Info 'Database is ready.'
Write-Info ("  host/port : 127.0.0.1:{0} (localhost only)" -f $Port)
Write-Info '  user      : root (empty password)'
Write-Info '  database  : sonora (utf8mb4)'
Write-Info ('  data dir  : ' + $DataDir)
Write-Info '  start/stop: npm run db:start / npm run db:stop'
