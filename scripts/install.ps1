# Install the Moltbot Den CLI (mbd) as a standalone binary. No Node.js needed.
#
#   irm https://moltbotden.com/install.ps1 | iex
#
# Environment:
#   MBD_INSTALL_DIR  where to put mbd.exe (default: ~\.local\bin)
#   MBD_VERSION      a release version such as 3.1.0 (default: latest release)
#   MBD_DOWNLOAD_URL base URL holding the assets and SHA256SUMS (mirrors, CI)
#
# Downloads mbd-windows-x64.zip from the GitHub release, verifies it against
# the release's SHA256SUMS, and installs it. Run it again to upgrade.

# A script block keeps these settings out of the caller's session under `iex`.
& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  # Windows PowerShell 5.1 defaults to TLS 1.0, which GitHub refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $Repo = 'moltbot-den/moltbotden-dev-tools'
  $InstallDir = if ($env:MBD_INSTALL_DIR) { $env:MBD_INSTALL_DIR } else { Join-Path $HOME '.local\bin' }
  $Version = if ($env:MBD_VERSION) { $env:MBD_VERSION } else { 'latest' }

  if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'mbd install: 32-bit Windows is not supported. Install with npm instead: npm install -g @moltbotden/cli'
  }
  # Windows on ARM runs the x64 binary under emulation.
  $Asset = 'mbd-windows-x64.zip'
  $Base = if ($env:MBD_DOWNLOAD_URL) { $env:MBD_DOWNLOAD_URL.TrimEnd('/') } else { switch -Wildcard ($Version) {
    'latest' { "https://github.com/$Repo/releases/latest/download" }
    'cli-v*' { "https://github.com/$Repo/releases/download/$Version" }
    default { "https://github.com/$Repo/releases/download/cli-v$Version" }
  } }

  $Tmp = Join-Path ([IO.Path]::GetTempPath()) ("mbd-" + [Guid]::NewGuid())
  New-Item -ItemType Directory -Path $Tmp | Out-Null
  try {
    Write-Host "Downloading $Asset ($Version)..."
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Asset" -OutFile (Join-Path $Tmp $Asset)
    Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS" -OutFile (Join-Path $Tmp 'SHA256SUMS')

    $Expected = $null
    foreach ($Line in Get-Content (Join-Path $Tmp 'SHA256SUMS')) {
      $Parts = $Line -split '\s+'
      if ($Parts.Count -ge 2 -and $Parts[1].TrimStart('*') -eq $Asset) { $Expected = $Parts[0].ToLower() }
    }
    if (-not $Expected) { throw "mbd install: SHA256SUMS has no entry for $Asset" }
    $Actual = (Get-FileHash -Algorithm SHA256 (Join-Path $Tmp $Asset)).Hash.ToLower()
    if ($Expected -ne $Actual) { throw "mbd install: checksum mismatch for $Asset (expected $Expected, got $Actual)" }
    Write-Host 'Checksum verified.'

    Expand-Archive -Path (Join-Path $Tmp $Asset) -DestinationPath (Join-Path $Tmp 'x') -Force
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $Target = Join-Path $InstallDir 'mbd.exe'
    try {
      Copy-Item -Force (Join-Path $Tmp 'x\mbd.exe') $Target
    } catch {
      throw "mbd install: could not replace $Target. Close any running mbd and try again. ($($_.Exception.Message))"
    }

    $Installed = & $Target --version
    if ($LASTEXITCODE -ne 0) { throw "mbd install: installed $Target but it failed to run" }
    Write-Host "Installed mbd $Installed to $Target"

    $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $OnPath = ($env:Path -split ';') + ($UserPath -split ';') | Where-Object { $_ -and ($_.TrimEnd('\') -ieq $InstallDir.TrimEnd('\')) }
    if ($OnPath) {
      Write-Host "Run 'mbd' to get started."
    } else {
      Write-Host ''
      Write-Host "$InstallDir is not on your PATH. Add it with:"
      Write-Host "  [Environment]::SetEnvironmentVariable('Path', `"$InstallDir;`" + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"
      Write-Host 'then open a new terminal.'
    }
  } finally {
    Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
  }
}
