@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0.."
set "ENV_FILE=%ROOT%\supabase\.env.local"

if not exist "%ENV_FILE%" (
  echo [LogosIA] Arquivo de token nao encontrado:
  echo %ENV_FILE%
  echo.
  echo Rode:
  echo scripts\setup-supabase-logosia-token.cmd
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
  if /i "%%A"=="SUPABASE_ACCESS_TOKEN" set "SUPABASE_ACCESS_TOKEN=%%B"
  if /i "%%A"=="SUPABASE_PROJECT_REF" set "SUPABASE_PROJECT_REF=%%B"
)

set "SUPABASE_ACCESS_TOKEN=%SUPABASE_ACCESS_TOKEN:"=%"
set "SUPABASE_PROJECT_REF=%SUPABASE_PROJECT_REF:"=%"

if not defined SUPABASE_ACCESS_TOKEN (
  echo [LogosIA] SUPABASE_ACCESS_TOKEN nao foi definido em supabase\.env.local
  exit /b 1
)

pushd "%ROOT%" >nul
call npx supabase %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

endlocal & exit /b %EXIT_CODE%
