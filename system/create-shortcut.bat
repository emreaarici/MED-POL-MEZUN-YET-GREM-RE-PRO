@echo off
cd /d "%~dp0"
echo Masaustune kisayol olusturuluyor...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1"
echo.
echo Kisayol basariyla olusturuldu! 
echo Artik masaustunuzdeki 'Medipol Video Bot' kisayoluna cift tiklayarak programi baslatabilirsiniz.
echo.
pause
