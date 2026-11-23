# Third-Party Notices & Distribution Compliance

DogSC Windows 不捆绑任何第三方可执行二进制或 npm 运行时依赖（零 `node_modules` 分发）。

## 1. DogSC（上游原型）

- 项目：`laogou717/dogsc`
- 用途：核心算法、Schema 演进与交互式工作台行为的参考实现；本项目为其独立 Windows 移植/重建版本
- 许可证：MIT
- 版权：Copyright (c) 2026 神烦老狗

## 2. FFmpeg / FFprobe（未捆绑外部依赖）

- 用途：DXGI 桌面复制采集（`ddagrab`）、窗口/区域采集（`gdigrab`）、DirectShow 音视频与摄像头采集、混合音频与 MP4/HEVC/M4A 编码及媒体探针检验
- 分发方式：**未随本项目或安装包分发**，由用户本机自行安装（如 WinGet 或官方预编译包）并确保在 `PATH` 中
- 许可证：FFmpeg 按用户本机所装构建版本适用 **LGPL v2.1+ 或 GPL v2+/v3+**；分发或商业使用前请自行核对本机 `ffmpeg -buildconf` 所含组件（如 `libx264` / `libx265` 等）的许可义务

## 3. Microsoft Edge / WebView2（未捆绑外部依赖）

- 用途：无头渲染导出（`msedge.exe --headless=new --use-angle=d3d11`）及交互式工作台独立无栏窗口（`msedge.exe --app=...`）
- 分发方式：**未随本项目分发**，直接复用 Windows 10/11 本机系统内置或用户安装的 Microsoft Edge

## 4. Node.js >= 22.18.0（未捆绑外部依赖）

- 用途：运行本地 `StudioServer` / `ExportServer` 与 CLI 脚本；利用 Node 原生 TypeScript 类型擦除，零外部构建链
- 分发方式：**未随本项目分发**，由用户预先安装（推荐 Node.js v24.x LTS/Current）

## 5. Windows .NET Framework 4.x / WinForms

- 用途：使用系统内置 `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 编译原生桌面托盘与全局热键外壳 `DogSC.exe`，以及使用内置 `tools/mousehook.ps1` / `tools/wasapi-loopback.ps1`（不启用 `-ExecutionPolicy Bypass`）
- 分发方式：使用 Windows 系统自带组件

## 6. 未代码签名状态声明（Unsigned Build Disclosure）

- 当前 `dist/DogSC.exe` 与 `dist/DogSC-Setup-x64-v1.0.0.exe` **未附加 Authenticode / EV 代码签名证书**（Unsigned Build）。
- 首次从下载目录运行 Windows SmartScreen 可能会提示“未知发布者”；分发前请始终随同提供 `SHA256SUMS.txt`，供用户通过 `Get-FileHash -Algorithm SHA256` 核验二进制一致性与完整性。
