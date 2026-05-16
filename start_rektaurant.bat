@echo off
setlocal
cd /d "%~dp0"
start "Rektaurant Server" /min cmd /c "npm start"
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173"
