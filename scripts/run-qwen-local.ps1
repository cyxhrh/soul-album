param(
  [ValidateSet('cn', 'intl', 'us')]
  [string]$Region = 'cn',
  [string]$BaseUrl = '',
  [ValidateSet('qwen-plus', 'qwen-flash', 'qwen3.8-flash')]
  [string]$Model = 'qwen-plus',
  [switch]$OneCall,
  [ValidateRange(1, 30)]
  [Nullable[int]]$MaxCalls = $null,
  [switch]$EnablePrivateQuestions,
  [switch]$EnablePrivateChat,
  [switch]$PromptForKey
)

$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'This launcher requires Windows DPAPI for persistent key storage.'
}
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData)) {
  throw 'The current Windows user has no local application data directory.'
}
$savedKeyPath = Join-Path (Join-Path $localAppData 'SoulAlbum') "dashscope-$Region.dpapi"
$baseUrls = @{
  cn = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  intl = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
  us = 'https://dashscope-us.aliyuncs.com/compatible-mode/v1'
}
$selectedBaseUrl = if ($BaseUrl) { $BaseUrl } else { $baseUrls[$Region] }

Push-Location -LiteralPath $projectRoot
$secret = $null
$secretPointer = [IntPtr]::Zero
try {
  if (-not (Test-Path -LiteralPath 'dist-server/server/index.js' -PathType Leaf)) {
    throw 'Run npm run build:server in a terminal without the API key first.'
  }

  Remove-Item Env:SOUL_ALBUM_AI_MAX_CALLS -ErrorAction SilentlyContinue
  Remove-Item Env:SOUL_ALBUM_PRIVATE_AI_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:SOUL_ALBUM_PRIVATE_CHAT_ENABLED -ErrorAction SilentlyContinue
  if ($OneCall -and $null -ne $MaxCalls) {
    throw 'Choose either -OneCall or -MaxCalls, not both.'
  }
  if ($OneCall) {
    $env:SOUL_ALBUM_AI_MAX_CALLS = '1'
    Write-Host 'One-call mode: this launch allows at most one upstream model attempt; an error also uses that attempt.'
  } elseif ($null -ne $MaxCalls) {
    $env:SOUL_ALBUM_AI_MAX_CALLS = [string]$MaxCalls
    Write-Host "This launch allows at most $MaxCalls upstream model attempts; failures also count."
  }
  if ($EnablePrivateQuestions) {
    $env:SOUL_ALBUM_PRIVATE_AI_ENABLED = '1'
    Write-Host 'Private-question route is available locally; each browser request still requires its own content preview and consent.'
  }
  if ($EnablePrivateChat) {
    $env:SOUL_ALBUM_PRIVATE_CHAT_ENABLED = '1'
    Write-Host 'Private-chat route is available locally; sending a message in the product chat calls the configured model automatically.'
  }

  Remove-Item Env:SOUL_ALBUM_QWEN_HTTPS_PROXY -ErrorAction SilentlyContinue
  $targetUri = [Uri]$selectedBaseUrl
  if ($targetUri.Scheme -ne 'https') { throw 'The Model Studio base URL must use HTTPS.' }
  $systemProxy = [Net.WebRequest]::DefaultWebProxy
  if ($systemProxy) {
    $proxyUri = $systemProxy.GetProxy($targetUri)
    if ($proxyUri -and $proxyUri.AbsoluteUri -ne $targetUri.AbsoluteUri) {
      if ($proxyUri.Scheme -notin @('http', 'https')) {
        throw 'The system HTTPS proxy has an unsupported scheme.'
      }
      $env:SOUL_ALBUM_QWEN_HTTPS_PROXY = $proxyUri.AbsoluteUri
    }
  }
  if ($env:SOUL_ALBUM_QWEN_HTTPS_PROXY) {
    $nodeVersion = [Version]((& node --version).TrimStart('v'))
    if (($nodeVersion.Major -lt 24 -and
         -not ($nodeVersion.Major -eq 22 -and $nodeVersion -ge [Version]'22.21.0')) -or
        ($nodeVersion.Major -eq 24 -and $nodeVersion -lt [Version]'24.5.0')) {
      throw 'The system proxy requires Node.js 22.21.0+ or 24.5.0+.'
    }
  }

  # Explicit import also works when this launcher is started by a hidden
  # PowerShell window whose usual module auto-loading is unavailable.
  $securityModule = Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1'
  if ([IO.File]::Exists($securityModule)) {
    Import-Module -Name $securityModule -ErrorAction Stop
  } else {
    Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
  }

  Write-Host "Region: $Region; model: $Model. The key will not echo or be logged."
  if (-not $PromptForKey -and (Test-Path -LiteralPath $savedKeyPath -PathType Leaf)) {
    try {
      $protectedKey = [IO.File]::ReadAllText($savedKeyPath, [Text.Encoding]::ASCII).Trim()
      if ([string]::IsNullOrWhiteSpace($protectedKey)) { throw 'Empty protected key.' }
      $secret = ConvertTo-SecureString -String $protectedKey -ErrorAction Stop
      $protectedKey = $null
    } catch {
      throw "Cannot unlock the saved key for this Windows user on this computer. Replace or remove it with scripts/save-qwen-key.ps1 -Region $Region."
    }
    Write-Host "Using the saved key for region $Region from this Windows user profile."
  } elseif ($PromptForKey) {
    $secret = Read-Host 'Enter the Model Studio API key' -AsSecureString
  } else {
    throw "No saved key for region $Region. Open scripts/save-qwen-key-gui.ps1 to save one, or pass -PromptForKey for a temporary key."
  }
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  if ([string]::IsNullOrWhiteSpace($plainKey)) { throw 'API key cannot be empty.' }

  $env:DASHSCOPE_API_KEY = $plainKey
  $plainKey = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  $secretPointer = [IntPtr]::Zero
  $secret.Dispose()
  $secret = $null
  $env:SOUL_ALBUM_QWEN_BASE_URL = $selectedBaseUrl
  $env:SOUL_ALBUM_QWEN_MODEL = $Model
  Write-Host 'This launcher holds the key in memory and passes it only to the local model server. Press Ctrl+C to stop it.'
  node dist-server/server/index.js
  if ($LASTEXITCODE -ne 0) { throw "Model server exited with code $LASTEXITCODE" }
} finally {
  Remove-Item Env:DASHSCOPE_API_KEY,Env:SOUL_ALBUM_QWEN_BASE_URL,Env:SOUL_ALBUM_QWEN_MODEL,Env:SOUL_ALBUM_QWEN_HTTPS_PROXY,Env:SOUL_ALBUM_AI_MAX_CALLS,Env:SOUL_ALBUM_PRIVATE_AI_ENABLED,Env:SOUL_ALBUM_PRIVATE_CHAT_ENABLED -ErrorAction SilentlyContinue
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
  if ($secret) { $secret.Dispose() }
  Pop-Location
}
