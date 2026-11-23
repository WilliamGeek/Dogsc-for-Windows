// DogSC.cs — Native Windows x64 Thin Desktop Shell (C# 5 / .NET Framework 4.x)
// Compiled cleanly with C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe (zero external deps).
// Supports:
//   --version
//   --check [--root <dir>]
//   --memo-check
//   --check-update [--manifest <pathOrUrl>] [--verify-file <path> --expected-sha256 <hex>]
//   --install [--target <dir>] [--source <dir>] [--silent] [--no-shortcuts] [--no-registry]
//   --uninstall [--target <dir>] [--silent] [--no-shortcuts] [--no-registry]
//   Default interactive mode: single-instance WinForms tray + Win32 global hotkeys + TeleprompterMemo + StudioServer + Edge --app

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("DogSC Windows")]
[assembly: AssemblyDescription("DogSC Screen Studio Windows Shell")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

namespace DogSCDesktop
{
    internal static class Program
    {
        internal const string AppVersion = "1.2.0";
        private const string SingleInstanceMutexName = "Local\\DogSC_Windows_Studio_SingleInstance";
        private const string UninstallRegPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\DogSC";
        private const string RunRegPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValueName = "DogSC";
        private const string DefaultUpdateManifestUrl = "https://api.github.com/repos/laogou717/dogsc/releases/latest";

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
            bool flagMemoCheck = false;
            bool flagCheckUpdate = false;
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
            string optManifest = null;
            string optVerifyFile = null;
            string optExpectedSha256 = null;
            int optPort = 0;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--version") flagVersion = true;
                else if (a == "--check") flagCheck = true;
                else if (a == "--memo-check") flagMemoCheck = true;
                else if (a == "--check-update") flagCheckUpdate = true;
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
                else if (a == "--manifest" && i + 1 < args.Length) optManifest = args[++i];
                else if (a == "--verify-file" && i + 1 < args.Length) optVerifyFile = args[++i];
                else if (a == "--expected-sha256" && i + 1 < args.Length) optExpectedSha256 = args[++i];
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

            if (flagMemoCheck)
            {
                return RunMemoCheck();
            }

            if (flagCheckUpdate)
            {
                return RunCheckUpdateCli(optManifest, optVerifyFile, optExpectedSha256);
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

        internal static string EscapeJson(string value)
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
            return FindBinary(exeName, null, extraPaths);
        }

        internal static string FindBinary(string exeName, string[] priorityPaths, string[] extraPaths)
        {
            if (priorityPaths != null)
            {
                for (int i = 0; i < priorityPaths.Length; i++)
                {
                    string p = priorityPaths[i];
                    if (!string.IsNullOrEmpty(p) && File.Exists(p)) return Path.GetFullPath(p);
                }
            }

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

        private static string[] BuildBundledRuntimeCandidates(string appRoot, string exeName)
        {
            string exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location) ?? AppDomain.CurrentDomain.BaseDirectory;
            List<string> list = new List<string>();
            if (!string.IsNullOrEmpty(appRoot))
            {
                list.Add(Path.Combine(appRoot, "runtime", exeName));
            }
            if (!string.IsNullOrEmpty(exeDir))
            {
                list.Add(Path.Combine(exeDir, "runtime", exeName));
            }
            return list.ToArray();
        }

        internal static string FindNodeExe()
        {
            return FindNodeExe(null);
        }

        internal static string FindNodeExe(string appRoot)
        {
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return FindBinary(
                "node.exe",
                BuildBundledRuntimeCandidates(appRoot, "node.exe"),
                new string[] {
                    Path.Combine(pf, "nodejs", "node.exe"),
                    Path.Combine(pf86, "nodejs", "node.exe"),
                    Path.Combine(local, "Programs", "nodejs", "node.exe")
                }
            );
        }

        internal static string FindFfmpegExe()
        {
            return FindFfmpegExe(null);
        }

        internal static string FindFfmpegExe(string appRoot)
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return FindBinary(
                "ffmpeg.exe",
                BuildBundledRuntimeCandidates(appRoot, "ffmpeg.exe"),
                new string[] {
                    Path.Combine(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
                    @"C:\ffmpeg\bin\ffmpeg.exe"
                }
            );
        }

        internal static string FindFfprobeExe(string ffmpegPath)
        {
            return FindFfprobeExe(null, ffmpegPath);
        }

        internal static string FindFfprobeExe(string appRoot, string ffmpegPath)
        {
            string[] bundled = BuildBundledRuntimeCandidates(appRoot, "ffprobe.exe");
            for (int i = 0; i < bundled.Length; i++)
            {
                if (!string.IsNullOrEmpty(bundled[i]) && File.Exists(bundled[i]))
                {
                    return Path.GetFullPath(bundled[i]);
                }
            }
            if (!string.IsNullOrEmpty(ffmpegPath))
            {
                string sibling = Path.Combine(Path.GetDirectoryName(ffmpegPath), "ffprobe.exe");
                if (File.Exists(sibling)) return sibling;
            }
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return FindBinary("ffprobe.exe", null, new string[] {
                Path.Combine(local, "Microsoft", "WinGet", "Links", "ffprobe.exe"),
                @"C:\ffmpeg\bin\ffprobe.exe"
            });
        }

        internal static string FindEdgeExe()
        {
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return FindBinary("msedge.exe", null, new string[] {
                Path.Combine(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
                Path.Combine(local, "Microsoft", "Edge", "Application", "msedge.exe")
            });
        }

        private static bool IsPortableNodeBundled(string appRoot, string resolvedNode)
        {
            if (string.IsNullOrEmpty(resolvedNode)) return false;
            string[] candidates = BuildBundledRuntimeCandidates(appRoot, "node.exe");
            string fullResolved = Path.GetFullPath(resolvedNode);
            for (int i = 0; i < candidates.Length; i++)
            {
                if (!string.IsNullOrEmpty(candidates[i]) && File.Exists(candidates[i]))
                {
                    if (string.Equals(fullResolved, Path.GetFullPath(candidates[i]), StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        private static int RunEnvironmentCheck(string explicitRoot)
        {
            string appRoot = ResolveAppRoot(explicitRoot);
            bool hasStudioEntry = File.Exists(Path.Combine(appRoot, "scripts", "studio.ts"));
            string node = FindNodeExe(appRoot);
            string ffmpeg = FindFfmpegExe(appRoot);
            string ffprobe = FindFfprobeExe(appRoot, ffmpeg);
            string edge = FindEdgeExe();
            bool portableNodeBundled = IsPortableNodeBundled(appRoot, node);
            bool ok = hasStudioEntry && node != null && ffmpeg != null && ffprobe != null && edge != null;

            string json = "{"
                + "\"ok\":" + (ok ? "true" : "false")
                + ",\"appRoot\":" + EscapeJson(appRoot)
                + ",\"hasStudioEntry\":" + (hasStudioEntry ? "true" : "false")
                + ",\"node\":" + EscapeJson(node)
                + ",\"ffmpeg\":" + EscapeJson(ffmpeg)
                + ",\"ffprobe\":" + EscapeJson(ffprobe)
                + ",\"msedge\":" + EscapeJson(edge)
                + ",\"portableNodeBundled\":" + (portableNodeBundled ? "true" : "false")
                + ",\"captureProtectedMemo\":true"
                + ",\"updateChecker\":true"
                + "}";
            Console.WriteLine(json);
            return ok ? 0 : 1;
        }

        private static int RunMemoCheck()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool applied = false;
            bool excluded = false;
            using (TeleprompterMemoForm form = new TeleprompterMemoForm(true))
            {
                form.CreateControl();
                IntPtr h = form.Handle;
                applied = h != IntPtr.Zero && form.AffinityApplied;
                excluded = form.ExcludeFromCaptureSupported;
            }
            string json = "{"
                + "\"ok\":" + (applied ? "true" : "false")
                + ",\"affinityApplied\":" + (applied ? "true" : "false")
                + ",\"captureProtected\":" + (excluded ? "true" : "false")
                + "}";
            Console.WriteLine(json);
            return applied ? 0 : 1;
        }

        private static int RunCheckUpdateCli(string manifestPathOrUrl, string verifyFile, string expectedSha256)
        {
            if (!string.IsNullOrEmpty(verifyFile))
            {
                if (!File.Exists(verifyFile))
                {
                    Console.WriteLine("{\"ok\":false,\"error\":\"File not found\"}");
                    return 1;
                }
                string actualSha = UpdateChecker.ComputeSha256Hex(verifyFile);
                if (string.IsNullOrEmpty(expectedSha256))
                {
                    Console.WriteLine("{\"ok\":true,\"file\":" + EscapeJson(verifyFile) + ",\"sha256\":" + EscapeJson(actualSha) + "}");
                    return 0;
                }
                string normalizedExpected = expectedSha256.Trim().ToLowerInvariant();
                bool match = string.Equals(actualSha, normalizedExpected, StringComparison.OrdinalIgnoreCase);
                Console.WriteLine(
                    "{\"ok\":" + (match ? "true" : "false")
                    + ",\"file\":" + EscapeJson(verifyFile)
                    + ",\"sha256\":" + EscapeJson(actualSha)
                    + ",\"expected\":" + EscapeJson(normalizedExpected)
                    + "}"
                );
                return match ? 0 : 1;
            }

            string source = string.IsNullOrEmpty(manifestPathOrUrl)
                ? (Environment.GetEnvironmentVariable("DOGSC_UPDATE_MANIFEST") ?? DefaultUpdateManifestUrl)
                : manifestPathOrUrl;
            try
            {
                UpdateManifestInfo info = UpdateChecker.FetchAndInspect(source, AppVersion);
                Console.WriteLine(
                    "{\"ok\":true,\"currentVersion\":" + EscapeJson(AppVersion)
                    + ",\"latestVersion\":" + EscapeJson(info.LatestVersion)
                    + ",\"updateAvailable\":" + (info.UpdateAvailable ? "true" : "false")
                    + ",\"sha256\":" + EscapeJson(info.Sha256)
                    + ",\"downloadUrl\":" + EscapeJson(info.DownloadUrl)
                    + "}"
                );
                return 0;
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"ok\":false,\"error\":" + EscapeJson(ex.Message) + "}");
                return 1;
            }
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

                string nodeExe = FindNodeExe(appRoot);
                if (nodeExe == null)
                {
                    MessageBox.Show("未在系统 PATH、标准安装目录或随包 runtime\\ 检测到 Node.js (>= 22.18.0)。", "DogSC Studio 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
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

    internal sealed class UpdateManifestInfo
    {
        public string CurrentVersion;
        public string LatestVersion;
        public bool UpdateAvailable;
        public string Sha256;
        public string DownloadUrl;
        public string Notes;
    }

    internal static class UpdateChecker
    {
        public static int[] ParseSemVer(string raw)
        {
            int[] parts = new int[3];
            if (string.IsNullOrEmpty(raw)) return parts;
            string s = raw.Trim();
            if (s.StartsWith("v", StringComparison.OrdinalIgnoreCase))
            {
                s = s.Substring(1);
            }
            int dash = s.IndexOf('-');
            if (dash >= 0) s = s.Substring(0, dash);
            string[] segs = s.Split('.');
            for (int i = 0; i < 3 && i < segs.Length; i++)
            {
                int val;
                if (int.TryParse(segs[i], out val))
                {
                    parts[i] = val;
                }
            }
            return parts;
        }

        public static int CompareSemVer(string a, string b)
        {
            int[] pa = ParseSemVer(a);
            int[] pb = ParseSemVer(b);
            for (int i = 0; i < 3; i++)
            {
                if (pa[i] < pb[i]) return -1;
                if (pa[i] > pb[i]) return 1;
            }
            return 0;
        }

        public static string ComputeSha256Hex(string filePath)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream fs = File.OpenRead(filePath))
            {
                byte[] hash = sha.ComputeHash(fs);
                StringBuilder sb = new StringBuilder(hash.Length * 2);
                for (int i = 0; i < hash.Length; i++)
                {
                    sb.Append(hash[i].ToString("x2"));
                }
                return sb.ToString();
            }
        }

        private static string ExtractJsonString(string json, string key)
        {
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return null;
            string pattern = "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"";
            Match m = Regex.Match(json, pattern, RegexOptions.IgnoreCase);
            if (!m.Success) return null;
            string raw = m.Groups[1].Value;
            return raw.Replace("\\\"", "\"").Replace("\\\\", "\\").Replace("\\n", "\n").Replace("\\r", "").Replace("\\/", "/");
        }

        public static UpdateManifestInfo FetchAndInspect(string manifestPathOrUrl, string currentVersion)
        {
            string rawJson;
            if (File.Exists(manifestPathOrUrl))
            {
                rawJson = File.ReadAllText(manifestPathOrUrl, Encoding.UTF8);
            }
            else
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls;
                using (WebClient wc = new WebClient())
                {
                    wc.Encoding = Encoding.UTF8;
                    wc.Headers.Add("User-Agent", "DogSC-Windows/" + currentVersion);
                    rawJson = wc.DownloadString(manifestPathOrUrl);
                }
            }

            string latest = ExtractJsonString(rawJson, "version");
            if (string.IsNullOrEmpty(latest))
            {
                latest = ExtractJsonString(rawJson, "tag_name");
            }
            if (string.IsNullOrEmpty(latest))
            {
                latest = currentVersion;
            }

            string url = ExtractJsonString(rawJson, "downloadUrl");
            if (string.IsNullOrEmpty(url)) url = ExtractJsonString(rawJson, "browser_download_url");
            if (string.IsNullOrEmpty(url)) url = ExtractJsonString(rawJson, "html_url");

            string sha256 = ExtractJsonString(rawJson, "sha256");
            string notes = ExtractJsonString(rawJson, "notes");
            if (string.IsNullOrEmpty(notes)) notes = ExtractJsonString(rawJson, "body");

            UpdateManifestInfo info = new UpdateManifestInfo();
            info.CurrentVersion = currentVersion;
            info.LatestVersion = latest.Trim().TrimStart('v', 'V');
            info.UpdateAvailable = CompareSemVer(currentVersion, info.LatestVersion) < 0;
            info.Sha256 = sha256;
            info.DownloadUrl = url;
            info.Notes = notes;
            return info;
        }
    }

    internal static class NativeWin32
    {
        public const int WM_HOTKEY = 0x0312;
        public const uint MOD_ALT = 0x0001;
        public const uint MOD_CONTROL = 0x0002;
        public const uint MOD_SHIFT = 0x0004;
        public const uint MOD_NOREPEAT = 0x4000;
        public const uint WDA_MONITOR = 0x00000001;
        public const uint WDA_EXCLUDEFROMCAPTURE = 0x00000011;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern uint RegisterWindowMessage(string lpString);

        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    }

    internal sealed class TeleprompterMemoForm : Form
    {
        private readonly bool headlessCheck;
        private readonly string storagePath;
        private readonly Label statusBadge;
        private readonly TextBox editor;
        private readonly System.Windows.Forms.Timer saveTimer;
        private readonly double[] opacityLevels = new double[] { 0.96, 0.78, 0.58 };
        private int opacityIndex;
        private float currentFontSize = 11.5f;
        private bool allowDispose;

        public bool AffinityApplied { get; private set; }
        public bool ExcludeFromCaptureSupported { get; private set; }

        public TeleprompterMemoForm(bool headlessCheck)
        {
            this.headlessCheck = headlessCheck;
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DogSC");
            this.storagePath = Path.Combine(dir, "teleprompter-memo.txt");

            this.Text = "DogSC 提词备忘录（防录屏隐身）";
            this.Size = new Size(340, 260);
            this.MinimumSize = new Size(250, 170);
            this.StartPosition = FormStartPosition.Manual;
            Rectangle wa = Screen.PrimaryScreen != null ? Screen.PrimaryScreen.WorkingArea : new Rectangle(0, 0, 1280, 720);
            this.Location = new Point(Math.Max(16, wa.Right - 368), Math.Max(16, wa.Top + 64));
            this.TopMost = true;
            this.ShowInTaskbar = false;
            this.FormBorderStyle = FormBorderStyle.SizableToolWindow;
            this.BackColor = Color.FromArgb(27, 27, 26);
            this.ForeColor = Color.FromArgb(236, 236, 233);
            this.Opacity = this.opacityLevels[0];

            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 32;
            header.BackColor = Color.FromArgb(35, 35, 34);
            header.Padding = new Padding(8, 4, 8, 4);

            this.statusBadge = new Label();
            this.statusBadge.Text = "防录屏隐身初始化…";
            this.statusBadge.AutoSize = true;
            this.statusBadge.ForeColor = Color.FromArgb(218, 122, 82);
            this.statusBadge.Font = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Bold);
            this.statusBadge.Location = new Point(8, 8);

            FlowLayoutPanel tools = new FlowLayoutPanel();
            tools.Dock = DockStyle.Right;
            tools.AutoSize = true;
            tools.FlowDirection = FlowDirection.LeftToRight;
            tools.WrapContents = false;

            Button fontDown = MakeToolBtn("A-", "缩小字号");
            fontDown.Click += delegate { AdjustFontSize(-1.0f); };
            Button fontUp = MakeToolBtn("A+", "放大字号");
            fontUp.Click += delegate { AdjustFontSize(1.0f); };
            Button opacityBtn = MakeToolBtn("透明", "切换透明度");
            opacityBtn.Width = 42;
            opacityBtn.Click += delegate { CycleOpacity(); };

            tools.Controls.Add(fontDown);
            tools.Controls.Add(fontUp);
            tools.Controls.Add(opacityBtn);

            header.Controls.Add(this.statusBadge);
            header.Controls.Add(tools);

            this.editor = new TextBox();
            this.editor.Multiline = true;
            this.editor.ScrollBars = ScrollBars.Vertical;
            this.editor.BorderStyle = BorderStyle.None;
            this.editor.Dock = DockStyle.Fill;
            this.editor.BackColor = Color.FromArgb(27, 27, 26);
            this.editor.ForeColor = Color.FromArgb(236, 236, 233);
            this.editor.Font = new Font("Microsoft YaHei UI", this.currentFontSize, FontStyle.Regular);
            this.editor.Text = LoadSavedMemo();

            this.saveTimer = new System.Windows.Forms.Timer();
            this.saveTimer.Interval = 350;
            this.saveTimer.Tick += delegate {
                this.saveTimer.Stop();
                SaveMemoNow();
            };

            this.editor.TextChanged += delegate {
                if (!this.headlessCheck)
                {
                    this.saveTimer.Stop();
                    this.saveTimer.Start();
                }
            };

            this.Controls.Add(this.editor);
            this.Controls.Add(header);
        }

        private static Button MakeToolBtn(string label, string tip)
        {
            Button btn = new Button();
            btn.Text = label;
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderSize = 1;
            btn.FlatAppearance.BorderColor = Color.FromArgb(62, 61, 58);
            btn.BackColor = Color.FromArgb(45, 45, 43);
            btn.ForeColor = Color.FromArgb(236, 236, 233);
            btn.Font = new Font("Microsoft YaHei UI", 8.0f, FontStyle.Regular);
            btn.Size = new Size(32, 22);
            btn.Margin = new Padding(3, 1, 0, 1);
            ToolTip tt = new ToolTip();
            tt.SetToolTip(btn, tip);
            return btn;
        }

        private void AdjustFontSize(float delta)
        {
            float next = Math.Max(9.0f, Math.Min(22.0f, this.currentFontSize + delta));
            this.currentFontSize = next;
            this.editor.Font = new Font("Microsoft YaHei UI", next, FontStyle.Regular);
        }

        private void CycleOpacity()
        {
            this.opacityIndex = (this.opacityIndex + 1) % this.opacityLevels.Length;
            this.Opacity = this.opacityLevels[this.opacityIndex];
        }

        private string LoadSavedMemo()
        {
            if (!this.headlessCheck && File.Exists(this.storagePath))
            {
                try
                {
                    return File.ReadAllText(this.storagePath, Encoding.UTF8);
                }
                catch { }
            }
            return "【提词备忘录 · 录屏中自动隐身】\r\n• 开场问候与核心演示目标\r\n• 功能亮点 1：自动运镜 + 鼠标跟随\r\n• 功能亮点 2：AI 一键配字幕与人声压低\r\n\r\n按 Ctrl+Alt+Shift+N 可随时显隐本窗口。";
        }

        private void SaveMemoNow()
        {
            if (this.headlessCheck) return;
            try
            {
                string dir = Path.GetDirectoryName(this.storagePath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(this.storagePath, this.editor.Text, Encoding.UTF8);
            }
            catch { }
        }

        public void ForceCloseForExit()
        {
            this.allowDispose = true;
            SaveMemoNow();
            if (!this.IsDisposed) this.Close();
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            bool ex = NativeWin32.SetWindowDisplayAffinity(this.Handle, NativeWin32.WDA_EXCLUDEFROMCAPTURE);
            if (ex)
            {
                this.ExcludeFromCaptureSupported = true;
                this.AffinityApplied = true;
                this.statusBadge.Text = "● 防录屏隐身中";
                this.statusBadge.ForeColor = Color.FromArgb(126, 189, 140);
                return;
            }
            bool mon = NativeWin32.SetWindowDisplayAffinity(this.Handle, NativeWin32.WDA_MONITOR);
            this.ExcludeFromCaptureSupported = false;
            this.AffinityApplied = mon;
            this.statusBadge.Text = mon ? "● 兼容黑框保护中" : "○ 未启用防捕获";
            this.statusBadge.ForeColor = mon ? Color.FromArgb(218, 122, 82) : Color.FromArgb(163, 162, 158);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            SaveMemoNow();
            if (!this.allowDispose && !this.headlessCheck && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                this.Hide();
                return;
            }
            base.OnFormClosing(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && this.saveTimer != null)
            {
                this.saveTimer.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    internal sealed class HotkeyHiddenForm : Form
    {
        public const int HK_OPEN_STUDIO = 1;
        public const int HK_QUICK_RECORD = 2;
        public const int HK_MARKER_TIP = 3;
        public const int HK_MEMO_TOGGLE = 4;

        private readonly uint showWindowMsg;
        public event Action<string> OpenStudioRequested;
        public event Action MarkerTipRequested;
        public event Action MemoToggleRequested;

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
            NativeWin32.RegisterHotKey(this.Handle, HK_MEMO_TOGGLE, mods, (uint)Keys.N);
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
                if (id == HK_MEMO_TOGGLE)
                {
                    if (this.MemoToggleRequested != null) this.MemoToggleRequested();
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
                NativeWin32.UnregisterHotKey(this.Handle, HK_MEMO_TOGGLE);
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
        private TeleprompterMemoForm memoForm;

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
            this.hotkeyForm.MemoToggleRequested += delegate { ToggleMemoWindow(); };

            this.ownedIcon = BuildTrayBrandIcon();

            ContextMenuStrip menu = new ContextMenuStrip();
            ToolStripMenuItem openItem = new ToolStripMenuItem("打开 DogSC Studio (Ctrl+Alt+Shift+S)");
            openItem.Click += delegate { OpenStudioWindow(null); };
            ToolStripMenuItem recItem = new ToolStripMenuItem("快速录屏 / 录制岛 (Ctrl+Alt+Shift+R)");
            recItem.Click += delegate { OpenStudioWindow("action=record"); };
            ToolStripMenuItem memoItem = new ToolStripMenuItem("防录屏提词备忘录 (Ctrl+Alt+Shift+N)");
            memoItem.Click += delegate { ToggleMemoWindow(); };
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
            ToolStripMenuItem updateItem = new ToolStripMenuItem("检查更新...");
            updateItem.Click += delegate { CheckForUpdatesInteractive(); };
            ToolStripMenuItem exitItem = new ToolStripMenuItem("退出 DogSC");
            exitItem.Click += delegate { ExitApp(); };

            menu.Items.Add(openItem);
            menu.Items.Add(recItem);
            menu.Items.Add(memoItem);
            menu.Items.Add(markerItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(folderItem);
            menu.Items.Add(this.autoStartItem);
            menu.Items.Add(diagItem);
            menu.Items.Add(updateItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            this.trayIcon = new NotifyIcon();
            this.trayIcon.Icon = this.ownedIcon ?? SystemIcons.Application;
            this.trayIcon.Text = "DogSC Studio Windows v" + Program.AppVersion;
            this.trayIcon.ContextMenuStrip = menu;
            this.trayIcon.Visible = true;
            this.trayIcon.DoubleClick += delegate { OpenStudioWindow(null); };

            StartStudioBackend();
        }

        private void ToggleMemoWindow()
        {
            if (this.memoForm == null || this.memoForm.IsDisposed)
            {
                this.memoForm = new TeleprompterMemoForm(false);
            }
            if (this.memoForm.Visible)
            {
                this.memoForm.Hide();
            }
            else
            {
                this.memoForm.Show();
                this.memoForm.Activate();
            }
        }

        private void CheckForUpdatesInteractive()
        {
            string source = Environment.GetEnvironmentVariable("DOGSC_UPDATE_MANIFEST") ?? "https://api.github.com/repos/laogou717/dogsc/releases/latest";
            Thread t = new Thread(delegate() {
                try
                {
                    UpdateManifestInfo info = UpdateChecker.FetchAndInspect(source, Program.AppVersion);
                    if (this.exiting || !this.hotkeyForm.IsHandleCreated) return;
                    this.hotkeyForm.BeginInvoke(new MethodInvoker(delegate {
                        if (info.UpdateAvailable)
                        {
                            string details = "发现新版本: v" + info.LatestVersion + "\n当前版本: v" + info.CurrentVersion;
                            if (!string.IsNullOrEmpty(info.Sha256))
                            {
                                details += "\nSHA-256: " + info.Sha256;
                            }
                            details += "\n\n为确保安全，DogSC 不会自动执行未验证的二进制文件。是否前往下载页获取更新并核对 SHA256SUMS.txt？";
                            DialogResult r = MessageBox.Show(details, "DogSC 更新检查", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                            if (r == DialogResult.Yes && !string.IsNullOrEmpty(info.DownloadUrl))
                            {
                                try { Process.Start(info.DownloadUrl); } catch { }
                            }
                        }
                        else
                        {
                            MessageBox.Show("当前已是最新版本 v" + info.CurrentVersion + "（参考版本: v" + info.LatestVersion + "）。", "DogSC 更新检查", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        }
                    }));
                }
                catch (Exception ex)
                {
                    if (this.exiting || !this.hotkeyForm.IsHandleCreated) return;
                    this.hotkeyForm.BeginInvoke(new MethodInvoker(delegate {
                        MessageBox.Show("检查更新失败: " + ex.Message, "DogSC 更新检查", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    }));
                }
            });
            t.IsBackground = true;
            t.Start();
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
            string ffmpeg = Program.FindFfmpegExe(this.appRoot) ?? "未检测到";
            string ffprobe = Program.FindFfprobeExe(this.appRoot, ffmpeg == "未检测到" ? null : ffmpeg) ?? "未检测到";
            string edge = Program.FindEdgeExe() ?? "未检测到";
            string urlDisplay = this.studioUrl ?? "正在启动...";
            string msg = "版本: DogSC Studio v" + Program.AppVersion + "\n"
                + "工作目录: " + this.appRoot + "\n"
                + "Studio 服务: " + urlDisplay + "\n"
                + "Node.js: " + this.nodeExe + "\n"
                + "FFmpeg: " + ffmpeg + "\n"
                + "FFprobe: " + ffprobe + "\n"
                + "Microsoft Edge: " + edge + "\n\n"
                + "全局热键:\n"
                + "  Ctrl+Alt+Shift+S  打开 DogSC Studio\n"
                + "  Ctrl+Alt+Shift+R  打开快速录制岛\n"
                + "  Ctrl+Alt+Shift+N  防录屏提词备忘录\n"
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
            if (this.memoForm != null && !this.memoForm.IsDisposed)
            {
                this.memoForm.ForceCloseForExit();
                this.memoForm.Dispose();
            }
            KillTree(this.edgeProcess);
            KillTree(this.serverProcess);
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (this.memoForm != null && !this.memoForm.IsDisposed)
                {
                    this.memoForm.ForceCloseForExit();
                    this.memoForm.Dispose();
                }
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
