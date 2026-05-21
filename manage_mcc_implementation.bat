@echo off
setlocal
cd /d "%~dp0"
set "IMPLEMENTATION=%~1"
if "%IMPLEMENTATION%"=="" set /p "IMPLEMENTATION=Implementation name [rektaurant]: "
if "%IMPLEMENTATION%"=="" set "IMPLEMENTATION=rektaurant"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\mcc-implementation-relay.ps1" -Implementation "%IMPLEMENTATION%"
pause
