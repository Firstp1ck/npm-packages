@echo off
setlocal

rem Pi Web UI Windows autostart wrapper.
rem Recommended use: create a shortcut to this file in:
rem   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
rem The server starts minimized and does not open the browser/PWA automatically.
rem
rem Optional environment overrides:
rem   PI_WEBUI_NODE_EXE  Full path to node.exe when node is not on PATH.
rem   PI_WEBUI_SCRIPT    Full path to bin\pi-webui.mjs.
rem   PI_WEBUI_CWD       Working directory for Pi tabs.
rem   PI_WEBUI_HOST      HTTP bind host (default: 127.0.0.1).
rem   PI_WEBUI_PORT      HTTP port (default: 31415).

set "NODE_EXE=%PI_WEBUI_NODE_EXE%"
if not defined NODE_EXE (
  for %%I in (node.exe) do if not defined NODE_EXE set "NODE_EXE=%%~$PATH:I"
)

set "PI_WEBUI_SCRIPT_RESOLVED=%PI_WEBUI_SCRIPT%"
if defined PI_WEBUI_SCRIPT_RESOLVED if not exist "%PI_WEBUI_SCRIPT_RESOLVED%" (
  echo PI_WEBUI_SCRIPT is set but does not exist:
  echo   %PI_WEBUI_SCRIPT_RESOLVED%
  pause
  exit /b 1
)

if not defined PI_WEBUI_SCRIPT_RESOLVED if exist "%~dp0..\..\bin\pi-webui.mjs" (
  set "PI_WEBUI_SCRIPT_RESOLVED=%~dp0..\..\bin\pi-webui.mjs"
)

if not defined PI_WEBUI_SCRIPT_RESOLVED if defined PI_CODING_AGENT_DIR (
  if exist "%PI_CODING_AGENT_DIR%\npm\node_modules\@firstpick\pi-package-webui\bin\pi-webui.mjs" (
    set "PI_WEBUI_SCRIPT_RESOLVED=%PI_CODING_AGENT_DIR%\npm\node_modules\@firstpick\pi-package-webui\bin\pi-webui.mjs"
  )
)

if not defined PI_WEBUI_SCRIPT_RESOLVED if defined USERPROFILE (
  if exist "%USERPROFILE%\.pi\agent\npm\node_modules\@firstpick\pi-package-webui\bin\pi-webui.mjs" (
    set "PI_WEBUI_SCRIPT_RESOLVED=%USERPROFILE%\.pi\agent\npm\node_modules\@firstpick\pi-package-webui\bin\pi-webui.mjs"
  )
)

if not defined PI_WEBUI_SCRIPT_RESOLVED if defined APPDATA (
  if exist "%APPDATA%\npm\node_modules\@firstpick\pi-package-webui\bin\pi-webui.mjs" (
    set "PI_WEBUI_SCRIPT_RESOLVED=%APPDATA%\npm\node_modules\@firstpick\pi-package-webui\bin\pi-webui.mjs"
  )
)

set "PI_WEBUI_BIN="
if not defined PI_WEBUI_SCRIPT_RESOLVED (
  for %%I in (pi-webui.cmd pi-webui) do if not defined PI_WEBUI_BIN set "PI_WEBUI_BIN=%%~$PATH:I"
)

if defined PI_WEBUI_SCRIPT_RESOLVED (
  if not defined NODE_EXE (
    echo node.exe was not found. Install Node.js, add node.exe to PATH, or set PI_WEBUI_NODE_EXE.
    pause
    exit /b 1
  )
  if not exist "%NODE_EXE%" (
    echo node.exe was not found:
    echo   %NODE_EXE%
    pause
    exit /b 1
  )
) else if not defined PI_WEBUI_BIN (
  echo Pi Web UI was not found.
  echo Checked:
  echo   PI_WEBUI_SCRIPT
  echo   script-local ..\..\bin\pi-webui.mjs
  echo   %%PI_CODING_AGENT_DIR%%\npm\node_modules\@firstpick\pi-package-webui\bin\pi-webui.mjs
  echo   %%USERPROFILE%%\.pi\agent\npm\node_modules\@firstpick\pi-package-webui\bin\pi-webui.mjs
  echo   %%APPDATA%%\npm\node_modules\@firstpick\pi-package-webui\bin\pi-webui.mjs
  echo   pi-webui on PATH
  pause
  exit /b 1
)

if not defined PI_WEBUI_CWD if defined USERPROFILE (
  set "PI_WEBUI_CWD=%USERPROFILE%"
)
if not defined PI_WEBUI_CWD (
  set "PI_WEBUI_CWD=%CD%"
)
if not exist "%PI_WEBUI_CWD%\" (
  echo PI_WEBUI_CWD does not exist or is not a directory:
  echo   %PI_WEBUI_CWD%
  pause
  exit /b 1
)

set "PI_WEBUI_HOST_RESOLVED=%PI_WEBUI_HOST%"
if not defined PI_WEBUI_HOST_RESOLVED (
  set "PI_WEBUI_HOST_RESOLVED=127.0.0.1"
)

set "PI_WEBUI_PORT_RESOLVED=%PI_WEBUI_PORT%"
if not defined PI_WEBUI_PORT_RESOLVED (
  set "PI_WEBUI_PORT_RESOLVED=31415"
)

if defined PI_WEBUI_SCRIPT_RESOLVED (
  start "Pi Web UI" /min "%NODE_EXE%" "%PI_WEBUI_SCRIPT_RESOLVED%" --cwd "%PI_WEBUI_CWD%" --host "%PI_WEBUI_HOST_RESOLVED%" --port "%PI_WEBUI_PORT_RESOLVED%"
) else (
  start "Pi Web UI" /min "%PI_WEBUI_BIN%" --cwd "%PI_WEBUI_CWD%" --host "%PI_WEBUI_HOST_RESOLVED%" --port "%PI_WEBUI_PORT_RESOLVED%"
)

endlocal
