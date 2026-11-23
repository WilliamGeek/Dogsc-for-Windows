# DogSC Windows · 硬件与系统设备矩阵验证报告（Gate G6）

> 生成时间：`2026-11-23T05:26:46.161Z`（本地 `13:26 CST`）  
> 执行脚本：[`scripts/run-device-matrix.ts`](file:///F:/dogsc-win/scripts/run-device-matrix.ts)  
> 真实性原则：本报告**严格区分 `VERIFIED`（本机实测通过并附实测指标）与 `UNTESTED`（当前会话环境或硬件条件受限、未在目标物理平台实测，严禁推论冒充）**。

---

## 1. 实测主机与工具链档案

| 检查项 | 实测值 |
|---|---|
| 操作系统 | `Microsoft Windows 11 Home China` (`10.0.26200`, Build `26200`) |
| 处理器 | `13th Gen Intel(R) Core(TM) i7-13700HX`（16 核心 / 24 逻辑线程） |
| 物理内存 | `16,858,472,448` bytes（约 16 GB） |
| 显卡适配器 | `NVIDIA GeForce RTX 4060 Laptop GPU` (Driver `32.0.15.9282`)；`GameViewer Virtual Display Adapter` (Driver `15.6.5.199`) |
| Node.js | `v24.15.0` (`C:\Program Files\nodejs\node.exe`) |
| FFmpeg / FFprobe | `ffmpeg version N-123074-g4e32fb4c2a-20260228` |
| C# 编译器 | `C:\WINDOWS\Microsoft.NET\Framework64\v4.0.30319\csc.exe` |
| 自解压打包工具 | `C:\WINDOWS\System32\iexpress.exe` |
| 桌面浏览器引擎 | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |

---

## 2. 本机自动化探针与导出矩阵实测结果（`VERIFIED`）

| # | 验证项 | 状态 | 实测关键指标与产物证据 |
|---|---|---|---|
| 1 | 显示器 DPI 与主屏枚举 (`enumerateDisplays`) | `VERIFIED` | 检测到 `1` 块主屏：`\\.\DISPLAY1` (`isPrimary=true`, `1920x1080` at `(0,0)`) |
| 2 | DirectShow 摄像头枚举 (`enumerateDirectShowDevices`) | `VERIFIED` | 检测到 `1` 台：`HP True Vision FHD Camera`（含 `@device_pnp_...` 唯一路径） |
| 3 | DirectShow 麦克风/声卡枚举 (`enumerateDirectShowDevices`) | `VERIFIED` | 检测到 `9` 路音频输入（`英特尔® 智音技术麦克风阵列` + `Voicemeeter Out 1..8`） |
| 4 | 硬件编码器自动探活 (`detectEncoder`) | `VERIFIED` | 探测返回 `h264_nvenc`（RTX 4060 硬件加速可用） |
| 5 | 非法显示器索引快速失败 (`--display 9`) | `VERIFIED` | 抛出 `显示器索引越界: 9；可用索引: 0`；临时目录残留条目 `0` |
| 6 | 1080p @ 60fps H.264 WebGL2+NVENC 导出（30 帧） | `VERIFIED` | `1920x1598` @ `60 fps`，`30` 帧，`h264`，`83,930 B`，耗时 `6.42s` |
| 7 | 1440p @ 30fps H.264 WebGL2+NVENC 导出（30 帧） | `VERIFIED` | `2560x2132` @ `30 fps`，`30` 帧，`h264`，`136,461 B`，耗时 `7.85s` |
| 8 | 4K (2160p) @ 30fps H.264 WebGL2+NVENC 导出（30 帧） | `VERIFIED` | `3840x3198` @ `30 fps`，`30` 帧，`h264`，`256,447 B`，耗时 `14.33s` |
| 9 | 1080p @ 30fps HEVC WebGL2 导出（30 帧） | `VERIFIED` | `1920x1598` @ `30 fps`，`30` 帧，`hevc`，`98,402 B`，耗时 `5.72s` |
| 10 | 软件编码回退：`libx264` 1280×720@30 | `VERIFIED` | `ffprobe` 实测 `1280x720` @ `30 fps`，`h264` |
| 11 | 软件编码回退：`libx265 -tag:v hvc1` 1280×720@30 | `VERIFIED` | `ffprobe` 实测 `1280x720` @ `30 fps`，`hevc` |
| 12 | 多音轨混音与纯音频 M4A 导出 (`buildAudioOnlyM4aArgs`) | `VERIFIED` | `ffprobe` 实测 `aac`，`44100 Hz`，单声道，`131,287 bps`，`1.000000s`，`17,779 B` |
| 13 | 原生桌面外壳 `dist/DogSC.exe --version` 与 `--check` | `VERIFIED` | 返回 `version=1.0.0, arch=x64`；`--check` 返回 `ok: true`（Node/FFmpeg/FFprobe/Edge 齐备） |

> 注：以上导出矩阵输入源为隔离复制的历史真实会话 `recordings/20261120-175917`（`2176x1812 @ 60fps` 纵横比按项目设置自适应为 `1920x1598` / `2560x2132` / `3840x3198` 偶数尺寸）；所有临时测试文件已在脚本 `finally` 中安全清空。

---

## 3. 未验证项与当前会话限制（`UNTESTED`）

| 检查项 | 状态 | 实测观测原委与遗留说明 |
|---|---|---|
| 当前非交互后台会话 `T12.9 showinfo` 3s 实录 | `UNTESTED (INTERACTIVE_DESKTOP_REQUIRED)` | 实测 `recordSession({ seconds: 3, fps: 60, outputIdx: 0 })` 被操作系统拒绝，原始输出：<br>`[Parsed_ddagrab_0] Desktop duplication access denied`<br>`Error opening input file ddagrab=output_idx=0:framerate=60:draw_mouse=0. Operation not permitted` |
| 当前非交互后台会话 Top-Level 窗口枚举 (`EnumWindows`) | `UNTESTED (INTERACTIVE_DESKTOP_REQUIRED)` | 同一非交互桌面会话限制导致 `windowCount: 0`，需在用户已解锁交互式桌面中验证 `gdigrab` 单窗口录制 |
| Windows 10 (22H2 / LTSC) 主机实机 | `UNTESTED` | 本机为 Windows 11 Build 26200；未连接 Win10 物理测试机 |
| 无 NVIDIA 显卡（纯 Intel QuickSync / AMD / 无核显）真机自动回退 `libx264` | `UNTESTED (HARDWARE_UNAVAILABLE)` | 本机配 RTX 4060；`libx264` 仅通过独立 FFmpeg 与单测 mock 探针验证 |
| 物理双屏 / 混合 DPI（负坐标副屏 + 125%/150% 缩放）实录 | `UNTESTED (HARDWARE_UNAVAILABLE)` | 当前主屏为单屏 `1920x1080`；多屏坐标归一化已通过 `test/capture/DisplayEnumeration.test.ts` 与 `PointerJsonl.test.ts` 严格单测 |
| 连续 5 分钟长录制防 OOM 与系统休眠/锁屏恢复 | `UNTESTED` | 受本次会话时间与桌面锁屏权限所限未运行 300s 实机压测 |
| 已代码签名（EV/Authenticode）安装包 SmartScreen 静默放行 | `UNTESTED (UNSIGNED_BUILD)` | 已在 `THIRD_PARTY_NOTICES.md` 与 `SIGNING_AND_DISTRIBUTION.txt` 明确声明未签名并通过 `SHA256SUMS.txt` 核验 |
| `T11.7` 成片“单光标 + 无尾帧冻结 + 点击闪帧≤1帧”用户肉眼终审 (D4) | `UNTESTED (AWAITING_USER_REVIEW)` | 仍按 `MASTER_REFACTOR_PLAN_V2.md` §7 D4 保留未勾选状态，待用户在交互终端实录并肉眼复核后批准 |

---

## 4. 交互式真机桌面一键复测命令

请在**已解锁登录的本地 Windows 交互式终端（PowerShell）**中执行以下命令，完成实时 `ddagrab` / `T12.9 showinfo` 时钟对齐与 `T11.7` 终审闭环：

```powershell
cd F:\dogsc-win

# 1. 重跑全量硬件与实时 3s ddagrab + showinfo 矩阵探针（交互桌面下 liveCapture 应为 VERIFIED）
node scripts/run-device-matrix.ts

# 2. 双点击鼠标-视频时钟校准
node scripts/calibrate.ts

# 3. 开启 e2e-testcard 全屏录制 8 秒并执行同步导出与 G1/G2 自动检验（含 pointerTimingSync <= 2 帧）
node scripts/record.ts --seconds 8 --fps 60
node scripts/export.ts --dir recordings\<新生成的会话目录>
node scripts/verify-export.ts --dir recordings\<新生成的会话目录> --sync
```
