param(
  [ValidateSet('cn', 'intl', 'us')]
  [string]$Region = 'cn',
  [switch]$Remove,
  [switch]$Status
)

$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'Persistent key storage requires Windows DPAPI and is unavailable on this operating system.'
}
if ($Remove -and $Status) {
  throw 'Choose either -Remove or -Status.'
}

$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData)) {
  throw 'The current Windows user has no local application data directory.'
}
$storeDirectory = Join-Path $localAppData 'SoulAlbum'
$keyPath = Join-Path $storeDirectory "dashscope-$Region.dpapi"
. (Join-Path $PSScriptRoot 'qwen-key-store.ps1')

if ($Status) {
  $state = if (Test-Path -LiteralPath $keyPath -PathType Leaf) { 'present' } else { 'absent' }
  Write-Host "Saved Model Studio key for region $Region`: $state."
  return
}

if ($Remove) {
  if (Test-Path -LiteralPath $keyPath -PathType Leaf) {
    Remove-Item -LiteralPath $keyPath -Force
    Write-Host "Saved Model Studio key for region $Region removed. Restart the local model server to stop using an already-loaded key."
  } else {
    Write-Host "No saved Model Studio key for region $Region."
  }
  return
}

$secret = $null
try {
  Write-Host "Saving a Model Studio key for region $Region to this Windows user profile. Input will not echo."
  $secret = Read-Host 'Enter the Model Studio API key' -AsSecureString
  if ($null -eq $secret -or $secret.Length -eq 0) {
    throw 'API key cannot be empty.'
  }
  Save-SoulAlbumQwenKey -Secret $secret -Path $keyPath
  Write-Host "Model Studio key saved for region $Region. The file contains only DPAPI-protected ciphertext."
} finally {
  if ($secret) { $secret.Dispose() }
}
