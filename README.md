# DogSC Windows (`v1.0.0-windows`)

DogSC Windows 是 macOS 版 [DogSC](https://github.com/laogou717/dogsc)（对齐至上游 `v0.2.0`）的独立 Windows 重建实现：支持多源屏幕/窗口/区域、WASAPI 系统音频、DirectShow 麦克风与摄像头采集、`WH_MOUSE_LL` 低级鼠标钩子时钟对齐、54 个零依赖 TypeScript 算法核心模块、9 通道 WebGL2 合成渲染、macOS 风格 **DogSC Studio 交互式多轨编辑器**，以及免 npm 运行时依赖的 **Windows x64 原生托盘外壳与安装包**。

> **架构与依赖约束**：本项目坚持 **零 npm 第三方依赖**（无 `node_modules/`），直接使用 **Node.js >= 22.18.0（实测 v24.15.0）原生 TypeScript 类型擦除**；外部仅复用系统已安装的 `ffmpeg`、`ffprobe`、`msedge.exe`、Windows PowerShell 5.1 与 `.NET 4.x csc.exe`。

---

## 核心特性（Waves A–F 全景）

- **多源采集与时钟同步（Wave A / Wave D）**：
  - 整屏 GPU 采集（`ddagrab` + `h264_nvenc` / 失败自动回退 `libx264`）、指定屏幕区域（偶数对齐）、单窗口无光标采集（`gdigrab draw_mouse=0`）
  - Per-Monitor V2 DPI 多屏物理坐标枚举 + `tools/mousehook.ps1` 低级鼠标钩子
  - `-vf showinfo` + `-bf 0 -rc-lookahead 0` 首帧真实时间戳测定（T12.9）
  - PowerShell 内联 COM WASAPI 系统音回环、DirectShow 麦克风与摄像头同步锚点、`camera_frames/` 预解码、暂停/恢复无损分段拼接与热键打点 `RecordingMarker`
- **算法核心与 Schema v28 互操作（Wave B）**：
  - `src/core/` **54 个纯净 TypeScript 模块**（100% 禁止 `node:*` 导入），覆盖 `v0.1.8` 至 `v0.2.0` 全部算法、自动运镜时空聚类、240Hz 弹簧光标、`FrameScene` 与 `v27 -> v28` 双向无损编解码互操作
- **全通道 WebGL2 渲染与多音轨导出（Wave C–D）**：
  - `web/` **18 个模块**（全量通过 `stripTypeScriptTypes`）：阴影、SDF 圆角/边框、图案/流动/壁纸背景、矢量化光标与 4 种点击特效、摄像头圆形美颜与缩放避让、6 类设备/窗口/浏览器边框、径向/线性聚光灯、毛玻璃区域马赛克、贴纸层级防渗色与 3D 开场动画
  - 多音轨按时间线变速混音导出 MP4（H.264 / HEVC）与 `--format m4a` 纯音频导出
- **DogSC Studio 交互式编辑器（Wave E）**：
  - 本地 HTTP 后端 `StudioServer`（`SafePath` 防穿越 + 原子 `PUT /project`）与 Warm Graphite / Soft Silver 无栏桌面工作台
  - 实时 WebGL2 预览、多轨时间线（主视频分割/裁切/倍速、缩放片段拖拽/选焦、Undo/Redo）、6 标签零假开关检查器、`760px` 三阶段多规格导出弹窗（原始/1080p/1440p/4K、30/60fps、H.264/HEVC、M4A、取消与目录跳转）与多源录制岛
  - Chrome `1436x901` 四轮端到端验收通过，零 Console 错误、零 HTTP>=400
- **原生桌面外壳与 Windows x64 安装包（Wave F）**：
  - `desktop/DogSC.cs`（严格 C# 5，`csc.exe` 零外部依赖编译）提供单实例 `DogSC.exe`：系统托盘、全局热键（`Ctrl+Alt+Shift+S` / `R` / `M`）、开机自启、环境自检 `--check` 与安装卸载 `--install` / `--uninstall`
  - 提供便携压缩包 `dist/DogSC-Windows-x64-v1.0.0.zip` 与系统自带 `iexpress.exe` 构建的自解压安装程序 `dist/DogSC-Setup-x64-v1.0.0.exe`

---

## 快速开始

### 前置依赖（需用户本机预装）

- Windows 10 / 11 x64（支持 DXGI Desktop Duplication，NVIDIA NVENC 可选、无硬编自动回退 `libx264`）
- Node.js **>= 22.18.0**（推荐 v24.x）
- `ffmpeg` 与 `ffprobe`（位于 `PATH` 或 WinGet `Links`）
- Microsoft Edge（`msedge.exe`）

### 常用命令

```powershell
cd F:\dogsc-win

# 启动 DogSC Studio 桌面工作台（Edge --app 无地址栏窗口）
npm run studio

# 构建原生托盘外壳 dist/DogSC.exe 并执行 --version / --check 自检
npm run build:desktop

# 构建便携 ZIP + IExpress Setup 安装包 + SHA256SUMS.txt
npm run package:win

# 运行全量单元测试（355 项：350 通过 / 0 失败 / 5 E2E 默认跳过）
npm test

# CLI 录制 / 多规格导出 / 硬件与编码矩阵探针
node scripts/record.ts --seconds 8 --fps 60
node scripts/export.ts --dir recordings\<会话目录> --resolution 1080p --fps 60 --codec h264
node scripts/verify-export.ts --dir recordings\<会话目录> --sync
node scripts/run-device-matrix.ts
```

---

## 分发、未签名声明与合规（`v1.0.0`）

1. **未代码签名声明**：`dist/DogSC.exe` 与 `dist/DogSC-Setup-x64-v1.0.0.exe` 当前**未附加 Authenticode 代码签名证书**，请分发时随同提供 `dist/SHA256SUMS.txt` 并用 `Get-FileHash -Algorithm SHA256` 校验：
   - `DogSC.exe` (`26,112` bytes): `SHA256=db538ee3bfa160577150f3e4cc7c44aeecfbe2505261f64704e87962f208a4af`
   - `DogSC-Windows-x64-v1.0.0.zip` (`388,130` bytes): `SHA256=9d5c20e46d0366af5079d6da827fdd46fabf49e403da26c9889bd09d7eb6c10c`
   - `DogSC-Setup-x64-v1.0.0.exe` (`585,728` bytes): `SHA256=bc6540088691618e91d264fda9771b7216a492ed8bfaa0e17b8f238647db5bdd`
2. **第三方组件说明**：FFmpeg/FFprobe、Node.js 与 Microsoft Edge 均**不随包捆绑**；详见 [THIRD_PARTY_NOTICES.md](file:///F:/dogsc-win/THIRD_PARTY_NOTICES.md) 与 [LICENSE](file:///F:/dogsc-win/LICENSE)。

---

## 质量门禁 G1–G6 与视觉终审状态

| 门禁 | 当前结论 | 证据索引 |
|---|---|---|
| G1 录制真实性与失败语义 | 已落地（交互桌面 `ddagrab` + `--display 9` 零脏目录） | [DEVICE_MATRIX_REPORT.md](file:///F:/dogsc-win/docs/DEVICE_MATRIX_REPORT.md) |
| G2 视觉与多规格像素导出 | 1080p60 / 1440p30 / 4K30 / HEVC / libx264/265 / M4A 已实测 | [T16.6-studio-audit-report.json](file:///F:/dogsc-win/docs/audits/T16.6-studio-audit-report.json) |
| G3 上游 v0.2.0 Schema v28 | 54 `src/core` 模块全零 `node:*`，v27/v28 双向无损 | `test/core/SchemaInterop.test.ts` |
| G4 编辑器零假开关与一致性 | Chrome `1436x901` 4 轮实测 0 Console Error / 0 HTTP>=400 | [T16.6-studio-audit-report.json](file:///F:/dogsc-win/docs/audits/T16.6-studio-audit-report.json) |
| G5 导出看门狗与路径安全 | 30s/409 熔断、`taskkill` 树清理、`SafePath` 防穿越/符号链接 | `ExportServer.test.ts` / `SafePath.test.ts` |
| G6 硬件/外设/安装包矩阵 | 13 项 `VERIFIED`，受限非交互桌面/Win10/多屏如实标 `UNTESTED` | [DEVICE_MATRIX_REPORT.md](file:///F:/dogsc-win/docs/DEVICE_MATRIX_REPORT.md) |

> **决策 D4 诚实说明**：`T11.7`（用户交互终端实录并肉眼终审 `T12.9 showinfo` 成片）仍按规划保持未勾选状态，需您在解锁的 Windows 桌面终端运行 [USAGE.md](file:///F:/dogsc-win/docs/USAGE.md) 第 5 节一键验收命令并确认后勾选。
