param(
  [Parameter(Mandatory = $true)][ValidateSet('probe', 'validate', 'roundtrip', 'edit', 'hang')][string]$Action,
  [string]$InputPath,
  [string]$OutputPath,
  [string]$OperationsPath,
  [Parameter(Mandatory = $true)][string]$ControlPath
)

$ErrorActionPreference = 'Stop'
$exitCode = 0
$result = $null
$excel = $null
$controlWorkbook = $null
$workbook = $null
$ownedExcelInstance = $false
$excelProcessId = $null
$excelStartTimeUtc = $null
$sourceHashBefore = $null
$sourceHashAfter = $null

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PiWorkbookNativeMethods {
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

function Write-ControlFile {
  param([bool]$Owned)
  $directory = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($ControlPath))
  [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  $payload = [ordered]@{
    workerPid = $PID
    excelPid = $excelProcessId
    excelStartTimeUtc = $excelStartTimeUtc
    owned = $Owned
  } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($ControlPath), $payload, (New-Object System.Text.UTF8Encoding($false)))
}

function Convert-ExcelColor {
  param([string]$Hex)
  $normalized = $Hex.Trim().TrimStart('#').ToUpperInvariant()
  if ($normalized.Length -eq 8) { $normalized = $normalized.Substring(2) }
  if ($normalized -notmatch '^[0-9A-F]{6}$') { throw "Invalid RGB/ARGB color: $Hex" }
  $red = [Convert]::ToInt32($normalized.Substring(0, 2), 16)
  $green = [Convert]::ToInt32($normalized.Substring(2, 2), 16)
  $blue = [Convert]::ToInt32($normalized.Substring(4, 2), 16)
  return $red + (256 * $green) + (65536 * $blue)
}

function Set-Border {
  param($Range, [int]$Index, $Patch)
  if ($null -eq $Patch) { return }
  $border = $Range.Borders.Item($Index)
  try {
    if ($null -ne $Patch.style) {
      if ($Patch.style -eq 'none') { $border.LineStyle = -4142 } # xlLineStyleNone
      else {
        $border.LineStyle = 1 # xlContinuous; bounded candidate mapping
        $weights = @{ hair = 1; thin = 2; medium = -4138; thick = 4; double = 4 }
        $weight = $weights[$Patch.style]
        if ($null -ne $weight) { $border.Weight = $weight }
      }
    }
    if ($null -ne $Patch.color) { $border.Color = Convert-ExcelColor ([string]$Patch.color) }
  } finally {
    if ($null -ne $border) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($border) }
  }
}

function Apply-StylePatch {
  param($Range, $Style)
  if ($null -ne $Style.font) {
    if ($null -ne $Style.font.name) { $Range.Font.Name = [string]$Style.font.name }
    if ($null -ne $Style.font.size) { $Range.Font.Size = [double]$Style.font.size }
    if ($null -ne $Style.font.bold) { $Range.Font.Bold = [bool]$Style.font.bold }
    if ($null -ne $Style.font.italic) { $Range.Font.Italic = [bool]$Style.font.italic }
    if ($null -ne $Style.font.underline) { $Range.Font.Underline = if ([bool]$Style.font.underline) { 2 } else { -4142 } }
    if ($null -ne $Style.font.strike) { $Range.Font.Strikethrough = [bool]$Style.font.strike }
    if ($null -ne $Style.font.color) { $Range.Font.Color = Convert-ExcelColor ([string]$Style.font.color) }
  }
  if ($null -ne $Style.fill) {
    if ($null -ne $Style.fill.foreground) {
      $Range.Interior.Pattern = 1 # xlSolid
      $Range.Interior.Color = Convert-ExcelColor ([string]$Style.fill.foreground)
    }
  }
  if ($null -ne $Style.border) {
    Set-Border $Range 7 $Style.border.left
    Set-Border $Range 10 $Style.border.right
    Set-Border $Range 8 $Style.border.top
    Set-Border $Range 9 $Style.border.bottom
    Set-Border $Range 5 $Style.border.diagonal
  }
  if ($null -ne $Style.alignment) {
    $horizontal = @{ general = 1; left = -4131; center = -4108; right = -4152; fill = 5; justify = -4130; centerContinuous = 7; distributed = -4117 }
    $vertical = @{ top = -4160; center = -4108; bottom = -4107; justify = -4130; distributed = -4117 }
    if ($null -ne $Style.alignment.horizontal -and $null -ne $horizontal[[string]$Style.alignment.horizontal]) { $Range.HorizontalAlignment = $horizontal[[string]$Style.alignment.horizontal] }
    if ($null -ne $Style.alignment.vertical -and $null -ne $vertical[[string]$Style.alignment.vertical]) { $Range.VerticalAlignment = $vertical[[string]$Style.alignment.vertical] }
    if ($null -ne $Style.alignment.wrapText) { $Range.WrapText = [bool]$Style.alignment.wrapText }
    if ($null -ne $Style.alignment.shrinkToFit) { $Range.ShrinkToFit = [bool]$Style.alignment.shrinkToFit }
    if ($null -ne $Style.alignment.indent) { $Range.IndentLevel = [int]$Style.alignment.indent }
    if ($null -ne $Style.alignment.textRotation) { $Range.Orientation = [int]$Style.alignment.textRotation }
  }
  if ($null -ne $Style.numberFormat) { $Range.NumberFormat = [string]$Style.numberFormat }
  if ($null -ne $Style.protection) {
    if ($null -ne $Style.protection.locked) { $Range.Locked = [bool]$Style.protection.locked }
    if ($null -ne $Style.protection.hidden) { $Range.FormulaHidden = [bool]$Style.protection.hidden }
  }
}

function Apply-Operations {
  param($TargetWorkbook, [string]$JsonPath)
  if (-not (Test-Path -LiteralPath $JsonPath -PathType Leaf)) { throw "Operations file is missing: $JsonPath" }
  $parsed = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText([System.IO.Path]::GetFullPath($JsonPath)))
  $operations = if ($parsed -is [System.Array]) { $parsed } else { @($parsed) }
  $summaries = @()
  foreach ($operation in $operations) {
    $sheet = $null
    $range = $null
    try {
      $sheet = $TargetWorkbook.Worksheets.Item([string]$operation.sheet)
      if ($operation.type -in @('setValue', 'setFormula', 'clear', 'setStyle', 'merge', 'unmerge')) {
        $range = $sheet.Range([string]$operation.range)
      }
      switch ([string]$operation.type) {
        'setValue' {
          if ($null -eq $operation.value) { $range.ClearContents() }
          elseif ($operation.value -is [string]) {
            $range.NumberFormat = '@'
            $range.Value2 = [string]$operation.value
          } else { $range.Value2 = $operation.value }
        }
        'setFormula' {
          $formula = [string]$operation.formula
          if (-not $formula.StartsWith('=')) { $formula = '=' + $formula }
          try { $range.Formula2 = $formula } catch { $range.Formula = $formula }
        }
        'clear' {
          if ($operation.mode -eq 'all') { $range.Clear() } else { $range.ClearContents() }
        }
        'setStyle' { Apply-StylePatch $range $operation.style }
        'setRowHeight' {
          $endRow = if ($null -ne $operation.endRow) { [int]$operation.endRow } else { [int]$operation.startRow }
          $sheet.Range("$($operation.startRow):$endRow").RowHeight = [double]$operation.height
        }
        'setColumnWidth' {
          $endColumn = if ($null -ne $operation.endColumn) { [string]$operation.endColumn } else { [string]$operation.startColumn }
          $sheet.Range("$($operation.startColumn):$endColumn").ColumnWidth = [double]$operation.width
        }
        'merge' { $range.Merge($false) }
        'unmerge' { $range.UnMerge() }
        default { throw "Native candidate does not implement operation: $($operation.type)" }
      }
      $target = if ($null -ne $operation.range) {
        [string]$operation.range
      } elseif ($operation.type -eq 'setRowHeight') {
        $summaryEndRow = if ($null -ne $operation.endRow) { [int]$operation.endRow } else { [int]$operation.startRow }
        "$($operation.startRow):$summaryEndRow"
      } else {
        $summaryEndColumn = if ($null -ne $operation.endColumn) { [string]$operation.endColumn } else { [string]$operation.startColumn }
        "$($operation.startColumn):$summaryEndColumn"
      }
      $summaries += [ordered]@{ type = [string]$operation.type; sheet = [string]$operation.sheet; target = $target }
    } finally {
      if ($null -ne $range) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($range) }
      if ($null -ne $sheet) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet) }
    }
  }
  return $summaries
}

try {
  if (-not [Environment]::UserInteractive) { throw 'Native Excel requires an interactive logged-in Windows user.' }
  $preExistingExcelPids = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
  $excel = New-Object -ComObject Excel.Application
  $pidValue = [uint32]0
  [void][PiWorkbookNativeMethods]::GetWindowThreadProcessId([IntPtr]$excel.Hwnd, [ref]$pidValue)
  $excelProcessId = [int]$pidValue
  if ($excelProcessId -le 0) { throw 'Could not identify the Excel process created for the worker.' }
  $excelProcess = Get-Process -Id $excelProcessId -ErrorAction Stop
  $excelStartTimeUtc = $excelProcess.StartTime.ToUniversalTime().ToString('o')
  $ownedExcelInstance = -not ($preExistingExcelPids -contains $excelProcessId)
  Write-ControlFile $ownedExcelInstance
  if (-not $ownedExcelInstance) { throw 'Excel COM attached to a pre-existing process; refusing to automate or terminate it.' }

  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AlertBeforeOverwriting = $false
  $excel.ScreenUpdating = $false
  $excel.AutomationSecurity = 3 # msoAutomationSecurityForceDisable
  $controlWorkbook = $excel.Workbooks.Add()
  $excel.Calculation = -4135 # xlCalculationManual; requires an open workbook

  if ($Action -eq 'hang') {
    Start-Sleep -Seconds 600
    throw 'hang action returned unexpectedly'
  }

  $operationSummary = @()
  $sentinelExecuted = $false
  $linkCount = 0
  $connectionCount = 0
  if ($Action -ne 'probe') {
    if (-not $InputPath) { throw 'InputPath is required.' }
    $inputFullPath = [System.IO.Path]::GetFullPath($InputPath)
    if (-not (Test-Path -LiteralPath $inputFullPath -PathType Leaf)) { throw "Workbook not found: $inputFullPath" }
    $sourceHashBefore = (Get-FileHash -LiteralPath $inputFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $readOnly = ($Action -eq 'validate')
    $workbook = $excel.Workbooks.Open($inputFullPath, 0, $readOnly)
    if ($workbook.Worksheets.Count -gt 0) {
      $firstSheet = $null
      $sentinelRange = $null
      try {
        $firstSheet = $workbook.Worksheets.Item(1)
        $sentinelRange = $firstSheet.Range('XFD1048576')
        $sentinelExecuted = ($sentinelRange.Value2 -eq 'PI_SENTINEL_EXECUTED')
      } finally {
        if ($null -ne $sentinelRange) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($sentinelRange) }
        if ($null -ne $firstSheet) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($firstSheet) }
      }
    }
    try { $linkSources = $workbook.LinkSources(1); if ($null -ne $linkSources) { $linkCount = @($linkSources).Count } } catch {}
    try { $connectionCount = [int]$workbook.Connections.Count } catch {}
    if ($sentinelExecuted) { throw 'Workbook_Open sentinel executed despite forced macro security.' }

    if ($Action -eq 'edit') { $operationSummary = @(Apply-Operations $workbook $OperationsPath) }
    if ($Action -in @('roundtrip', 'edit')) {
      if (-not $OutputPath) { throw 'OutputPath is required.' }
      $outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
      if (Test-Path -LiteralPath $outputFullPath) { throw "Refusing to overwrite native candidate output: $outputFullPath" }
      [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($outputFullPath)) | Out-Null
      $extension = [System.IO.Path]::GetExtension($inputFullPath).ToLowerInvariant()
      if ($extension -ne [System.IO.Path]::GetExtension($outputFullPath).ToLowerInvariant()) { throw 'Input and output extensions must match.' }
      $fileFormat = if ($extension -eq '.xlsm') { 52 } elseif ($extension -eq '.xlsx') { 51 } else { throw "Unsupported extension: $extension" }
      $workbook.SaveAs($outputFullPath, $fileFormat)
    }

    $worksheetCount = [int]$workbook.Worksheets.Count
    $workbook.Close($false)
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook)
    $workbook = $null
    $sourceHashAfter = (Get-FileHash -LiteralPath $inputFullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($sourceHashBefore -ne $sourceHashAfter) { throw 'Native worker modified the source workbook.' }
    $outputHash = if ($OutputPath -and (Test-Path -LiteralPath $OutputPath)) { (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant() } else { $null }
  }

  $result = [ordered]@{
    ok = $true
    action = $Action
    excelVersion = [string]$excel.Version
    excelBuild = [string]$excel.Build
    excelPid = $excelProcessId
    ownedExcelProcess = $ownedExcelInstance
    automationSecurity = 'ForceDisable'
    enableEvents = $false
    updateLinks = 0
    calculation = 'Manual'
    sourceHashBefore = $sourceHashBefore
    sourceHashAfter = $sourceHashAfter
    outputHash = $outputHash
    sentinelExecuted = $sentinelExecuted
    worksheetCount = $worksheetCount
    externalLinkCount = $linkCount
    connectionCount = $connectionCount
    operations = $operationSummary
  }
} catch {
  $exitCode = 3
  $result = [ordered]@{
    ok = $false
    action = $Action
    error = $_.Exception.Message
    excelPid = $excelProcessId
    ownedExcelProcess = $ownedExcelInstance
    sourceHashBefore = $sourceHashBefore
    sourceHashAfter = $sourceHashAfter
  }
} finally {
  if ($null -ne $workbook) { try { $workbook.Close($false) } catch {}; [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
  if ($null -ne $controlWorkbook) { try { $controlWorkbook.Close($false) } catch {}; [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($controlWorkbook) }
  if ($null -ne $excel) {
    if ($ownedExcelInstance) {
      try { $excel.Interactive = $true } catch {}
      try { $excel.Quit() } catch {}
    }
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}

$result | ConvertTo-Json -Depth 8 -Compress
exit $exitCode
