param(
  [Parameter(Mandatory = $true)][string]$WorkbookPaths,
  [Parameter(Mandatory = $true)][string]$OwnerPath,
  [Parameter(Mandatory = $true)][string]$RenderDirectory
)

$ErrorActionPreference = 'Stop'
$paths = @($WorkbookPaths -split '\|')
$excel = $null
$controlWorkbook = $null
$results = @()
$ownerWritten = $false
try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PiExcelWindowOwner {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($OwnerPath))) | Out-Null
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetFullPath($RenderDirectory)) | Out-Null
  $beforePids = @(Get-Process -Name EXCEL -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $true
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $ownedPid = [uint32]0
  [void][PiExcelWindowOwner]::GetWindowThreadProcessId([IntPtr]$excel.Hwnd, [ref]$ownedPid)
  if ($ownedPid -le 0 -or $beforePids -contains [int]$ownedPid) { throw "Excel COM attached to a pre-existing process; refusing UI validation." }
  $ownedProcess = Get-Process -Id ([int]$ownedPid) -ErrorAction Stop
  [ordered]@{ pid = [int]$ownedPid; startTime = $ownedProcess.StartTime.ToUniversalTime().ToString('o'); hwnd = [int64]$excel.Hwnd; workerPid = $PID } | ConvertTo-Json -Compress | Set-Content -LiteralPath $OwnerPath -Encoding UTF8
  $ownerWritten = $true
  $controlWorkbook = $excel.Workbooks.Add()
  $excel.Calculation = -4135
  $excel.CalculateBeforeSave = $false

  foreach ($inputPath in $paths) {
    $workbook = $null
    $sheet = $null
    $chart = $null
    try {
      $fullPath = [System.IO.Path]::GetFullPath($inputPath)
      $beforeHash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
      $workbook = $excel.Workbooks.Open($fullPath, 0, $true)
      $worksheetCount = [int]$workbook.Worksheets.Count
      $sentinelExecuted = $false
      $chartPath = $null
      for ($sheetIndex = 1; $sheetIndex -le $worksheetCount; $sheetIndex++) {
        $candidateSheet = $null
        $chartObjects = $null
        try {
          $candidateSheet = $workbook.Worksheets.Item($sheetIndex)
          if ($candidateSheet.Range('XFD1048576').Value2 -eq 'PI_SENTINEL_EXECUTED') { $sentinelExecuted = $true }
          if ($null -eq $chartPath) {
            $chartObjects = $candidateSheet.ChartObjects()
            if ([int]$chartObjects.Count -gt 0) {
              $chart = $chartObjects.Item(1).Chart
              $safeName = [System.IO.Path]::GetFileNameWithoutExtension($fullPath) -replace '[^A-Za-z0-9._-]', '_'
              $chartPath = Join-Path ([System.IO.Path]::GetFullPath($RenderDirectory)) "$safeName-chart.png"
              [void]$chart.Export($chartPath, 'PNG', $false)
              [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($chart)
              $chart = $null
            }
          }
        } finally {
          if ($chartObjects -ne $null) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($chartObjects) }
          if ($candidateSheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($candidateSheet) }
        }
      }
      $workbook.Close($false)
      [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook)
      $workbook = $null
      $afterHash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
      $results += [ordered]@{ path = $fullPath; opened = $true; readOnly = $true; worksheetCount = $worksheetCount; sentinelExecuted = $sentinelExecuted; hashUnchanged = ($beforeHash -eq $afterHash); chartPath = $chartPath }
    } catch {
      $results += [ordered]@{ path = $inputPath; opened = $false; error = $_.Exception.Message; sentinelExecuted = $null; hashUnchanged = $null }
    } finally {
      if ($chart -ne $null) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($chart) }
      if ($sheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet) }
      if ($workbook -ne $null) { try { $workbook.Close($false) } catch {}; [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
    }
  }
  $ok = -not ($results | Where-Object { -not $_.opened -or $_.sentinelExecuted -or -not $_.hashUnchanged })
  [ordered]@{ ok = $ok; ownerPid = [int]$ownedPid; automationSecurity = 'ForceDisable'; enableEvents = $false; updateLinks = 0; calculation = 'Manual'; displayAlerts = $true; results = $results } | ConvertTo-Json -Depth 8 -Compress
  if ($ok) { exit 0 } else { exit 4 }
} catch {
  [ordered]@{ ok = $false; error = $_.Exception.Message; ownerWritten = $ownerWritten; results = $results } | ConvertTo-Json -Depth 8 -Compress
  exit 5
} finally {
  if ($controlWorkbook -ne $null) { try { $controlWorkbook.Close($false) } catch {}; [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($controlWorkbook) }
  if ($excel -ne $null) { try { $excel.Quit() } catch {}; [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
