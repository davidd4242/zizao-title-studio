@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1" %*
if errorlevel 1 echo Installation did not complete. See README.zh-CN.md for the explicit CEP developer-mode option.
if errorlevel 1 echo If the message says Package is incomplete, the ZIP was not fully extracted: extract it again into an empty folder and run Install.cmd once more.
pause
