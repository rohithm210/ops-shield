Set-Location $PSScriptRoot
Start-Process powershell -ArgumentList '-NoExit','-Command','node server.js'
Start-Sleep -Seconds 4
Start-Process powershell -ArgumentList '-NoExit','-Command','ngrok http 3000 --url https://trial-chirpy-primarily.ngrok-free.dev'
