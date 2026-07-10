$WshShell = New-Object -ComObject WScript.Shell
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrEmpty($ScriptDir)) { $ScriptDir = Get-Location }

$Shortcut = $WshShell.CreateShortcut([System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), 'Medipol Video Bot.lnk'))
$Shortcut.TargetPath = [System.IO.Path]::Combine($ScriptDir, 'start-bot.bat')
$Shortcut.WorkingDirectory = $ScriptDir
$Shortcut.IconLocation = "shell32.dll,136"
$Shortcut.Save()
