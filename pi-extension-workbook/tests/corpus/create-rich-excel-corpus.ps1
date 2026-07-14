param(
  [Parameter(Mandatory = $true)][string]$XlsxPath,
  [Parameter(Mandatory = $true)][string]$XlsmPath,
  [Parameter(Mandatory = $true)][string]$PngPath,
  [Parameter(Mandatory = $true)][string]$EmbeddedPath,
  [Parameter(Mandatory = $true)][string]$ConnectionUrl
)

$ErrorActionPreference = 'Stop'
$excel = $null
$controlWorkbook = $null
$reports = @()

function Release-Com([object]$Value) {
  if ($null -ne $Value -and [System.Runtime.InteropServices.Marshal]::IsComObject($Value)) {
    try { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($Value) } catch {}
  }
}

function Add-RichFeatures([object]$Workbook, [string]$TargetPath, [bool]$MacroEnabled) {
  $feature = [ordered]@{
    path = $TargetPath
    macroEnabled = $MacroEnabled
    table = $false
    chart = $false
    pivot = $false
    image = $false
    shape = $false
    formControl = $false
    activeX = $false
    activeXError = $null
    embedding = $false
    embeddingError = $null
    connectionSentinel = $false
    workbookConnection = $false
    externalLink = $false
    protection = $false
    hiddenSheets = $false
  }
  $sheet = $null
  $hidden = $null
  $veryHidden = $null
  $pivotSheet = $null
  $table = $null
  $chartObject = $null
  $pivotCache = $null
  $pivotTable = $null
  $query = $null
  $connection = $null
  $picture = $null
  $shape = $null
  $form = $null
  $activeX = $null
  $embedding = $null
  try {
    $sheet = $Workbook.Worksheets.Item(1)
    $sheet.Name = 'Data'
    $headers = @('Category', 'Amount', 'Quantity', 'Total')
    for ($column = 1; $column -le 4; $column++) { $sheet.Range("$([char](64 + $column))1").Value2 = [string]$headers[$column - 1] }
    $categories = @('Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota')
    for ($row = 2; $row -le 10; $row++) {
      $sheet.Range("A$row").Value2 = [string]$categories[$row - 2]
      $sheet.Range("B$row").Value2 = [double]($row * 10)
      $sheet.Range("C$row").Value2 = [double]($row - 1)
      $sheet.Range("D$row").Formula = "=B$row*C$row"
    }
    $header = $sheet.Range('A1:D1')
    $header.Font.Bold = $true
    $header.Font.Color = 0xFFFFFF
    $header.Interior.Color = 0x78501F
    $header.HorizontalAlignment = -4108
    $sheet.Range('B2:D10').NumberFormat = '#,##0.00'
    $sheet.Range('A1:D10').Borders.LineStyle = 1
    [void]$sheet.Range('F1:H2').Merge()
    $sheet.Range('F1').Value2 = 'Merged feature cell'
    $sheet.Range('F1').HorizontalAlignment = -4108
    $sheet.Columns.Item('A').ColumnWidth = 16
    $sheet.Columns.Item('B').ColumnWidth = 12
    $sheet.Rows.Item(1).RowHeight = 24
    $sheet.Rows.Item(9).Hidden = $true
    $sheet.Rows('6:8').Rows.Group()
    $sheet.Columns.Item('I').Hidden = $true
    $sheet.Tab.Color = 0x55AA00

    $table = $sheet.ListObjects.Add(1, $sheet.Range('A1:D10'), $null, 1)
    $table.Name = 'CorpusTable'
    $table.TableStyle = 'TableStyleMedium4'
    $feature.table = $true

    $conditionRange = $sheet.Range('B2:B10')
    $conditionRange.FormatConditions.Delete()
    $condition = $conditionRange.FormatConditions.Add(1, 5, 50)
    $condition.Interior.Color = 0xC6EFCE
    $condition.Font.Color = 0x006100
    Release-Com $condition
    Release-Com $conditionRange

    $validationRange = $sheet.Range('C2:C10')
    $validationRange.Validation.Delete()
    [void]$validationRange.Validation.Add(1, 1, 1, 1, 100)
    $validationRange.Validation.IgnoreBlank = $true
    $validationRange.Validation.InCellDropdown = $true
    Release-Com $validationRange

    $commentCell = $sheet.Range('A2')
    if ($null -ne $commentCell.Comment) { $commentCell.Comment.Delete() }
    [void]$commentCell.AddComment('Legally generated corpus note')
    Release-Com $commentCell

    $Workbook.Names.Add('CorpusAmount', "='Data'!`$B`$2:`$B`$10") | Out-Null
    $sheet.Hyperlinks.Add($sheet.Range('A10'), '', "'Data'!A1", 'Internal link', 'Top') | Out-Null

    $chartObject = $sheet.ChartObjects().Add(360, 20, 420, 240)
    $chartObject.Name = 'CorpusChart'
    $chartObject.Chart.SetSourceData($sheet.Range('A1:B10'))
    $chartObject.Chart.ChartType = 51
    $chartObject.Chart.HasTitle = $true
    $chartObject.Chart.ChartTitle.Text = 'Corpus chart'
    $feature.chart = $true

    $picture = $sheet.Shapes.AddPicture([System.IO.Path]::GetFullPath($PngPath), $false, $true, 360, 280, 120, 80)
    $picture.Name = 'CorpusImage'
    $feature.image = $true

    $shape = $sheet.Shapes.AddShape(1, 500, 280, 120, 60)
    $shape.Name = 'CorpusShape'
    $shape.TextFrame2.TextRange.Text = 'Preserve shape'
    $feature.shape = $true

    try {
      $form = $sheet.Shapes.AddFormControl(0, 640, 280, 100, 24)
      $form.Name = 'CorpusFormButton'
      $form.TextFrame.Characters().Text = 'No macro'
      $feature.formControl = $true
    } catch {
      $feature.formControl = $false
    }

    try {
      $missing = [Type]::Missing
      $activeX = $sheet.OLEObjects().Add('Forms.CommandButton.1', $missing, $false, $false, $missing, $missing, $false, 640, 320, 110, 28)
      $activeX.Name = 'CorpusActiveXButton'
      $feature.activeX = $true
    } catch {
      $feature.activeXError = $_.Exception.Message
    }

    try {
      $missing = [Type]::Missing
      $embedding = $sheet.OLEObjects().Add($missing, [System.IO.Path]::GetFullPath($EmbeddedPath), $false, $true, $missing, $missing, $false, 640, 370, 110, 28)
      $embedding.Name = 'CorpusEmbedding'
      $feature.embedding = $true
    } catch {
      $feature.embeddingError = $_.Exception.Message
    }

    $pivotSheet = $Workbook.Worksheets.Add()
    $pivotSheet.Name = 'Pivot'
    $sourceData = "'Data'!R1C1:R10C4"
    $pivotCache = $Workbook.PivotCaches().Create(1, $sourceData)
    $pivotTable = $pivotCache.CreatePivotTable($pivotSheet.Range('A3'), 'CorpusPivot')
    $pivotTable.PivotFields('Category').Orientation = 1
    [void]$pivotTable.AddDataField($pivotTable.PivotFields('Amount'), 'Sum of Amount', -4157)
    $feature.pivot = $true

    $hidden = $Workbook.Worksheets.Add()
    $hidden.Name = 'Hidden'
    $hidden.Range('A1').Value2 = 'Hidden sheet sentinel'
    $hidden.Visible = 0
    $veryHidden = $Workbook.Worksheets.Add()
    $veryHidden.Name = 'VeryHidden'
    $veryHidden.Range('A1').Value2 = 'Very hidden sheet sentinel'
    $veryHidden.Visible = 2
    $feature.hiddenSheets = $true

    $sheet.PageSetup.PrintArea = '$A$1:$H$20'
    $sheet.PageSetup.PrintTitleRows = '$1:$1'
    $sheet.PageSetup.Orientation = 2
    $sheet.PageSetup.Zoom = $false
    $sheet.PageSetup.FitToPagesWide = 1
    $sheet.PageSetup.FitToPagesTall = 1
    $sheet.PageSetup.LeftHeader = '&FPi corpus'
    $sheet.PageSetup.CenterFooter = 'Page &P of &N'
    [void]$sheet.Protect('corpus-sheet-password', $true, $true, $true, $true, $true, $true, $true, $true, $true, $true, $true, $true, $true, $true, $true)
    [void]$Workbook.Protect('corpus-book-password', $true, $false)
    $feature.protection = $true

    [void]$sheet.Activate()
    if ($null -ne $excel.ActiveWindow) {
      $excel.ActiveWindow.SplitRow = 1
      $excel.ActiveWindow.SplitColumn = 1
      $excel.ActiveWindow.FreezePanes = $true
      $excel.ActiveWindow.DisplayGridlines = $false
      $excel.ActiveWindow.Zoom = 110
    }

    try {
      $query = $sheet.QueryTables.Add("URL;$ConnectionUrl", $sheet.Range('J1'))
      $query.Name = 'PiNoRefreshSentinel'
      $query.RefreshOnFileOpen = $false
      $query.BackgroundQuery = $false
      $query.SaveData = $true
      try { $query.EnableRefresh = $false } catch {}
      $feature.connectionSentinel = $true
    } catch {
      $feature.connectionSentinel = $false
      $feature.connectionError = $_.Exception.Message
    }
    try {
      $connection = $Workbook.Connections.Add2('PiNoRefreshConnection', 'Local HTTP sentinel that must never refresh automatically', "URL;$ConnectionUrl", $ConnectionUrl, 4, $false, $false)
      try { $connection.OLEDBConnection.RefreshOnFileOpen = $false } catch {}
      try { $connection.OLEDBConnection.EnableRefresh = $false } catch {}
      $feature.workbookConnection = $true
    } catch {
      $feature.connectionAddError = $_.Exception.Message
    }

    $sheet.Range('J10').Formula = "='C:\pi-workbook-missing\[external-source.xlsx]Sheet1'!`$A`$1"
    $feature.externalLink = $true
    $excel.CalculateBeforeSave = $false
    if ($MacroEnabled) { $Workbook.Save() } else { $Workbook.SaveAs([System.IO.Path]::GetFullPath($TargetPath), 51) }
    return $feature
  } finally {
    foreach ($item in @($embedding, $activeX, $form, $shape, $picture, $connection, $query, $pivotTable, $pivotCache, $chartObject, $table, $pivotSheet, $veryHidden, $hidden, $sheet)) { Release-Com $item }
  }
}

try {
  $xlsxFull = [System.IO.Path]::GetFullPath($XlsxPath)
  $xlsmFull = [System.IO.Path]::GetFullPath($XlsmPath)
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($xlsxFull)) | Out-Null
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $controlWorkbook = $excel.Workbooks.Add()
  $excel.Calculation = -4135

  $xlsxWorkbook = $excel.Workbooks.Add()
  try {
    $generated = @(Add-RichFeatures $xlsxWorkbook $xlsxFull $false)
    $reports += @($generated | Where-Object { $_ -is [System.Collections.IDictionary] })
  } finally { $xlsxWorkbook.Close($false); Release-Com $xlsxWorkbook }

  $xlsmWorkbook = $excel.Workbooks.Open($xlsmFull, 0, $false)
  try {
    $generated = @(Add-RichFeatures $xlsmWorkbook $xlsmFull $true)
    $reports += @($generated | Where-Object { $_ -is [System.Collections.IDictionary] })
  } finally { $xlsmWorkbook.Close($false); Release-Com $xlsmWorkbook }

  $ok = -not ($reports | Where-Object { -not $_.table -or -not $_.chart -or -not $_.pivot -or -not $_.image -or -not $_.shape -or -not $_.embedding -or -not $_.hiddenSheets })
  [ordered]@{ ok = $ok; automationSecurity = 'ForceDisable'; enableEvents = $false; updateLinks = 0; calculation = 'Manual'; certificateStoreModified = $false; trustCenterModified = $false; reports = $reports } | ConvertTo-Json -Depth 8 -Compress
  if ($ok) { exit 0 } else { exit 4 }
} catch {
  [ordered]@{ ok = $false; error = $_.Exception.Message; line = $_.InvocationInfo.ScriptLineNumber; position = $_.InvocationInfo.PositionMessage; scriptStackTrace = $_.ScriptStackTrace; certificateStoreModified = $false; trustCenterModified = $false; reports = $reports } | ConvertTo-Json -Depth 8 -Compress
  exit 5
} finally {
  if ($controlWorkbook -ne $null) { try { $controlWorkbook.Close($false) } catch {}; Release-Com $controlWorkbook }
  if ($excel -ne $null) { try { $excel.Quit() } catch {}; Release-Com $excel }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
