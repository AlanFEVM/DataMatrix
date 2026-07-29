param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Attach', 'Detach', 'Status')]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [Int64]$Handle,

  [int]$X = 0,
  [int]$Y = 0,
  [int]$Width = 0,
  [int]$Height = 0,
  [int]$OriginalStyle = 0,
  [int]$OriginalExStyle = 0,
  [Int64]$OriginalParent = 0
)

$source = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class DataMatrixDesktopHost
{
    public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    public const int GWL_STYLE = -16;
    public const int GWL_EXSTYLE = -20;
    public const int WS_CHILD = 0x40000000;
    public const int WS_POPUP = unchecked((int)0x80000000);
    public const int WS_EX_TOOLWINDOW = 0x00000080;
    public const int WS_EX_APPWINDOW = 0x00040000;
    public const uint SMTO_NORMAL = 0x0000;
    public const uint SWP_NOACTIVATE = 0x0010;
    public const uint SWP_FRAMECHANGED = 0x0020;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public static readonly IntPtr HWND_BOTTOM = new IntPtr(1);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

    [DllImport("user32.dll")]
    public static extern IntPtr GetParent(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hwnd, int index);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int SetWindowLong(IntPtr hwnd, int index, int value);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hwnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);

    public static IntPtr FindWallpaperHost()
    {
        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return IntPtr.Zero;

        IntPtr ignored;
        SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), IntPtr.Zero, SMTO_NORMAL, 1000, out ignored);
        SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), SMTO_NORMAL, 1000, out ignored);

        IntPtr worker = IntPtr.Zero;
        EnumWindows(delegate(IntPtr top, IntPtr lParam) {
            IntPtr desktopView = FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (desktopView != IntPtr.Zero) {
                worker = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
            }
            return true;
        }, IntPtr.Zero);

        return worker != IntPtr.Zero ? worker : progman;
    }

    public static string ClassName(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return String.Empty;
        StringBuilder value = new StringBuilder(256);
        return GetClassName(hwnd, value, value.Capacity) > 0 ? value.ToString() : String.Empty;
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp

$hwnd = [IntPtr]::new($Handle)
if (-not [DataMatrixDesktopHost]::IsWindow($hwnd)) {
  throw 'The Electron window handle is no longer valid.'
}

if ($Action -eq 'Status') {
  $parent = [DataMatrixDesktopHost]::GetParent($hwnd)
  $className = [DataMatrixDesktopHost]::ClassName($parent)
  [pscustomobject]@{
    ok = $true
    action = 'Status'
    parent = $parent.ToInt64()
    parentClass = $className
    attached = $className -eq 'WorkerW' -or $className -eq 'Progman'
  } | ConvertTo-Json -Compress
  exit 0
}

if ($Action -eq 'Attach') {
  if ($Width -le 0 -or $Height -le 0) {
    throw 'A valid target display size is required.'
  }

  $hostWindow = [DataMatrixDesktopHost]::FindWallpaperHost()
  if ($hostWindow -eq [IntPtr]::Zero) {
    throw 'Windows Explorer desktop host was not found.'
  }

  $style = [DataMatrixDesktopHost]::GetWindowLong($hwnd, [DataMatrixDesktopHost]::GWL_STYLE)
  $exStyle = [DataMatrixDesktopHost]::GetWindowLong($hwnd, [DataMatrixDesktopHost]::GWL_EXSTYLE)
  $parent = [DataMatrixDesktopHost]::GetParent($hwnd)

  [void][DataMatrixDesktopHost]::SetWindowLong(
    $hwnd,
    [DataMatrixDesktopHost]::GWL_STYLE,
    (($style -bor [DataMatrixDesktopHost]::WS_CHILD) -band (-bnot [DataMatrixDesktopHost]::WS_POPUP))
  )
  [void][DataMatrixDesktopHost]::SetWindowLong(
    $hwnd,
    [DataMatrixDesktopHost]::GWL_EXSTYLE,
    (($exStyle -bor [DataMatrixDesktopHost]::WS_EX_TOOLWINDOW) -band (-bnot [DataMatrixDesktopHost]::WS_EX_APPWINDOW))
  )
  [void][DataMatrixDesktopHost]::SetParent($hwnd, $hostWindow)

  $positioned = [DataMatrixDesktopHost]::SetWindowPos(
    $hwnd,
    [DataMatrixDesktopHost]::HWND_BOTTOM,
    $X,
    $Y,
    $Width,
    $Height,
    ([DataMatrixDesktopHost]::SWP_NOACTIVATE -bor [DataMatrixDesktopHost]::SWP_FRAMECHANGED -bor [DataMatrixDesktopHost]::SWP_SHOWWINDOW)
  )
  if (-not $positioned) {
    throw "Unable to position the desktop window. Win32 error: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
  }

  [pscustomobject]@{
    ok = $true
    action = 'Attach'
    host = $hostWindow.ToInt64()
    hostClass = [DataMatrixDesktopHost]::ClassName($hostWindow)
    originalParent = $parent.ToInt64()
    originalStyle = $style
    originalExStyle = $exStyle
  } | ConvertTo-Json -Compress
  exit 0
}

$restoreParent = [IntPtr]::new($OriginalParent)
[void][DataMatrixDesktopHost]::SetParent($hwnd, $restoreParent)
[void][DataMatrixDesktopHost]::SetWindowLong($hwnd, [DataMatrixDesktopHost]::GWL_STYLE, $OriginalStyle)
[void][DataMatrixDesktopHost]::SetWindowLong($hwnd, [DataMatrixDesktopHost]::GWL_EXSTYLE, $OriginalExStyle)
$restored = [DataMatrixDesktopHost]::SetWindowPos(
  $hwnd,
  [IntPtr]::Zero,
  0,
  0,
  0,
  0,
  ([DataMatrixDesktopHost]::SWP_NOACTIVATE -bor [DataMatrixDesktopHost]::SWP_FRAMECHANGED -bor [DataMatrixDesktopHost]::SWP_SHOWWINDOW)
)
if (-not $restored) {
  throw "Unable to restore the desktop window. Win32 error: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

[pscustomobject]@{
  ok = $true
  action = 'Detach'
  parent = ([DataMatrixDesktopHost]::GetParent($hwnd)).ToInt64()
} | ConvertTo-Json -Compress
