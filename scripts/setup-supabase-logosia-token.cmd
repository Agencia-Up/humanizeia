@echo off
setlocal EnableExtensions

set "ROOT=%~dp0.."
set "ENV_FILE=%ROOT%\supabase\.env.local"
set "PROJECT_REF=seyljsqmhlopkcauhlor"

echo.
echo Configuracao local do Supabase para o projeto LogosIA
echo Esse token ficara salvo apenas neste projeto, em arquivo ignorado pelo Git.
echo.
set /p TOKEN=Cole aqui o token sbp_ da conta do LogosIA: 

if "%TOKEN%"=="" (
  echo Nenhum token informado. Operacao cancelada.
  exit /b 1
)

> "%ENV_FILE%" echo SUPABASE_ACCESS_TOKEN=%TOKEN%
>> "%ENV_FILE%" echo SUPABASE_PROJECT_REF=%PROJECT_REF%

echo.
echo Arquivo salvo em:
echo %ENV_FILE%
echo.
echo Agora voce pode usar, por exemplo:
echo scripts\supabase-logosia.cmd functions list --project-ref %PROJECT_REF%

endlocal
