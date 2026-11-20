# tools/mousehook.ps1
# Low-level Windows Mouse Hook (WH_MOUSE_LL) emitting JSONL events to stdout.
# Conforms strictly to docs/CONTRACTS.md §2.

param(
    [int]$ScreenX = 0,
    [int]$ScreenY = 0,
    [int]$ScreenW = 0,
    [int]$ScreenH = 0
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing @"
using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class DogSCMouseHook
{
    private const int WH_MOUSE_LL = 14;
    private const int WM_MOUSEMOVE = 0x0200;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_RBUTTONDOWN = 0x0204;

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT
    {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    private static IntPtr _hookID = IntPtr.Zero;
    private static LowLevelMouseProc _proc;
    private static Stopwatch _stopwatch;
    private static double _lastMoveTime = -1.0;
    private static readonly object _syncLock = new object();

    public static void Run(int sx, int sy, int sw, int sh)
    {
        try
        {
            if (!SetProcessDpiAwarenessContext(new IntPtr(-4)))
            {
                SetProcessDPIAware();
            }
        }
        catch
        {
            try { SetProcessDPIAware(); } catch { }
        }

        var screen = (sw > 0 && sh > 0)
            ? new System.Drawing.Rectangle(sx, sy, sw, sh)
            : Screen.PrimaryScreen.Bounds;
        long originUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        _stopwatch = Stopwatch.StartNew();

        // Print header line as required by CONTRACTS.md §2
        string header = string.Format(
            CultureInfo.InvariantCulture,
            "{{\"hdr\":1,\"originUnixMs\":{0},\"screen\":{{\"x\":{1},\"y\":{2},\"w\":{3},\"h\":{4}}}}}",
            originUnixMs, screen.X, screen.Y, screen.Width, screen.Height
        );
        Console.WriteLine(header);
        Console.Out.Flush();

        // Start background thread to listen for exit command 'q' or EOF on stdin
        Thread stdinThread = new Thread(ListenStdin);
        stdinThread.IsBackground = true;
        stdinThread.Start();

        _proc = HookCallback;
        using (Process curProcess = Process.GetCurrentProcess())
        using (ProcessModule curModule = curProcess.MainModule)
        {
            _hookID = SetWindowsHookEx(WH_MOUSE_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
        }

        try
        {
            Application.Run();
        }
        finally
        {
            Unhook();
        }
    }

    private static void ListenStdin()
    {
        try
        {
            while (true)
            {
                string line = Console.ReadLine();
                if (line == null || line.Trim() == "q")
                {
                    Stop();
                    break;
                }
            }
        }
        catch
        {
            Stop();
        }
    }

    public static void Stop()
    {
        Unhook();
        Environment.Exit(0);
    }

    private static void Unhook()
    {
        lock (_syncLock)
        {
            if (_hookID != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_hookID);
                _hookID = IntPtr.Zero;
            }
        }
    }

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            int msg = wParam.ToInt32();
            string kind = null;
            double nowSeconds = _stopwatch.Elapsed.TotalSeconds;

            if (msg == WM_LBUTTONDOWN)
            {
                kind = "leftClick";
            }
            else if (msg == WM_RBUTTONDOWN)
            {
                kind = "rightClick";
            }
            else if (msg == WM_MOUSEMOVE)
            {
                // Throttle move events to >= 4ms (0.004s)
                if (nowSeconds - _lastMoveTime >= 0.004)
                {
                    kind = "move";
                    _lastMoveTime = nowSeconds;
                }
            }

            if (kind != null)
            {
                MSLLHOOKSTRUCT hookStruct = (MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(MSLLHOOKSTRUCT));
                string json = string.Format(
                    CultureInfo.InvariantCulture,
                    "{{\"t\":{0:F4},\"x\":{1},\"y\":{2},\"k\":\"{3}\"}}",
                    nowSeconds, hookStruct.pt.x, hookStruct.pt.y, kind
                );
                lock (_syncLock)
                {
                    Console.WriteLine(json);
                    Console.Out.Flush();
                }
            }
        }
        return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }
}
"@

[DogSCMouseHook]::Run($ScreenX, $ScreenY, $ScreenW, $ScreenH)
