param(
  [ValidateSet('cn', 'intl', 'us')]
  [string]$Region = 'cn',
  [string]$BaseUrl = ''
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

  Write-Host "Region: $Region; model: qwen-plus. The key will not echo or be saved to a file."
  $secret = Read-Host 'Enter the NEW Model Studio API key' -AsSecureString
  $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  if ([string]::IsNullOrWhiteSpace($plainKey)) { throw 'API key cannot be empty.' }

  $env:DASHSCOPE_API_KEY = $plainKey
  $plainKey = $null
  $env:SOUL_ALBUM_QWEN_BASE_URL = $selectedBaseUrl
  $env:SOUL_ALBUM_QWEN_MODEL = 'qwen-plus'
  Write-Host 'This launcher holds the key in memory and passes it only to the local model server. Press Ctrl+C to stop it.'
  node dist-server/server/index.js
  if ($LASTEXITCODE -ne 0) { throw "Model server exited with code $LASTEXITCODE" }
} finally {
  Remove-Item Env:DASHSCOPE_API_KEY,Env:SOUL_ALBUM_QWEN_BASE_URL,Env:SOUL_ALBUM_QWEN_MODEL -ErrorAction SilentlyContinue
  if ($secretPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  }
  if ($secret) { $secret.Dispose() }
  Pop-Location
}
