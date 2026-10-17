@echo off
rem Start Unseenet (web client) from this folder (Windows). Double-click it.
rem Windows may warn that the program is from an unknown publisher:
rem click "More info", then "Run anyway". See README-web.txt.
rem The small window that stays minimised is the client's engine: closing the
rem Unseenet window stops it.
setlocal
set "EXE=%~dp0web-windows-x86_64\unseenet-web.exe"
if not exist "%EXE%" (
    echo Unseenet web for Windows is not in this folder.
    pause
    exit /b 1
)
start "Unseenet" /min "%EXE%" %*
