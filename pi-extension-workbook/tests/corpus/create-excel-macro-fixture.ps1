param(
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$excel = $null
$workbook = $null
try {
  $fullPath = [System.IO.Path]::GetFullPath($OutputPath)
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($fullPath)) | Out-Null

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3 # msoAutomationSecurityForceDisable

  $workbook = $excel.Workbooks.Add()
  $excel.Calculation = -4135 # xlCalculationManual; Excel requires an open workbook before this can be set
  $sheet = $workbook.Worksheets.Item(1)
  $sheet.Name = 'Sentinel'
  $sheet.Range('A1').Value2 = 'Pi macro non-execution sentinel fixture'
  $sheet.Range('A2').Value2 = 42

  $thisWorkbook = $workbook.VBProject.VBComponents.Item($workbook.CodeName)
  $code = @'
Private Sub Workbook_Open()
    ThisWorkbook.Worksheets(1).Range("XFD1048576").Value2 = "PI_SENTINEL_EXECUTED"
End Sub
'@
  $thisWorkbook.CodeModule.AddFromString($code)
  $workbook.SaveAs($fullPath, 52) # xlOpenXMLWorkbookMacroEnabled
  $workbook.Close($false)
  $workbook = $null

  $hash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [ordered]@{ ok = $true; path = $fullPath; sha256 = $hash; sentinel = 'Sentinel!XFD1048576'; note = 'Macro changes only an in-memory sentinel cell if explicitly enabled.' } | ConvertTo-Json -Compress
  exit 0
} catch {
  [ordered]@{ ok = $false; error = $_.Exception.Message; hint = 'Excel must be installed and Trust access to the VBA project object model must already be enabled. This script never changes that setting.' } | ConvertTo-Json -Compress
  exit 3
} finally {
  if ($workbook -ne $null) { try { $workbook.Close($false) } catch {} }
  if ($excel -ne $null) { try { $excel.Quit() } catch {} }
  if ($thisWorkbook -ne $null) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($thisWorkbook) }
  if ($sheet -ne $null) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($sheet) }
  if ($workbook -ne $null) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($workbook) }
  if ($excel -ne $null) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
