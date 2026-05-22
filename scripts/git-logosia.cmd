@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0.."
set "ENV_FILE=%ROOT%\github\.env.local"

if not exist "%ENV_FILE%" (
  echo [LogosIA] Arquivo de token do GitHub nao encontrado:
  echo %ENV_FILE%
  echo.
  echo Crie esse arquivo local com:
  echo GITHUB_TOKEN=seu_token
  echo GITHUB_REMOTE=origin
  echo GITHUB_REPO=Agencia-Up/humanizeia
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
  if /i "%%A"=="GITHUB_TOKEN" set "GITHUB_TOKEN=%%B"
  if /i "%%A"=="GITHUB_REMOTE" set "GITHUB_REMOTE=%%B"
  if /i "%%A"=="GITHUB_REPO" set "GITHUB_REPO=%%B"
)

set "GITHUB_TOKEN=%GITHUB_TOKEN:"=%"
set "GITHUB_REMOTE=%GITHUB_REMOTE:"=%"
set "GITHUB_REPO=%GITHUB_REPO:"=%"

if not defined GITHUB_TOKEN (
  echo [LogosIA] GITHUB_TOKEN nao foi definido em github\.env.local
  exit /b 1
)

for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(('x-access-token:' + $env:GITHUB_TOKEN)))"`) do set "GITHUB_BASIC=%%I"

if not defined GITHUB_BASIC (
  echo [LogosIA] Nao foi possivel gerar o cabecalho de autenticacao do GitHub.
  exit /b 1
)

pushd "%ROOT%" >nul
git -c credential.helper= -c "http.https://github.com/.extraheader=AUTHORIZATION: basic %GITHUB_BASIC%" %*
set "EXIT_CODE=%ERRORLEVEL%"
popd >nul

endlocal & exit /b %EXIT_CODE%
