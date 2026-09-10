param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$document = $null
$office = $null
$shouldQuit = $false
try {
  $extension = [System.IO.Path]::GetExtension($InputPath).ToLowerInvariant()
  if ($extension -eq '.docx') {
    $office = New-Object -ComObject Word.Application
    $shouldQuit = $true
    $office.Visible = $false
    $office.DisplayAlerts = 0
    $office.AutomationSecurity = 3
    $document = $office.Documents.Open($InputPath, $false, $true, $false)
    $document.ExportAsFixedFormat($OutputPath, 17)
  } elseif ($extension -eq '.pptx') {
    $wasRunning = @(Get-Process POWERPNT -ErrorAction SilentlyContinue).Count -gt 0
    $office = New-Object -ComObject PowerPoint.Application
    $shouldQuit = -not $wasRunning
    $office.AutomationSecurity = 3
    $document = $office.Presentations.Open($InputPath, -1, 0, 0)
    $document.SaveAs($OutputPath, 32)
  } else {
    throw 'Office rendering accepts generated DOCX and PPTX files only.'
  }
  if (-not (Test-Path -LiteralPath $OutputPath)) { throw 'Microsoft Office did not produce the PDF.' }
} finally {
  if ($null -ne $document) {
    if ([System.IO.Path]::GetExtension($InputPath) -eq '.docx') { $document.Close(0) } else { $document.Close() }
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
  }
  if ($null -ne $office) {
    if ($shouldQuit) { $office.Quit() }
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($office)
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
