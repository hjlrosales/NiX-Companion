param([ValidateSet('list','inspect','invoke','screenshot')][string]$Action,[int]$TargetPid=0,[string]$AutomationId='',[string]$OutputPath='')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if($Action -eq 'screenshot') {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
  $bitmap=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  try {$graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bitmap.Size);$bitmap.Save($OutputPath,[System.Drawing.Imaging.ImageFormat]::Png);Write-Output 'Screenshot saved.'} finally {$graphics.Dispose();$bitmap.Dispose()}
  exit
}
$root=[System.Windows.Automation.AutomationElement]::RootElement
$windows=$root.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
if($Action -eq 'list') {
  $result=@(foreach($window in $windows){try {@{name=$window.Current.Name;pid=$window.Current.ProcessId;automationId=$window.Current.AutomationId}}catch{}})
  ConvertTo-Json -InputObject $result -Depth 3 -Compress
  exit
}
$target=@($windows | Where-Object {$_.Current.ProcessId -eq $TargetPid})
if($target.Count -ne 1){throw 'PID must identify exactly one top-level window.'}
if($Action -eq 'inspect') {
  $controls=$target[0].FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $result=@(foreach($control in ($controls | Select-Object -First 150)){try {@{name=$control.Current.Name;automationId=$control.Current.AutomationId;type=$control.Current.ControlType.ProgrammaticName;enabled=$control.Current.IsEnabled}}catch{}})
  ConvertTo-Json -InputObject $result -Depth 3 -Compress
} else {
  if(-not $AutomationId){throw 'An exact automation ID is required.'}
  $condition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$AutomationId)
  $matches=$target[0].FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
  if($matches.Count -ne 1){throw 'Automation ID must identify exactly one control.'}
  $pattern=$matches[0].GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
  Write-Output 'Control invoked.'
}
