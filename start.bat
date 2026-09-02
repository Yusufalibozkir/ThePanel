@echo off
echo Starting ThePanel Backend Server...
echo.
cd backend
start cmd /k "npm run dev"
echo Backend started in new window
echo.
timeout /t 3
echo Starting ThePanel Frontend...
echo.
cd ..\frontend
start cmd /k "npm run dev"
echo Frontend started in new window
echo.
echo ========================================
echo ThePanel is starting!
echo ========================================
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
echo.
echo Press any key to exit this window...
pause > nul
