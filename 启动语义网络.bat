@echo off
cd /d "%~dp0"
title FQL Semantic Network - Local HTTP Server
"C:\anaconda\envs\codex\python.exe" "serve_semantic_network.py"
if errorlevel 1 (
  echo.
  echo Startup failed. Check the Python path and make sure port 8765 is free.
  pause
)
