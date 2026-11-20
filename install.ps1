# Jaromes Lite installer for Windows, by Vansh Bohra.
#   irm https://raw.githubusercontent.com/Vanshworkff/jaromes-lite-windows/main/install.ps1 | iex
# Downloads the newest release, installs it for your user (no admin needed) and opens it.
# Installed this way, Windows doesn't show the "Windows protected your PC" box.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'Vanshworkff/jaromes-lite-windows'
function Fail($msg) { Write-Host "x $msg" -ForegroundColor Red; throw $msg }

if (-not [Environment]::Is64BitOperatingSystem) { Fail 'Jaromes Lite needs 64-bit Windows 10 or 11.' }
Write-Host '( o_o )  Installing Jaromes Lite for Windows...' -ForegroundColor Magenta

try { $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'jaromes-lite-installer' } }
catch { Fail "Couldn't reach GitHub. Check your internet connection and try again." }
$asset = $rel.assets | Where-Object { $_.name -like '*_windows-x64-setup.exe' } | Select-Object -First 1
if (-not $asset) { Fail "Couldn't find the installer on the latest release." }

$out = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($rel.tag_name)..."
Invoke-WebRequest $asset.browser_download_url -OutFile $out -UseBasicParsing -Headers @{ 'User-Agent' = 'jaromes-lite-installer' }
Unblock-File $out

# Close a running copy, then install silently for this user.
Get-Process roamies, roamies-node, roamies-voice, roamies-hands -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $out -ArgumentList '/S' -Wait -PassThru
Remove-Item $out -Force -ErrorAction SilentlyContinue
if ($p.ExitCode) { Fail "The installer stopped with code $($p.ExitCode)." }

$app = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Jaromes Lite'), (Join-Path $env:LOCALAPPDATA 'Programs\Jaromes Lite'), (Join-Path $env:ProgramFiles 'Jaromes Lite') -Filter roamies.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $app) { Fail "Installed, but couldn't find Jaromes Lite afterwards. Look for it in the Start menu." }

Write-Host "Jaromes Lite $($rel.tag_name) is installed." -ForegroundColor Magenta
if ($env:JAROMES_NO_LAUNCH -ne '1') {
  Start-Process $app.FullName
  Write-Host 'Opening it now: look for the pink buddy in the system tray (bottom right, maybe behind the ^ arrow), and follow the setup guide.'
}
