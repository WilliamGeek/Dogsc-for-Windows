# DogSC Windows

DogSC Windows 是 macOS 版 [DogSC](https://github.com/laogou717/dogsc) 的 Windows 重构实现：用桌面复制 API（DXGI Desktop Duplication / `ddagrab`）录制屏幕，用原生 WH_MOUSE_LL 钩子记录指针，再通过 WebGL2 渲染器重建缩放、光标轨迹与导出视频。项目坚持 **零 npm 运行时依赖**，只依赖本机 `ffmpeg`、`ffprobe`、Windows PowerShell 5.1 与 Microsoft Edge。

> 上游官方目前只有 macOS 版。本项目是独立 Windows 重建，不是上游官方 Windows 发行版；上游 v0.2.0 的 9 个算法模块仍在分阶段补齐。

## 快速开始

前置条件：

- Windows 10/11，支持 DXGI Desktop Duplication 的 GPU（NVIDIA NVENC 可选，失败自动回退 `libx264`）
- Node.js **>= 22.18.0**（推荐 24.x；本项目使用 Node 原生 TypeScript 类型擦除，无需构建）
- `ffmpeg` 与 `ffprobe` 在 `PATH` 中
- Microsoft Edge（无头导出使用 `msedge.exe`）

```powershell
cd F:\dogsc-win
node scripts/record.ts --seconds 10 --fps 60
node scripts/export.ts --dir recordings\<会话目录>
node scripts/verify-export.ts --dir recordings\<会话目录>
```

`record.ts` 产出 `screen.mp4`、`pointer.jsonl`、`meta.json`、`project.json`；`export.ts` 产出 `export.mp4`；`verify-export.ts` 输出结构化 JSON，退出码 `0` 表示通过、`1` 表示不通过。

## 目录结构

```
src/core/       纯 TypeScript 算法核心（RecorderCore 移植，禁止 node:*）
src/capture/    屏幕录制、鼠标钩子、显示器枚举、媒体探针
src/render/     帧计划、帧场景求值、纯渲染数学
src/server/     DevServer / ExportServer / SafePath
web/            WebGL2 渲染页与浏览器导出循环（禁止 node:*）
scripts/        record / export / verify-export / calibrate CLI
tools/          mousehook.ps1 与 e2e-testcard.html
test/           node:test 单元测试与 E2E
docs/           计划、契约、任务、进度与验收记录
```

架构边界：

- `src/core`、`src/render`、`web` 不得导入 `node:*`，保证可被浏览器直接加载。
- 采集与 HTTP 服务可以使用 Node 内置模块；外部进程只允许 `ffmpeg`、`ffprobe`、PowerShell 5.1、`msedge.exe`。
- 录制时长与帧数只信 `ffprobe` 的媒体事实，不用 `Date.now()` 墙钟时长替代视频时长。
- 路径校验使用 `path.relative` 的 `SafePath`，不使用 `startsWith(root)`。

## 测试与验收

```powershell
npm test
$env:DOGSC_E2E='1'; npm test
```

Wave A 真实闭环：

1. 在交互式桌面打开 `tools/e2e-testcard.html`，确保测试卡全屏且无其他窗口遮挡。
2. 录制 8–10 秒，在第 2 秒点击 A、第 4 秒点击 B。
3. `node scripts/export.ts --dir <目录>`。
4. `node scripts/verify-export.ts --dir <目录>`，确认时长差 ≤0.05s、帧数一致、`captureFrameRate === meta.fps`、无音频时 `recordsSystemAudio === false`、点击帧非全黑。

## 许可证

MIT。衍生自 `laogou717/dogsc`（Copyright (c) 2026 神烦老狗）。详见 `LICENSE` 与 `THIRD_PARTY_NOTICES.md`。

## 当前状态

- T12.1–T12.8 采集/导出止血修复已完成，真实录制 `20261120-175917` 通过 `verify-export --sync`（568/568 帧、时长差 0.000s、闪帧 onset 0 帧）。
- `T11.7` 仍等待用户按计划 D4 肉眼复核后勾选；在此之前不宣称阶段 3 完成。
- 上游 v0.2.0 的 9 个 `RecorderCore` 模块与 Schema v28 互操作属于后续 Wave B。
- 已登记的剩余缺陷（首帧时钟残差、指针偏移、无音视频外设、渲染通道缺失等）见交付的开发交接文档与 `docs/PROGRESS.md`。
