# Third-Party Notices & Distribution Compliance

DogSC Windows 标准安装包与 Git 仓库均不捆绑外部可执行二进制或 npm 运行时依赖（零 `node_modules` 分发；仅在显式执行便携全量打包 `npm run package:win:portable` 时随包集成当前宿主的 `runtime\node.exe`）。

## 1. DogSC（上游 macOS 原型）

- 项目：`laogou717/dogsc`
- 适用模块：`src/core/` 核心算法、AutoZoom 规划、物理弹簧插值、3D 投影数学与工程 Schema v28 编解码
- 许可证：MIT（保留原作者声明于 `LICENSE-MIT`）
- 版权：Copyright (c) 2026 神烦老狗

## 2. 本仓库独立 Windows 实现

- 适用模块：`src/capture/`、`src/render/`、`src/server/`、`src/desktop/`、`web/`、`desktop/`、`scripts/`、`tools/`
- 许可证：PolyForm Noncommercial License 1.0.0（详见 `LICENSE`）— 个人开发者可免费 Fork、学习及在本地修改优化；禁止商业使用、商业再分发或换壳售卖。

## 3. FFmpeg / FFprobe（未捆绑外部依赖）

- 用途：DXGI 桌面复制采集（`ddagrab`）、窗口采集（`gdigrab`）、DirectShow 麦克风与摄像头采集、音频混音及 MP4 / HEVC / M4A 编码与媒体探针检验
- 分发方式：**未随本项目或安装包分发**，由用户本机自行安装（如 WinGet 或官方预编译包）并加入 `PATH`
- 许可证：按用户本机所安装构建适用 **LGPL v2.1+ 或 GPL v2+/v3+**；二次分发前请自行核对本机 `ffmpeg -buildconf` 所含编码器组件的许可义务

## 4. Microsoft Edge / WebView2（未捆绑外部依赖）

- 用途：无头 GPU 渲染导出（`msedge.exe --headless=new --use-angle=d3d11`）及交互式工作台无栏独立窗口（`msedge.exe --app=...`）
- 分发方式：**未随本项目分发**，直接复用 Windows 10/11 本机系统内置 Microsoft Edge

## 5. Node.js >= 22.18.0（标准版未捆绑 / 便携版可选内置）

- 用途：运行本地 HTTP 控制后端与静态资源 TypeScript 实时类型擦除
- 分发方式：**标准轻量包未随本项目分发**，推荐本机预装 Node.js v24.x；使用 `npm run package:win:portable` 构建的便携压缩包按 MIT / OpenJS 许可条款随附 `runtime\node.exe` 及 `runtime\NODE_RUNTIME_NOTICE.txt`

## 6. Windows .NET Framework 4.x / WinForms

- 用途：通过系统内置 `csc.exe` 编译原生桌面托盘与全局热键外壳 `DogSC.exe`，以及内置 `tools/mousehook.ps1` / `tools/wasapi-loopback.ps1`（不启用 `-ExecutionPolicy Bypass`）
- 分发方式：直接调用 Windows 系统内置组件

## 7. 未代码签名状态声明（Unsigned Build Disclosure）

- 当前发布的 `dist/DogSC.exe` 与 `dist/DogSC-Setup-x64-v1.2.0.exe` **未附加 Authenticode / EV 代码签名证书**（Unsigned Build）。
- 首次从下载目录运行时 Windows SmartScreen 可能会提示“未知发布者”；分发时随同提供 `SHA256SUMS.txt`，可通过 `Get-FileHash -Algorithm SHA256` 或 `DogSC.exe --check-update --verify-file <file> --expected-sha256 <hex>` 核验文件完整性。
