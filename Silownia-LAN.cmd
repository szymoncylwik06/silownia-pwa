@echo off
setlocal
set PORT=4217
set URL=http://127.0.0.1:%PORT%/

cd /d "%~dp0"

title Silownia LAN (port %PORT%)
echo.
echo ========================================
echo   Silownia - LAN (telefon w tej samej sieci)
echo   PC:      %URL%
echo   Telefon: http://ADRES-IP-PC:%PORT%/
echo.
echo   Adresy IP tego komputera:
ipconfig | findstr /i "IPv4"
echo ========================================
echo   Zamknij to okno, zeby wylaczyc serwer.
echo ========================================
echo.

start "" "%URL%"

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 serve.py --bind 0.0.0.0 --port %PORT%
) else (
  python serve.py --bind 0.0.0.0 --port %PORT%
)
