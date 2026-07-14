param(
  [Parameter(Mandatory = $true)][string]$WorkbookPaths
)

$ErrorActionPreference = 'Stop'
$WorkbookPath = @($WorkbookPaths -split '\|')
$excel = $null
$controlWorkbook = $null
$results = @()
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3 # msoAutomationSecurityForceDisable
  $controlWorkbook = $excel.Workbooks.Add()
  $excel.Calculation = -4135 # xlCalculationManual; Excel requires an open workbook before this can be set

  foreach ($inputPath in @($WorkbookPath)) {
    $workbook = $null
    $sheet = $null
    try {
      $fullPath = [System.IO.Path]::GetFullPath($inputPath)
      $before = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
      $workbook = $excel.Workbooks.Open($fullPath, 0, $true)
      $sheet = $workbook.Worksheets.Item(1)
      $sentinel = $sheet.Range('XFD1048576').Value2
      $results += [ordered]@{
        path = $fullPath
        opened = $true
        readOnly = [bool]$workbook.ReadOnly
        worksheetCount = [int]$workbook.Worksheets.Count
        sentinelExecuted = ($sentinel -eq 'PI_SENTINEL_EXECUTED')
        hashUnchanged = $true
      }
      $workbook.Close($false)
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook)
      $workbook = $null
      $after = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
      $results[$results.Count - 1].hashUnchanged = ($before -eq $after)
    } catch {
      $results += [ordered]@{ path = $inputPath; opened = $false; error = $_.Exception.Message; sentinelExecuted = $null; hashUnchanged = $null }
    } finally {
      if ($sheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet) }
      if ($workbook -ne $null) { try { $workbook.Close($false) } catch {}; [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
    }
  }
  $ok = -not ($results | Where-Object { -not $_.opened -or $_.sentinelExecuted -or -not $_.hashUnchanged })
  [ordered]@{ ok = $ok; automationSecurity = 'ForceDisable'; enableEvents = $false; updateLinks = 0; calculation = 'Manual'; results = $results } | ConvertTo-Json -Depth 6 -Compress
  if ($ok) { exit 0 } else { exit 4 }
} catch {
  [ordered]@{ ok = $false; error = $_.Exception.Message; results = $results } | ConvertTo-Json -Depth 6 -Compress
  exit 5
} finally {
  if ($controlWorkbook -ne $null) { try { $controlWorkbook.Close($false) } catch {}; [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($controlWorkbook) }
  if ($excel -ne $null) { try { $excel.Quit() } catch {}; [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
