# Writes its first argument to powershell.out in the current directory (checked by the tests).
param([string]$Stage = 'staging')
$message = "Deploying to $Stage"
Write-Output $message
Set-Content -Path 'powershell.out' -Value $message -Encoding ascii
