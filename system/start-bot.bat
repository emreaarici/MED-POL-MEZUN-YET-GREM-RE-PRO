@echo off
cd /d "%~dp0"
title Medipol Mezuniyet Videosu Olusturucu Botu
echo ======================================================
echo    MEDIPOL MEZUNIYET VIDEOSU OLUSTURUCU
echo    Sunucu baslatiliyor, lutfen bekleyin...
echo ======================================================
echo.

:: Start a background command to open the browser after a 2 second delay
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:4000"

:: Run the server in this window. Closing the window will stop the server.
"%~dp0node.exe" server.js
