# Changelog — DogSC Windows

## v1.0.0-windows (2026-11-23)

首个完整对齐 macOS 上游 `v0.2.0` 架构、内置交互式 Studio 工作台与 Windows 原生桌面包装的发行版（零 npm 运行时依赖，Node.js v24.15.0 原生 TypeScript 类型擦除）。

### Wave F — 原生桌面外壳、安装包与设备矩阵（`T17.1`–`T17.4`）
- **T17.1**：新增严格 C# 5 编写的原生 x64 外壳 `desktop/DogSC.cs`、双分辨率 PNG-in-ICO 品牌图标生成与构建工具 `src/desktop/DesktopBuilder.ts` / `scripts/build-desktop.ts`，支持系统托盘、全局热键（`Ctrl+Alt+Shift+S/R/M`）、单实例互斥、`--version`/`--check`/`--install`/`--uninstall` 与 Studio `?action=record` 直达录制岛。
- **T17.2**：新增 `scripts/package-windows.ts` 生成便携包 `DogSC-Windows-x64-v1.0.0.zip` 与 `iexpress` 安装程序 `DogSC-Setup-x64-v1.0.0.exe` 及 `SHA256SUMS.txt`；完善 `THIRD_PARTY_NOTICES.md` 未签名及非捆绑外部依赖声明。
- **T17.3**：新增 `scripts/run-device-matrix.ts` 并输出严格标注 `VERIFIED` 与 `UNTESTED` 的 Gate G6 [`docs/DEVICE_MATRIX_REPORT.md`](file:///F:/dogsc-win/docs/DEVICE_MATRIX_REPORT.md)。
- **T17.4**：版本号升级至 `1.0.0`（同步更新 `StudioServer /api/health`），更新文档、看板与最终 Chrome 验收，切分 `v1.0.0-windows` 标签。

### Wave E — 交互式 Web Studio 与多规格导出（`T16.1`–`T16.6`）
- 新增 `StudioServer`（原子 `PUT /project`、`POST /api/export/start|cancel`、`GET /api/devices`）、WebGL2 实时预览引擎 `web/studio/player.ts`、多轨时间线（Split/Delete/Retime/Undo/Redo）、6 标签零假开关检查器、`760px` 三阶段导出弹窗与多源录制岛。
- 修复 Chrome `1436x901` 四轮实时验收暴露的 4 项界面/焦点问题（舞台尺寸溢出遮挡工具栏、`favicon.ico` 404、`setInspectorTab` `TypeError` 与 `getRenderedScreenContentRect` 靶心 `0.63px` 精确定位）。

### Wave C–D — 全通道 WebGL2 渲染管线与多源音视频采集（`T14.1`–`T15.6`）
- 重构 9 个模块化 WebGL2 Pass 管线：摄像头美颜/圆角裁剪/缩放避让、6 类设备/窗口外框 3D 透视、区域模糊马赛克与聚光灯、毛玻璃贴纸两阶段防渗色、矢量光标与 4 种点击动效及 3D 开场动画。
- 补齐多源采集与混音：区域/窗口捕获、WASAPI 系统音频回环、DirectShow 麦克风与摄像头同步、多音轨变速混音与 M4A 纯音频导出、无损分段恢复与热键打点。

### Wave A–B — 采集可靠性止血与 `v0.2.0` 算法核心对齐（`T12.1`–`T13.5`）
- 引入 `MediaProbe`、`SafePath`（含符号链接防护）、`ExportServer` 看门狗、Per-Monitor V2 DPI 多屏归一化与 `T12.9 showinfo` 首帧时钟同步；完成 54 个 `src/core/` 模块及 Schema `v27 -> v28` 双向无损迁移，全量单测达到 `355` 项（`350 pass / 5 E2E skip / 0 fail`）。

