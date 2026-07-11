@echo off
setlocal
set "CALLER_DIR=%CD%"
set "ROOT_DIR=%~dp0.."
cd /d "%ROOT_DIR%"
set "CYBERCODE_ENV_FLAG="
if "%CYBERCODE_SKIP_DOTENV%"=="1" set "CYBERCODE_ENV_FLAG=--env-file=NUL"
if "%CYBERCODE_FORCE_RECOVERY_CLI%"=="1" (
  bun %CYBERCODE_ENV_FLAG% .\src\localRecoveryCli.ts %*
) else (
  bun %CYBERCODE_ENV_FLAG% .\src\entrypoints\cli.tsx %*
)
set "CYBERCODE_EXIT=%ERRORLEVEL%"
endlocal & exit /b %CYBERCODE_EXIT%
