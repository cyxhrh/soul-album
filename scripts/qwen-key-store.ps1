function Invoke-SoulAlbumQwenKeyReplace {
  param(
    [string]$TemporaryPath,
    [string]$DestinationPath,
    [string]$BackupPath
  )
  [IO.File]::Replace($TemporaryPath, $DestinationPath, $BackupPath)
}

function Save-SoulAlbumQwenKey {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [Security.SecureString]$Secret,
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Windows DPAPI is required for persistent key storage.'
  }
  if ($Secret.Length -eq 0) { throw 'API key cannot be empty.' }
  if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Key store path must be absolute.' }

  # A PowerShell process started with a hidden window may not inherit the
  # normal module search path. Load the bundled security module explicitly.
  if (-not (Get-Command ConvertFrom-SecureString -ErrorAction SilentlyContinue)) {
    $securityModule = Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1'
    if ([IO.File]::Exists($securityModule)) {
      Import-Module -Name $securityModule -ErrorAction Stop
    } else {
      Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
    }
  }

  $directory = [IO.Path]::GetDirectoryName($Path)
  if ([string]::IsNullOrWhiteSpace($directory)) { throw 'Invalid key store directory.' }
  $temporaryPath = $null
  $backupPath = $null
  try {
    # ConvertFrom-SecureString without -Key uses DPAPI for the current Windows
    # user. Only ciphertext is written; callers retain and dispose the secret.
    $protectedKey = ConvertFrom-SecureString -SecureString $Secret
    [void][IO.Directory]::CreateDirectory($directory)
    $temporaryPath = Join-Path $directory ([IO.Path]::GetRandomFileName())
    [IO.File]::WriteAllText($temporaryPath, $protectedKey, [Text.Encoding]::ASCII)
    if ([IO.File]::Exists($Path)) {
      $backupPath = Join-Path $directory ([IO.Path]::GetRandomFileName())
      try {
        Invoke-SoulAlbumQwenKeyReplace -TemporaryPath $temporaryPath -DestinationPath $Path -BackupPath $backupPath
      } catch {
        # ReplaceFile can move the old file to the backup name before failing.
        # Restore it when the destination disappeared, and never erase a backup
        # after a failed replacement.
        if ([IO.File]::Exists($backupPath) -and -not [IO.File]::Exists($Path)) {
          try {
            [IO.File]::Move($backupPath, $Path)
            $backupPath = $null
          } catch {
            # Keep the encrypted backup for manual recovery.
          }
        }
        throw 'Key replacement failed. The old encrypted key was restored where possible; any remaining encrypted backup was preserved for recovery.'
      }
      try {
        [IO.File]::Delete($backupPath)
      } catch {
        throw 'The new key was saved, but the old encrypted backup could not be removed.'
      }
      $backupPath = $null
    } else {
      [IO.File]::Move($temporaryPath, $Path)
    }
    $temporaryPath = $null
    $protectedKey = $null
  } finally {
    if ($temporaryPath -and [IO.File]::Exists($temporaryPath)) {
      [IO.File]::Delete($temporaryPath)
    }
  }
}
