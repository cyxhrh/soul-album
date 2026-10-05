param(
  [ValidateSet('cn', 'intl', 'us')]
  [string]$Region = 'cn',
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'This key window requires Windows DPAPI.'
}
if ([Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA) {
  throw 'Launch this key window with powershell.exe -STA.'
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'qwen-key-store.ps1')

$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData)) {
  throw 'The current Windows user has no local application data directory.'
}
$keyPath = Join-Path (Join-Path $localAppData 'SoulAlbum') "dashscope-$Region.dpapi"
$regionName = switch ($Region) {
  'cn' { '中国内地（北京）' }
  'intl' { '新加坡' }
  'us' { '美国' }
}

function Save-KeyFromTextBox {
  param(
    [Parameter(Mandatory = $true)]
    [Windows.Forms.TextBox]$InputBox,
    [Parameter(Mandatory = $true)]
    [Windows.Forms.Label]$StatusLabel,
    [Parameter(Mandatory = $true)]
    [string]$DestinationPath
  )

  if ([string]::IsNullOrWhiteSpace($InputBox.Text)) {
    $StatusLabel.Text = '请输入 Key。'
    return $false
  }

  $characters = $null
  $secret = $null
  try {
    # A Windows Forms TextBox necessarily holds input in process memory. Move
    # it to SecureString immediately, clear the control, and never log it.
    $characters = $InputBox.Text.ToCharArray()
    $secret = [Security.SecureString]::new()
    foreach ($character in $characters) { $secret.AppendChar($character) }
    $secret.MakeReadOnly()
    $InputBox.Clear()
    Save-SoulAlbumQwenKey -Secret $secret -Path $DestinationPath
    $StatusLabel.Text = '已保存到此 Windows 账户。'
    return $true
  } catch {
    # Never display exception details: they may originate from a secret-bearing
    # operation or a path controlled by the local environment.
    if ($script:SelfTest) {
      [Console]::Error.WriteLine('GUI save self-test failed: ' + $_.Exception.GetType().Name + ' command ' + $_.Exception.CommandName + ' at line ' + $_.InvocationInfo.ScriptLineNumber)
    }
    $StatusLabel.Text = '保存失败。请检查本机账户权限后重试。'
    return $false
  } finally {
    $InputBox.Clear()
    if ($characters) { [Array]::Clear($characters, 0, $characters.Length) }
    if ($secret) { $secret.Dispose() }
  }
}

$form = [Windows.Forms.Form]::new()
$inputBox = [Windows.Forms.TextBox]::new()
$saveButton = [Windows.Forms.Button]::new()
$cancelButton = [Windows.Forms.Button]::new()
$statusLabel = [Windows.Forms.Label]::new()
$exitCode = 2
$saved = $false
$saveFailed = $false

try {
  $form.Text = '渐记 · 保存百炼 Key'
  $form.ClientSize = [Drawing.Size]::new(480, 206)
  $form.FormBorderStyle = [Windows.Forms.FormBorderStyle]::FixedDialog
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
  $form.ShowInTaskbar = $true

  $heading = [Windows.Forms.Label]::new()
  $heading.Text = "百炼地域：$regionName"
  $heading.Location = [Drawing.Point]::new(18, 17)
  $heading.AutoSize = $true
  [void]$form.Controls.Add($heading)

  $notice = [Windows.Forms.Label]::new()
  $notice.Text = '只在此窗口输入。Key 会加密保存在本机 Windows 账户中。'
  $notice.Location = [Drawing.Point]::new(18, 47)
  $notice.Size = [Drawing.Size]::new(448, 28)
  [void]$form.Controls.Add($notice)

  $inputBox.Location = [Drawing.Point]::new(18, 78)
  $inputBox.Size = [Drawing.Size]::new(444, 24)
  $inputBox.UseSystemPasswordChar = $true
  $inputBox.AccessibleName = '百炼 API Key，隐藏输入'
  [void]$form.Controls.Add($inputBox)

  $statusLabel.Location = [Drawing.Point]::new(18, 112)
  $statusLabel.Size = [Drawing.Size]::new(444, 27)
  $statusLabel.Text = if ($SelfTest) {
    '测试模式'
  } elseif (Test-Path -LiteralPath $keyPath -PathType Leaf) {
    '此地域已有保存的 Key；再次保存会替换它。'
  } else {
    '此地域尚未保存 Key。'
  }
  [void]$form.Controls.Add($statusLabel)

  $saveButton.Text = '保存'
  $saveButton.Location = [Drawing.Point]::new(274, 157)
  $saveButton.Size = [Drawing.Size]::new(90, 30)
  [void]$form.Controls.Add($saveButton)

  $cancelButton.Text = '取消'
  $cancelButton.Location = [Drawing.Point]::new(372, 157)
  $cancelButton.Size = [Drawing.Size]::new(90, 30)
  $cancelButton.DialogResult = [Windows.Forms.DialogResult]::Cancel
  [void]$form.Controls.Add($cancelButton)

  $form.AcceptButton = $saveButton
  $form.CancelButton = $cancelButton
  $form.Add_Shown({ [void]$inputBox.Focus() })
  $form.Add_FormClosed({ $inputBox.Clear() })
  $saveButton.Add_Click({
    if (Save-KeyFromTextBox -InputBox $inputBox -StatusLabel $statusLabel -DestinationPath $keyPath) {
      $script:saved = $true
      try {
        [Windows.Forms.MessageBox]::Show('已加密保存到当前 Windows 账户。以后启动本地模型服务会自动读取。', '渐记 · 保存成功', [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Information) | Out-Null
      } catch {
        # Saving has already succeeded; a notification failure must not change
        # the outcome or reveal details of the secret operation.
      }
      $form.DialogResult = [Windows.Forms.DialogResult]::OK
      $form.Close()
    } else {
      $script:saveFailed = $true
    }
  })

  if ($SelfTest) {
    if ($form.Text -ne '渐记 · 保存百炼 Key' -or
        -not $inputBox.UseSystemPasswordChar -or
        $form.AcceptButton -ne $saveButton -or
        $form.CancelButton -ne $cancelButton) {
      throw 'Key window configuration check failed.'
    }
    $testDirectory = Join-Path ([IO.Path]::GetTempPath()) ('soul-album-key-ui-' + [guid]::NewGuid().ToString('N'))
    $testPath = Join-Path $testDirectory 'synthetic.dpapi'
    try {
      $syntheticKey = [guid]::NewGuid().ToString('N')
      $inputBox.Text = $syntheticKey
      if (-not (Save-KeyFromTextBox -InputBox $inputBox -StatusLabel $statusLabel -DestinationPath $testPath)) {
        throw 'Synthetic GUI save failed.'
      }
      if (-not [IO.File]::Exists($testPath) -or
          ([IO.File]::ReadAllText($testPath)).Contains($syntheticKey) -or
          $inputBox.TextLength -ne 0) {
        throw 'Synthetic GUI privacy check failed.'
      }
      $exitCode = 0
    } finally {
      $syntheticKey = $null
      $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
      $resolvedTest = [IO.Path]::GetFullPath($testDirectory)
      $expectedPrefix = $resolvedTemp + [IO.Path]::DirectorySeparatorChar
      if (-not $resolvedTest.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase) -or
          -not ([IO.Path]::GetFileName($resolvedTest)).StartsWith('soul-album-key-ui-', [StringComparison]::Ordinal)) {
        throw 'Synthetic key test directory escaped the temporary directory.'
      }
      if ([IO.Directory]::Exists($resolvedTest)) {
        $attributes = [IO.File]::GetAttributes($resolvedTest)
        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
          throw 'Synthetic key test directory is a reparse point.'
        }
        [IO.Directory]::Delete($resolvedTest, $true)
      }
    }
  } else {
    [void]$form.ShowDialog()
    if ($saved) { $exitCode = 0 }
    elseif ($saveFailed) { $exitCode = 2 }
    else { $exitCode = 1 }
  }
} catch {
  # Keep errors from this window free of secrets and local path details.
  if ($SelfTest) {
    [Console]::Error.WriteLine('GUI self-test failed: ' + $_.Exception.GetType().Name + ' at line ' + $_.InvocationInfo.ScriptLineNumber)
  } else {
    [Windows.Forms.MessageBox]::Show('无法打开或保存百炼 Key。请关闭窗口后重试。', '渐记', [Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
  $exitCode = 2
} finally {
  $inputBox.Clear()
  $form.Dispose()
}

exit $exitCode
