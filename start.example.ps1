# Copy this file to start.ps1 and replace the placeholders.
# Generate each secret with:
#   -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})
$env:JWT_SECRET = "REPLACE-WITH-48-RANDOM-CHARACTERS"
$env:ENC_KEY    = "REPLACE-WITH-A-DIFFERENT-48-RANDOM-CHARACTERS"
$env:DB_MODE    = "windows"
npm start
