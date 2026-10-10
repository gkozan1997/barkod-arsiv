@echo off
chcp 65001 > nul
title Barkod ve Seri No Arsivleme Paneli
echo ===================================================================
echo           BARKOD VE SERI NO ARSIVLEME PANELI - PORT 5004
echo ===================================================================
echo.
echo Port 5004 kontrol ediliyor...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :5004 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>&1

echo.
echo Program baslatiliyor, lutfen bekleyin...
echo Tarayiciniz otomatik olarak acilacaktir: http://127.0.0.1:5004
echo.

cd /d "%~dp0"
"C:\Users\ugurk\AppData\Local\Programs\Python\Python312\python.exe" app.py

pause
