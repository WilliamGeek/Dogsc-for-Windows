// DogSC.cs — Native Windows x64 Thin Desktop Shell (C# 5 / .NET Framework 4.x)
// Compiled cleanly with C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe (zero external deps).
// Supports:
//   --version
//   --check [--root <dir>]
//   --install [--target <dir>] [--source <dir>] [--silent] [--no-shortcuts] [--no-registry]
//   --uninstall [--target <dir>] [--silent] [--no-shortcuts] [--no-registry]
//   Default interactive mode: single-instance WinForms tray + Win32 global hotkeys + StudioServer + Edge --app

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("DogSC Windows")]
[assembly: AssemblyDescription("DogSC Screen Studio Windows Shell")]
[assembly: AssemblyVersion("1.1.0.0")]
[assembly: AssemblyFileVersion("1.1.0.0")]

namespace DogSCDesktop
{
    internal static class Program
    {
        private const string AppVersion = "1.1.0";
        private const string SingleInstanceMutexName = "Local\\DogSC_Windows_Studio_SingleInstance";
        private const string UninstallRegPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\DogSC";
        private const string RunRegPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValueName = "DogSC";

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                Console.OutputEncoding = new UTF8Encoding(false);
            }
            catch
            {
                // Non-console WinForms GUI launches may not have an attached stdout handle
            }

            bool flagVersion = false;
            bool flagCheck = false;
            bool flagInstall = false;
            bool flagUninstall = false;
            bool flagTrayOnly = false;
            bool flagSilent = false;
            bool flagNoShortcuts = false;
            bool flagNoRegistry = false;

            string optRoot = null;
            string optRecordings = null;
            string optTarget = null;
            string optSource = null;
            int optPort = 0;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--version") flagVersion = true;
                else if (a == "--check") flagCheck = true;
                else if (a == "--install") flagInstall = true;
                else if (a == "--uninstall") flagUninstall = true;
                else if (a == "--tray-only") flagTrayOnly = true;
                else if (a == "--silent") flagSilent = true;
                else if (a == "--no-shortcuts") flagNoShortcuts = true;
                else if (a == "--no-registry") flagNoRegistry = true;
                else if (a == "--root" && i + 1 < args.Length) optRoot = args[++i];
                else if (a == "--recordings" && i + 1 < args.Length) optRecordings = args[++i];
                else if (a == "--target" && i + 1 < args.Length) optTarget = args[++i];
                else if (a == "--source" && i + 1 < args.Length) optSource = args[++i];
                else if (a == "--port" && i + 1 < args.Length)
                {
                    int parsedPort;
                    if (int.TryParse(args[++i], out parsedPort) && parsedPort > 0)
                    {
                        optPort = parsedPort;
                    }
                }
            }

            if (flagVersion)
            {
                Console.WriteLine("{\"name\":\"DogSC Windows\",\"version\":\"" + AppVersion + "\",\"arch\":\"x64\",\"shell\":\"winforms-tray-edge-app\"}");
                return 0;
            }

            if (flagCheck)
            {
                return RunEnvironmentCheck(optRoot);
            }

            if (flagInstall)
            {
                return RunInstall(optSource, optTarget, flagSilent, flagNoShortcuts, flagNoRegistry);
            }

            if (flagUninstall)
            {
                return RunUninstall(optTarget, flagSilent, flagNoShortcuts, flagNoRegistry);
            }

            return RunInteractiveShell(optRoot, optRecordings, optPort, flagTrayOnly);
        }

        private static string EscapeJson(string value)
        {
            if (value == null) return "null";
            StringBuilder sb = new StringBuilder();
            sb.Append('"');
            for (int i = 0; i < value.Length; i++)
            {
                char ch = value[i];
                if (ch == '\\') sb.Append("\\\\");
                else if (ch == '"') sb.Append("\\\"");
                else if (ch == '\r') sb.Append("\\r");
                else if (ch == '\n') sb.Append("\\n");
                else if (ch == '\t') sb.Append("\\t");
                else sb.Append(ch);
            }
            sb.Append('"');
            return sb.ToString();
        }

        internal static string ResolveAppRoot(string explicitRoot)
        {
            if (!string.IsNullOrEmpty(explicitRoot))
            {
                string full = Path.GetFullPath(explicitRoot);
                if (Directory.Exists(full)) return full;
            }

            string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? AppDomain.CurrentDomain.BaseDirectory;
            if (File.Exists(Path.Combine(exeDir, "scripts", "studio.ts")))
            {
                return exeDir;
            }

            DirectoryInfo parent = Directory.GetParent(exeDir);
            if (parent != null && File.Exists(Path.Combine(parent.FullName, "scripts", "studio.ts")))
            {
                return parent.FullName;
            }

            string cwd = Directory.GetCurrentDirectory();
            if (File.Exists(Path.Combine(cwd, "scripts", "studio.ts")))
            {
                return cwd;
            }

            return exeDir;
        }

        internal static string FindBinary(string exeName, string[] extraPaths)
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            string[] segments = pathEnv.Split(new char[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < segments.Length; i++)
            {
                string dir = segments[i].Trim().Trim('"');
                if (dir.Length == 0) continue;
                try
                {
                    string candidate = Path.Combine(dir, exeName);
                    if (File.Exists(candidate)) return candidate;
                }
                catch
                {
                    // ignore malformed PATH entries
                }
            }

            if (extraPaths != null)
            {
                for (int i = 0; i < extraPaths.Length; i++)
                {
                    string p = extraPaths[i];
                    if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
                }
            }

            return null;
        }

        internal static string FindNodeExe()
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return FindBinary("node.exe", new string[] {
                Path.Combine(pf, "nodejs", "node.exe"),
                Path.Combine(pf86, "nodejs", "node.exe"),
                Path.Combine(local, "Programs", "nodejs", "node.exe")
            });
        }

        internal static string FindFfmpegExe()
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return FindBinary("ffmpeg.exe", new string[] {
                Path.Combine(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
                @"C:\ffmpeg\bin\ffmpeg.exe"
            });
        }

        internal static string FindFfprobeExe(string ffmpegPath)
        {
            if (!string.IsNullOrEmpty(ffmpegPath))
            {
                string sibling = Path.Combine(Path.GetDirectoryName(ffmpegPath), "ffprobe.exe");
                if (File.Exists(sibling)) return sibling;
            }
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return FindBinary("ffprobe.exe", new string[] {
                Path.Combine(local, "Microsoft", "WinGet", "Links", "ffprobe.exe"),
                @"C:\ffmpeg\bin\ffprobe.exe"
            });
        }

        internal static string FindEdgeExe()
        {
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return FindBinary("msedge.exe", new string[] {
                Path.Combine(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(local, "Microsoft", "Edge", "Application", "msedge.exe")
            });
        }

        private static int RunEnvironmentCheck(string explicitRoot)
        {
            string appRoot = ResolveAppRoot(explicitRoot);
            bool hasStudioEntry = File.Exists(Path.Combine(appRoot, "scripts", "studio.ts"));
            string node = FindNodeExe();
            string ffmpeg = FindFfmpegExe();
            string ffprobe = FindFfprobeExe(ffmpeg);
            string edge = FindEdgeExe();
            bool ok = hasStudioEntry && node != null && ffmpeg != null && ffprobe != null && edge != null;

            string json = "{"
                + "\"ok\":" + (ok ? "true" : "false")
                + ",\"appRoot\":" + EscapeJson(appRoot)
                + ",\"hasStudioEntry\":" + (hasStudioEntry ? "true" : "false")
                + ",\"node\":" + EscapeJson(node)
                + ",\"ffmpeg\":" + EscapeJson(ffmpeg)
                + ",\"ffprobe\":" + EscapeJson(ffprobe)
                + ",\"msedge\":" + EscapeJson(edge)
                + "}";
            Console.WriteLine(json);
            return ok ? 0 : 1;
        }

        private static string GetDefaultInstallDir()
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(local, "Programs", "DogSC");
        }

        private static void CopyDirectoryClean(string sourceDir, string targetDir, string skipExeSelfPath)
        {
            Directory.CreateDirectory(targetDir);
            string[] dirs = Directory.GetDirectories(sourceDir);
            for (int i = 0; i < dirs.Length; i++)
            {
                string name = Path.GetFileName(dirs[i]);
                if (name == null) continue;
                string lower = name.ToLowerInvariant();
                if (lower == "recordings" || lower == "out" || lower == ".git" || lower == "dist" || lower == "node_modules" || lower == "audit-runs" || lower == "test" || lower == "__pycache__")
                {
                    continue;
                }
                CopyDirectoryClean(dirs[i], Path.Combine(targetDir, name), skipExeSelfPath);
            }

            string[] files = Directory.GetFiles(sourceDir);
            for (int i = 0; i < files.Length; i++)
            {
                string fileName = Path.GetFileName(files[i]);
                if (fileName == null) continue;
                string ext = Path.GetExtension(fileName).ToLowerInvariant();
                if (ext == ".mp4" || ext == ".jpg" || ext == ".jpeg" || ext == ".wav" || ext == ".log" || ext == ".tmp" || ext == ".sed")
                {
                    continue;
                }
                string destPath = Path.Combine(targetDir, fileName);
                if (!string.IsNullOrEmpty(skipExeSelfPath) && string.Equals(Path.GetFullPath(destPath), Path.GetFullPath(skipExeSelfPath), StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                File.Copy(files[i], destPath, true);
            }
        }

        private static void CreateShortcut(string lnkPath, string targetExe, string arguments, string workDir, string description)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
            Type scType = shortcut.GetType();
            scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe });
            if (!string.IsNullOrEmpty(arguments))
            {
                scType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { arguments });
            }
            scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workDir });
            scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe + ",0" });
            scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
            scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }

        private static int RunInstall(string optSource, string optTarget, bool silent, bool noShortcuts, bool noRegistry)
        {
            string exePath = Assembly.GetExecutingAssembly().Location;
            string sourceDir = !string.IsNullOrEmpty(optSource) ? Path.GetFullPath(optSource) : ResolveAppRoot(null);
            string targetDir = !string.IsNullOrEmpty(optTarget) ? Path.GetFullPath(optTarget) : GetDefaultInstallDir();

            if (!Directory.Exists(sourceDir))
            {
                if (!silent)
                {
                    MessageBox.Show("安装源目录不存在:\n" + sourceDir, "DogSC 安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                return 1;
            }

            Directory.CreateDirectory(targetDir);
            CopyDirectoryClean(sourceDir, targetDir, exePath);

            string installedExe = Path.Combine(targetDir, "DogSC.exe");
            if (!string.Equals(Path.GetFullPath(exePath), Path.GetFullPath(installedExe), StringComparison.OrdinalIgnoreCase))
            {
                if (File.Exists(Path.Combine(sourceDir, "DogSC.exe")))
                {
                    File.Copy(Path.Combine(sourceDir, "DogSC.exe"), installedExe, true);
                }
                else
                {
                    File.Copy(exePath, installedExe, true);
                }
            }

            Directory.CreateDirectory(Path.Combine(targetDir, "recordings"));

            if (!noShortcuts)
            {
                string programsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "DogSC");
                Directory.CreateDirectory(programsDir);
                CreateShortcut(Path.Combine(programsDir, "DogSC Studio.lnk"), installedExe, "", targetDir, "DogSC Studio Windows 桌面工作台");
                CreateShortcut(Path.Combine(programsDir, "卸载 DogSC Studio.lnk"), installedExe, "--uninstall", targetDir, "卸载 DogSC Studio");

                string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "DogSC Studio.lnk");
                CreateShortcut(desktopLnk, installedExe, "", targetDir, "DogSC Studio Windows 桌面工作台");
            }

            if (!noRegistry)
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallRegPath))
                {
                    if (key != null)
                    {
                        key.SetValue("DisplayName", "DogSC Studio (Windows)");
                        key.SetValue("DisplayVersion", AppVersion);
                        key.SetValue("Publisher", "DogSC Windows Contributors");
                        key.SetValue("InstallLocation", targetDir);
                        key.SetValue("DisplayIcon", installedExe + ",0");
                        key.SetValue("UninstallString", "\"" + installedExe + "\" --uninstall");
                        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    }
                }
            }

            Console.WriteLine("{\"ok\":true,\"action\":\"install\",\"target\":" + EscapeJson(targetDir) + "}");

            if (!silent)
            {
                DialogResult res = MessageBox.Show(
                    "DogSC Studio v" + AppVersion + " 已成功安装到:\n" + targetDir + "\n\n是否立即启动 DogSC Studio 托盘工作台？",
                    "DogSC Studio 安装完成",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Information
                );
                if (res == DialogResult.Yes && File.Exists(installedExe))
                {
                    Process.Start(new ProcessStartInfo(installedExe) { WorkingDirectory = targetDir, UseShellExecute = true });
                }
            }

            return 0;
        }

        private static int RunUninstall(string optTarget, bool silent, bool noShortcuts, bool noRegistry)
        {
            string defaultDir = GetDefaultInstallDir();
            string targetDir = !string.IsNullOrEmpty(optTarget) ? Path.GetFullPath(optTarget) : defaultDir;
            bool isCustomTarget = !string.IsNullOrEmpty(optTarget) && !string.Equals(targetDir, defaultDir, StringComparison.OrdinalIgnoreCase);

            if (!noRegistry)
            {
                try
                {
                    Registry.CurrentUser.DeleteSubKeyTree(UninstallRegPath, false);
                }
                catch { }
                try
                {
                    using (RegistryKey rk = Registry.CurrentUser.OpenSubKey(RunRegPath, true))
                    {
                        if (rk != null) rk.DeleteValue(RunValueName, false);
                    }
                }
                catch { }
            }

            if (!noShortcuts && !isCustomTarget)
            {
                try
                {
                    string programsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "DogSC");
                    if (Directory.Exists(programsDir)) Directory.Delete(programsDir, true);
                }
                catch { }
                try
                {
                    string desktopLnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "DogSC Studio.lnk");
                    if (File.Exists(desktopLnk)) File.Delete(desktopLnk);
                }
                catch { }
            }

            string selfPath = Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
            bool runningInsideTarget = selfPath.StartsWith(targetDir.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase);

            if (Directory.Exists(targetDir))
            {
                if (!runningInsideTarget)
                {
                    Directory.Delete(targetDir, true);
                }
                else
                {
                    ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c ping -n 2 127.0.0.1 >nul & rmdir /s /q \"" + targetDir + "\"");
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    Process.Start(psi);
                }
            }

            Console.WriteLine("{\"ok\":true,\"action\":\"uninstall\",\"target\":" + EscapeJson(targetDir) + "}");

            if (!silent)
            {
                MessageBox.Show("DogSC Studio 已从系统卸载。\n路径: " + targetDir, "DogSC Studio 卸载完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }

            return 0;
        }

        private static int RunInteractiveShell(string explicitRoot, string explicitRecordings, int port, bool trayOnly)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            uint showMsg = NativeWin32.RegisterWindowMessage("DogSC_Windows_ShowStudioWindow");
            bool createdNew;
            using (Mutex mutex = new Mutex(true, SingleInstanceMutexName, out createdNew))
            {
                if (!createdNew)
                {
                    NativeWin32.PostMessage(new IntPtr(0xFFFF), showMsg, IntPtr.Zero, IntPtr.Zero);
                    return 0;
                }

                string appRoot = ResolveAppRoot(explicitRoot);
                string studioScript = Path.Combine(appRoot, "scripts", "studio.ts");
                if (!File.Exists(studioScript))
                {
                    MessageBox.Show("未找到后端入口脚本:\n" + studioScript, "DogSC Studio 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }

                string nodeExe = FindNodeExe();
                if (nodeExe == null)
                {
                    MessageBox.Show("未在系统 PATH 或标准安装目录检测到 Node.js (>= 22.18.0)。", "DogSC Studio 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }

                string recDir = !string.IsNullOrEmpty(explicitRecordings)
                    ? Path.GetFullPath(explicitRecordings)
                    : Path.Combine(appRoot, "recordings");
                Directory.CreateDirectory(recDir);

                using (TrayShellContext ctx = new TrayShellContext(appRoot, studioScript, recDir, nodeExe, port, showMsg, trayOnly))
                {
                    Application.Run(ctx);
                }
            }

            return 0;
        }
    }

    internal static class NativeWin32
    {
        public const int WM_HOTKEY = 0x0312;
        public const uint MOD_ALT = 0x0001;
        public const uint MOD_CONTROL = 0x0002;
        public const uint MOD_SHIFT = 0x0004;
        public const uint MOD_NOREPEAT = 0x4000;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern uint RegisterWindowMessage(string lpString);

        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    }

    internal sealed class HotkeyHiddenForm : Form
    {
        public const int HK_OPEN_STUDIO = 1;
        public const int HK_QUICK_RECORD = 2;
        public const int HK_MARKER_TIP = 3;

        private readonly uint showWindowMsg;
        public event Action<string> OpenStudioRequested;
        public event Action MarkerTipRequested;

        public HotkeyHiddenForm(uint showMsg)
        {
            this.showWindowMsg = showMsg;
            this.ShowInTaskbar = false;
            this.WindowState = FormWindowState.Minimized;
            this.FormBorderStyle = FormBorderStyle.FixedToolWindow;
            this.Opacity = 0;
            this.Size = new Size(1, 1);
            this.StartPosition = FormStartPosition.Manual;
            this.Location = new Point(-32000, -32000);
            this.CreateHandle();
        }

        protected override void SetVisibleCore(bool value)
        {
            if (!this.IsHandleCreated)
            {
                CreateHandle();
            }
            base.SetVisibleCore(false);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            uint mods = NativeWin32.MOD_CONTROL | NativeWin32.MOD_ALT | NativeWin32.MOD_SHIFT | NativeWin32.MOD_NOREPEAT;
            NativeWin32.RegisterHotKey(this.Handle, HK_OPEN_STUDIO, mods, (uint)Keys.S);
            NativeWin32.RegisterHotKey(this.Handle, HK_QUICK_RECORD, mods, (uint)Keys.R);
            NativeWin32.RegisterHotKey(this.Handle, HK_MARKER_TIP, mods, (uint)Keys.M);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == NativeWin32.WM_HOTKEY)
            {
                int id = m.WParam.ToInt32();
                if (id == HK_OPEN_STUDIO)
                {
                    if (this.OpenStudioRequested != null) this.OpenStudioRequested(null);
                    return;
                }
                if (id == HK_QUICK_RECORD)
                {
                    if (this.OpenStudioRequested != null) this.OpenStudioRequested("action=record");
                    return;
                }
                if (id == HK_MARKER_TIP)
                {
                    if (this.MarkerTipRequested != null) this.MarkerTipRequested();
                    return;
                }
            }
            else if (this.showWindowMsg != 0 && (uint)m.Msg == this.showWindowMsg)
            {
                if (this.OpenStudioRequested != null) this.OpenStudioRequested(null);
                return;
            }
            base.WndProc(ref m);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && this.IsHandleCreated)
            {
                NativeWin32.UnregisterHotKey(this.Handle, HK_OPEN_STUDIO);
                NativeWin32.UnregisterHotKey(this.Handle, HK_QUICK_RECORD);
                NativeWin32.UnregisterHotKey(this.Handle, HK_MARKER_TIP);
            }
            base.Dispose(disposing);
        }
    }

    internal sealed class TrayShellContext : ApplicationContext
    {
        private const string RunRegPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValueName = "DogSC";
        private static readonly Regex StudioUrlRegex = new Regex(@"http://127\.0\.0\.1:\d+/web/studio\.html", RegexOptions.Compiled);

        private readonly string appRoot;
        private readonly string studioScript;
        private readonly string recordingsDir;
        private readonly string nodeExe;
        private readonly int requestedPort;
        private readonly bool trayOnly;

        private readonly HotkeyHiddenForm hotkeyForm;
        private readonly NotifyIcon trayIcon;
        private readonly ToolStripMenuItem autoStartItem;
        private readonly Icon ownedIcon;

        private Process serverProcess;
        private Process edgeProcess;
        private string studioUrl;
        private string pendingQuery;
        private bool exiting;

        public TrayShellContext(string appRoot, string studioScript, string recordingsDir, string nodeExe, int port, uint showMsg, bool trayOnly)
        {
            this.appRoot = appRoot;
            this.studioScript = studioScript;
            this.recordingsDir = recordingsDir;
            this.nodeExe = nodeExe;
            this.requestedPort = port;
            this.trayOnly = trayOnly;

            this.hotkeyForm = new HotkeyHiddenForm(showMsg);
            this.hotkeyForm.OpenStudioRequested += delegate(string query) { OpenStudioWindow(query); };
            this.hotkeyForm.MarkerTipRequested += delegate {
                this.trayIcon.ShowBalloonTip(2500, "DogSC Studio", "快捷键打点已触发：分段录制与时间线节点请从录制岛管理。", ToolTipIcon.Info);
            };

            this.ownedIcon = BuildTrayBrandIcon();

            ContextMenuStrip menu = new ContextMenuStrip();
            ToolStripMenuItem openItem = new ToolStripMenuItem("打开 DogSC Studio (Ctrl+Alt+Shift+S)");
            openItem.Click += delegate { OpenStudioWindow(null); };
            ToolStripMenuItem recItem = new ToolStripMenuItem("快速录屏 / 录制岛 (Ctrl+Alt+Shift+R)");
            recItem.Click += delegate { OpenStudioWindow("action=record"); };
            ToolStripMenuItem markerItem = new ToolStripMenuItem("录制打点提示 (Ctrl+Alt+Shift+M)");
            markerItem.Click += delegate {
                this.trayIcon.ShowBalloonTip(2500, "DogSC Studio", "分段打点热键已就绪，请在 Studio 录制岛开启多源分段录制。", ToolTipIcon.Info);
            };
            ToolStripMenuItem folderItem = new ToolStripMenuItem("打开录制目录");
            folderItem.Click += delegate {
                try { Process.Start("explorer.exe", this.recordingsDir); } catch { }
            };
            this.autoStartItem = new ToolStripMenuItem("开机自启动");
            this.autoStartItem.CheckOnClick = true;
            this.autoStartItem.Checked = IsAutoStartEnabled();
            this.autoStartItem.Click += delegate { ToggleAutoStart(); };
            ToolStripMenuItem diagItem = new ToolStripMenuItem("环境诊断");
            diagItem.Click += delegate { ShowDiagnostics(); };
            ToolStripMenuItem exitItem = new ToolStripMenuItem("退出 DogSC");
            exitItem.Click += delegate { ExitApp(); };

            menu.Items.Add(openItem);
            menu.Items.Add(recItem);
            menu.Items.Add(markerItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(folderItem);
            menu.Items.Add(this.autoStartItem);
            menu.Items.Add(diagItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            this.trayIcon = new NotifyIcon();
            this.trayIcon.Icon = this.ownedIcon ?? SystemIcons.Application;
            this.trayIcon.Text = "DogSC Studio Windows";
            this.trayIcon.ContextMenuStrip = menu;
            this.trayIcon.Visible = true;
            this.trayIcon.DoubleClick += delegate { OpenStudioWindow(null); };

            StartStudioBackend();
        }

        private Icon BuildTrayBrandIcon()
        {
            try
            {
                using (Bitmap bmp = new Bitmap(32, 32))
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);
                    using (GraphicsPath gp = new GraphicsPath())
                    {
                        int r = 7;
                        gp.AddArc(2, 2, r * 2, r * 2, 180, 90);
                        gp.AddArc(30 - r * 2, 2, r * 2, r * 2, 270, 90);
                        gp.AddArc(30 - r * 2, 30 - r * 2, r * 2, r * 2, 0, 90);
                        gp.AddArc(2, 30 - r * 2, r * 2, r * 2, 90, 90);
                        gp.CloseFigure();
                        using (SolidBrush bg = new SolidBrush(Color.FromArgb(27, 27, 26)))
                        {
                            g.FillPath(bg, gp);
                        }
                        using (Pen rim = new Pen(Color.FromArgb(62, 61, 58), 1.5f))
                        {
                            g.DrawPath(rim, gp);
                        }
                    }
                    using (SolidBrush dot = new SolidBrush(Color.FromArgb(218, 122, 82)))
                    {
                        g.FillEllipse(dot, 9, 9, 14, 14);
                    }
                    return Icon.FromHandle(bmp.GetHicon());
                }
            }
            catch
            {
                return null;
            }
        }

        private void StartStudioBackend()
        {
            StringBuilder args = new StringBuilder();
            args.Append("\"").Append(this.studioScript).Append("\" --no-browser");
            if (this.requestedPort > 0)
            {
                args.Append(" --port ").Append(this.requestedPort);
            }
            args.Append(" --recordings \"").Append(this.recordingsDir).Append("\"");

            ProcessStartInfo psi = new ProcessStartInfo(this.nodeExe, args.ToString());
            psi.WorkingDirectory = this.appRoot;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            this.serverProcess = new Process();
            this.serverProcess.StartInfo = psi;
            this.serverProcess.EnableRaisingEvents = true;
            this.serverProcess.OutputDataReceived += delegate(object sender, DataReceivedEventArgs ev) {
                if (string.IsNullOrEmpty(ev.Data)) return;
                Match m = StudioUrlRegex.Match(ev.Data);
                if (m.Success && this.studioUrl == null)
                {
                    this.studioUrl = m.Value;
                    try
                    {
                        if (!this.exiting && this.hotkeyForm.IsHandleCreated)
                        {
                            this.hotkeyForm.BeginInvoke(new MethodInvoker(delegate {
                                if (!this.trayOnly || !string.IsNullOrEmpty(this.pendingQuery))
                                {
                                    string q = this.pendingQuery;
                                    this.pendingQuery = null;
                                    OpenStudioWindow(q);
                                }
                            }));
                        }
                    }
                    catch
                    {
                        // Ignore shutdown race if form already disposed
                    }
                }
            };
            this.serverProcess.Start();
            this.serverProcess.BeginOutputReadLine();
            this.serverProcess.BeginErrorReadLine();
        }

        private void OpenStudioWindow(string query)
        {
            if (this.studioUrl == null)
            {
                this.pendingQuery = query;
                return;
            }

            string targetUrl = string.IsNullOrEmpty(query) ? this.studioUrl : (this.studioUrl + "?" + query);
            string edgeExe = Program.FindEdgeExe();
            if (edgeExe == null)
            {
                try { Process.Start(targetUrl); } catch { }
                return;
            }

            string profileDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DogSC", "EdgeAppProfile");
            Directory.CreateDirectory(profileDir);

            string args = "--app=\"" + targetUrl + "\" --user-data-dir=\"" + profileDir + "\" --window-size=1440,920 --no-first-run --no-default-browser-check";
            ProcessStartInfo psi = new ProcessStartInfo(edgeExe, args);
            psi.UseShellExecute = false;
            try
            {
                this.edgeProcess = Process.Start(psi);
            }
            catch
            {
                try { Process.Start(targetUrl); } catch { }
            }
        }

        private bool IsAutoStartEnabled()
        {
            try
            {
                using (RegistryKey rk = Registry.CurrentUser.OpenSubKey(RunRegPath, false))
                {
                    if (rk == null) return false;
                    object val = rk.GetValue(RunValueName);
                    return val != null && val.ToString().Length > 0;
                }
            }
            catch
            {
                return false;
            }
        }

        private void ToggleAutoStart()
        {
            try
            {
                using (RegistryKey rk = Registry.CurrentUser.CreateSubKey(RunRegPath))
                {
                    if (rk == null) return;
                    if (this.autoStartItem.Checked)
                    {
                        string exePath = Assembly.GetExecutingAssembly().Location;
                        rk.SetValue(RunValueName, "\"" + exePath + "\" --tray-only");
                    }
                    else
                    {
                        rk.DeleteValue(RunValueName, false);
                    }
                }
            }
            catch
            {
                this.autoStartItem.Checked = IsAutoStartEnabled();
            }
        }

        private void ShowDiagnostics()
        {
            string ffmpeg = Program.FindFfmpegExe() ?? "未检测到";
            string ffprobe = Program.FindFfprobeExe(ffmpeg == "未检测到" ? null : ffmpeg) ?? "未检测到";
            string edge = Program.FindEdgeExe() ?? "未检测到";
            string urlDisplay = this.studioUrl ?? "正在启动...";
            string msg = "工作目录: " + this.appRoot + "\n"
                + "Studio 服务: " + urlDisplay + "\n"
                + "Node.js: " + this.nodeExe + "\n"
                + "FFmpeg: " + ffmpeg + "\n"
                + "FFprobe: " + ffprobe + "\n"
                + "Microsoft Edge: " + edge + "\n\n"
                + "全局热键:\n"
                + "  Ctrl+Alt+Shift+S  打开 DogSC Studio\n"
                + "  Ctrl+Alt+Shift+R  打开快速录制岛\n"
                + "  Ctrl+Alt+Shift+M  打点提示";
            MessageBox.Show(msg, "DogSC Windows 环境诊断", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        private void KillTree(Process p)
        {
            if (p == null) return;
            try
            {
                if (!p.HasExited)
                {
                    ProcessStartInfo tk = new ProcessStartInfo("taskkill", "/F /T /PID " + p.Id);
                    tk.CreateNoWindow = true;
                    tk.UseShellExecute = false;
                    Process killer = Process.Start(tk);
                    if (killer != null) killer.WaitForExit(2000);
                }
            }
            catch { }
            try
            {
                if (!p.HasExited) p.Kill();
            }
            catch { }
        }

        private void ExitApp()
        {
            if (this.exiting) return;
            this.exiting = true;
            this.trayIcon.Visible = false;
            KillTree(this.edgeProcess);
            KillTree(this.serverProcess);
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                KillTree(this.edgeProcess);
                KillTree(this.serverProcess);
                if (this.trayIcon != null)
                {
                    this.trayIcon.Visible = false;
                    this.trayIcon.Dispose();
                }
                if (this.hotkeyForm != null)
                {
                    this.hotkeyForm.Dispose();
                }
                if (this.ownedIcon != null)
                {
                    this.ownedIcon.Dispose();
                }
            }
            base.Dispose(disposing);
        }
    }
}

