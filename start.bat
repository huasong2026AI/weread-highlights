@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM ---------- 找一个可用的 Python ----------
set "PY="
if exist "%USERPROFILE%\.workbuddy\binaries\python\envs\weread\Scripts\pythonw.exe" (
    set "PY=%USERPROFILE%\.workbuddy\binaries\python\envs\weread\Scripts\pythonw.exe"
) else (
    where py >nul 2>nul && set "PY=py -3"
)
if "%PY%"=="" (
    where python >nul 2>nul && set "PY=python"
)
if "%PY%"=="" (
    echo [错误] 未找到 Python。
    echo 本工具只需 Python 3 标准库（零依赖），请安装后重试：
    echo    https://www.python.org/downloads/
    pause
    exit /b 1
)

echo ============================================
echo   微信读书 · 热门划线摘录 - 启动
echo ============================================
echo.

echo 检查端口 8000 占用情况...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000" ^| findstr "LISTENING"') do (
    echo 正在释放被占用的端口 8000 (PID: %%a)...
    taskkill /F /PID %%a >nul 2>nul
)
timeout /t 1 /nobreak >nul

echo 正在启动服务...
start "" %PY% server.py

REM 等 2 秒后检测端口是否真的监听成功
timeout /t 2 /nobreak >nul
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>nul
if errorlevel 1 (
    echo.
    echo [错误] 服务未能启动！
    echo 请打开同目录下的 server.log 查看原因，然后重试。
    pause
    exit /b 1
)

start "" http://127.0.0.1:8000

echo.
echo ✅ 服务已启动，本窗口现在可以关掉了。
echo 之后直接用浏览器访问 http://127.0.0.1:8000 即可。
echo.
timeout /t 3 /nobreak >nul
exit /b 0