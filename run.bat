@echo off
chcp 65001 >nul
echo ========================================
echo 🚀 Rocket Crash Bot
echo ========================================
echo.
echo Запуск бота...
echo Для остановки нажмите Ctrl+C
echo.

python bot.py

if errorlevel 1 (
    echo.
    echo ❌ Ошибка запуска
    pause
)
