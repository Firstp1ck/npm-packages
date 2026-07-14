param([Parameter(Mandatory = $true)][int]$TargetProcessId)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PiWindowInventory {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
}
'@
$items = [System.Collections.Generic.List[object]]::new()
$callback = [PiWindowInventory+EnumWindowsProc]{
  param([IntPtr]$handle, [IntPtr]$state)
  $processId = [uint32]0
  [void][PiWindowInventory]::GetWindowThreadProcessId($handle, [ref]$processId)
  if ([int]$processId -eq $TargetProcessId -and [PiWindowInventory]::IsWindowVisible($handle)) {
    $title = [System.Text.StringBuilder]::new(1024)
    $class = [System.Text.StringBuilder]::new(256)
    [void][PiWindowInventory]::GetWindowText($handle, $title, $title.Capacity)
    [void][PiWindowInventory]::GetClassName($handle, $class, $class.Capacity)
    $items.Add([ordered]@{ hwnd = $handle.ToInt64(); title = $title.ToString(); className = $class.ToString(); visible = $true })
  }
  return $true
}
[void][PiWindowInventory]::EnumWindows($callback, [IntPtr]::Zero)
@($items) | ConvertTo-Json -Depth 4 -Compress
