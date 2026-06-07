@echo off
setlocal
set PORT=4217
set URL=http://127.0.0.1:%PORT%/

cd /d "%~dp0"

title Silownia (port %PORT%)
echo.
echo ========================================
echo   Silownia - lokalny serwer
echo   %URL%
echo   Zamknij to okno, zeby wylaczyc serwer.
echo ========================================
echo.

start "" "%URL%"

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 -m http.server %PORT% --bind 127.0.0.1
) else (
  python -m http.server %PORT% --bind 127.0.0.1
)
