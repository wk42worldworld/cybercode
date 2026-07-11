& {
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Repository = if ($env:CYBERCODE_REPOSITORY) { $env:CYBERCODE_REPOSITORY } else { "wk42worldworld/cybercode" }
$InstallDir = if ($env:CYBERCODE_INSTALL_DIR) { $env:CYBERCODE_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "CyberCode\cli" }
$BinDir = if ($env:CYBERCODE_BIN_DIR) { $env:CYBERCODE_BIN_DIR } else { Join-Path $env:LOCALAPPDATA "CyberCode\bin" }
$Version = $env:CYBERCODE_VERSION
$ArchiveUrl = $env:CYBERCODE_ARCHIVE_URL
$Headers = @{ "User-Agent" = "CyberCode-Installer" }
$OriginalProcessPath = $env:Path

function Write-Step([string]$Message) {
  Write-Host "CyberCode: $Message"
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $Version) {
  Write-Step "finding the latest stable release"
  $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers $Headers
  $Version = [string]$Release.tag_name
}

if ($Version -match '^\d+\.\d+\.\d+$') {
  $Version = "v$Version"
}

if ($Version -eq "main") {
  $DefaultArchiveUrl = "https://github.com/$Repository/archive/refs/heads/main.tar.gz"
} elseif ($Version -match '^v\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$') {
  $DefaultArchiveUrl = "https://github.com/$Repository/archive/refs/tags/$Version.tar.gz"
} else {
  throw "Could not resolve a valid release version (received '$Version')."
}

if (-not $ArchiveUrl) {
  $ArchiveUrl = $DefaultArchiveUrl
}

$BunCommand = Get-Command bun -CommandType Application -ErrorAction SilentlyContinue
if ($BunCommand) {
  $BunPath = $BunCommand.Source
} else {
  Write-Step "installing Bun"
  $BunInstallerSource = Invoke-RestMethod -Uri "https://bun.sh/install.ps1"
  $BunInstaller = [ScriptBlock]::Create([string]$BunInstallerSource)
  & $BunInstaller
  $BunPath = Join-Path $HOME ".bun\bin\bun.exe"
  if (-not (Test-Path -LiteralPath $BunPath)) {
    throw "Bun was installed but its executable was not found."
  }
}

$BunBinDir = Split-Path -Parent $BunPath
if (($OriginalProcessPath -split ';') -contains $BunBinDir) {
  $env:Path = $OriginalProcessPath
} else {
  $env:Path = "$BunBinDir;$OriginalProcessPath"
}

$InstallParent = Split-Path -Parent $InstallDir
New-Item -ItemType Directory -Force -Path $InstallParent, $BinDir | Out-Null
$StagingRoot = Join-Path $InstallParent ".cybercode-install-$([Guid]::NewGuid().ToString('N'))"
$ArchivePath = Join-Path $StagingRoot "cybercode.tar.gz"
$UnpackDir = Join-Path $StagingRoot "unpacked"
$NextDir = Join-Path $StagingRoot "next"

try {
  New-Item -ItemType Directory -Force -Path $UnpackDir | Out-Null
  Write-Step "downloading $Version"
  $CurlCommand = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue
  if ($CurlCommand) {
    & $CurlCommand.Source -fsSL --retry 3 -o $ArchivePath $ArchiveUrl
    if ($LASTEXITCODE -ne 0) {
      throw "Could not download CyberCode."
    }
  } else {
    $PreviousProgressPreference = $ProgressPreference
    $ProgressPreference = "SilentlyContinue"
    try {
      Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ArchivePath -Headers $Headers
    } finally {
      $ProgressPreference = $PreviousProgressPreference
    }
  }

  $TarCommand = Get-Command tar.exe -CommandType Application -ErrorAction SilentlyContinue
  if (-not $TarCommand) {
    throw "tar.exe is required. Install current Windows updates and run the installer again."
  }
  & $TarCommand.Source -xzf $ArchivePath -C $UnpackDir
  if ($LASTEXITCODE -ne 0) {
    throw "Could not extract the CyberCode archive."
  }

  $ArchiveEntries = @(Get-ChildItem -LiteralPath $UnpackDir -Directory)
  if ($ArchiveEntries.Count -ne 1) {
    throw "The downloaded archive has an unexpected layout."
  }
  Move-Item -LiteralPath $ArchiveEntries[0].FullName -Destination $NextDir

  $ExistingEnv = Join-Path $InstallDir ".env"
  if (Test-Path -LiteralPath $ExistingEnv) {
    Copy-Item -LiteralPath $ExistingEnv -Destination (Join-Path $NextDir ".env")
  }

  Write-Step "installing runtime dependencies"
  Push-Location $NextDir
  try {
    & $BunPath install --frozen-lockfile --production
    if ($LASTEXITCODE -ne 0) {
      throw "Bun failed to install CyberCode dependencies."
    }
  } finally {
    Pop-Location
  }

  if (-not (Test-Path -LiteralPath (Join-Path $NextDir "src\entrypoints\cli.tsx"))) {
    throw "The downloaded release does not contain the CLI entrypoint."
  }

  $BackupDir = "$InstallDir.previous"
  if (Test-Path -LiteralPath $BackupDir) {
    Remove-Item -LiteralPath $BackupDir -Recurse -Force
  }
  if (Test-Path -LiteralPath $InstallDir) {
    Move-Item -LiteralPath $InstallDir -Destination $BackupDir
  }

  try {
    Move-Item -LiteralPath $NextDir -Destination $InstallDir
  } catch {
    if ((Test-Path -LiteralPath $BackupDir) -and -not (Test-Path -LiteralPath $InstallDir)) {
      Move-Item -LiteralPath $BackupDir -Destination $InstallDir
    }
    throw
  }

  if (Test-Path -LiteralPath $BackupDir) {
    Remove-Item -LiteralPath $BackupDir -Recurse -Force
  }

  $LauncherPath = Join-Path $BinDir "cybercode.cmd"
  $Launcher = @"
@echo off
setlocal
set "CALLER_DIR=%CD%"
set "CYBERCODE_ROOT=$InstallDir"
cd /d "%CYBERCODE_ROOT%"
set "CYBERCODE_ENV_FLAG="
if "%CYBERCODE_SKIP_DOTENV%"=="1" set "CYBERCODE_ENV_FLAG=--env-file=NUL"
if "%CYBERCODE_FORCE_RECOVERY_CLI%"=="1" (
  "$BunPath" %CYBERCODE_ENV_FLAG% .\src\localRecoveryCli.ts %*
) else (
  "$BunPath" %CYBERCODE_ENV_FLAG% .\src\entrypoints\cli.tsx %*
)
set "CYBERCODE_EXIT=%ERRORLEVEL%"
endlocal & exit /b %CYBERCODE_EXIT%
"@
  Set-Content -LiteralPath $LauncherPath -Value $Launcher -Encoding Ascii

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $UserPathEntries = if ([string]::IsNullOrWhiteSpace($UserPath)) { @() } else { @($UserPath -split ';' | Where-Object { $_ }) }
  if ($UserPathEntries -notcontains $BinDir) {
    $NewUserPath = (@($BinDir) + $UserPathEntries) -join ';'
    [Environment]::SetEnvironmentVariable("Path", $NewUserPath, "User")
  }
  if (($env:Path -split ';') -notcontains $BinDir) {
    $env:Path = "$BinDir;$env:Path"
  }

  Write-Step "installed $Version at $InstallDir"
  Write-Host "Open a new terminal, then start CyberCode with:"
  Write-Host "  cybercode"
} finally {
  if (Test-Path -LiteralPath $StagingRoot) {
    Remove-Item -LiteralPath $StagingRoot -Recurse -Force
  }
}
}
