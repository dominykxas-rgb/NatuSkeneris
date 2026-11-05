@echo off
if not exist "%~dp0.venv\Scripts\pythonw.exe" (
  echo Programele dar neidiegta. Pirma paleisk Idiegti.bat
  pause
  exit /b 1
)
start "" "%~dp0.venv\Scripts\pythonw.exe" "%~dp0app\natu_skeneris.py"
