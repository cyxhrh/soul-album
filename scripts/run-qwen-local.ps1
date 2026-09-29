param(
  [ValidateSet('cn', 'intl', 'us')]
  [string]$Region = 'cn',
  [string]$BaseUrl = '',
  [ValidateSet('qwen-plus', 'qwen-flash', 'qwen3.8-flash')]
  [string]$Model = 'qwen-plus',
  [switch]$OneCall,
  [switch]$EnablePrivateQuestions
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
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
  if ($OneCall) {
    $env:SOUL_ALBUM_AI_MAX_CALLS = '1'
    Write-Host 'One-call mode: this launch allows at most one upstream model attempt; an error also uses that attempt.'
  }
  if ($EnablePrivateQuestions) {
    $env:SOUL_ALBUM_PRIVATE_AI_ENABLED = '1'
    Write-Host 'Private-question route is available locally; each browser request still requires its own content preview and consent.'
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

  Write-Host "Region: $Region; model: $Model. The key will not echo or be saved to a file."
  $secret = Read-Host 'Enter the NEW Model Studio API key' -AsSecureString
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  if ([string]::IsNullOrWhiteSpace($plainKey)) { throw 'API key cannot be empty.' }

  $env:DASHSCOPE_API_KEY = $plainKey
  $plainKey = $null
  $env:SOUL_ALBUM_QWEN_BASE_URL = $selectedBaseUrl
  $env:SOUL_ALBUM_QWEN_MODEL = $Model
  Write-Host 'This launcher holds the key in memory and passes it only to the local model server. Press Ctrl+C to stop it.'
  node dist-server/server/index.js
  if ($LASTEXITCODE -ne 0) { throw "Model server exited with code $LASTEXITCODE" }
} finally {
  Remove-Item Env:DASHSCOPE_API_KEY,Env:SOUL_ALBUM_QWEN_BASE_URL,Env:SOUL_ALBUM_QWEN_MODEL,Env:SOUL_ALBUM_QWEN_HTTPS_PROXY,Env:SOUL_ALBUM_AI_MAX_CALLS,Env:SOUL_ALBUM_PRIVATE_AI_ENABLED -ErrorAction SilentlyContinue
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
  if ($secret) { $secret.Dispose() }
  Pop-Location
}
