@echo off
chcp 65001 >nul
title Natu skenerio diegimas
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
