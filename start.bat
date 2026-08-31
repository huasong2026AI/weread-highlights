@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "PYW=%USERPROFILE%\.workbuddy\binaries\python\envs\weread\Scripts\pythonw.exe"

echo ============================================
echo   微信读书 · 热门划线摘录 - 启动
echo ============================================
echo.

if not exist "%PYW%" (
    echo [错误] 找不到 Python 环境：
    echo        %PYW%
    echo.
    echo 请重新运行 install_deps.bat 安装依赖后再试。
    echo.
    pause
    exit /b 1
)

echo 正在清理旧进程（避免端口被占）...
taskkill /F /IM pythonw.exe >nul 2>nul
taskkill /F /IM python.exe   >nul 2>nul
timeout /t 1 /nobreak >nul

echo 正在后台启动服务...
start "" "%PYW%" "%~dp0server.py"
timeout /t 2 /nobreak >nul

netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>nul
if errorlevel 1 (
    echo.
    echo [错误] 服务未能启动！
    echo 请打开同目录下的 server.log 查看原因。
    echo.
    pause
    exit /b 1
)

start "" http://127.0.0.1:8000
echo.
echo ✅ 服务已启动，本窗口可以关掉了。
echo 浏览器打开: http://127.0.0.1:8000
echo.
timeout /t 3 /nobreak >nul
exit /b 0
