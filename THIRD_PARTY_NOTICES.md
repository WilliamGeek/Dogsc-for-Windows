# Third-Party Notices

DogSC Windows 不捆绑任何第三方二进制或 npm 运行时依赖。

## DogSC（上游）

- 项目：`laogou717/dogsc`
- 用途：算法与产品行为的参考实现；本项目是其 Windows 重建/衍生作品
- 许可证：MIT
- 版权：Copyright (c) 2026 神烦老狗

## FFmpeg / FFprobe

- 用途：桌面复制采集、视频编码、媒体探针、导出编码与抽帧验证
- 分发方式：**不随本项目分发**，由用户自行安装并确保在 `PATH` 中
- 许可证：FFmpeg 项目按其构建选项适用 LGPL/GPL；使用前请自行确认本机构建的许可义务

## Microsoft Edge

- 用途：无头运行 WebGL2 渲染页并回传 RGBA 帧
- 分发方式：**不随本项目分发**，使用本机已安装的 `msedge.exe`

## Windows PowerShell / .NET

- 用途：`tools/mousehook.ps1` 通过 WH_MOUSE_LL 记录指针；不启用 `-ExecutionPolicy Bypass`
- 分发方式：使用 Windows 自带组件

## Node.js

- 用途：运行 CLI 与测试；使用 Node 原生 TypeScript 类型擦除
- 分发方式：**不随本项目分发**

如后续引入任何第三方代码或二进制，必须在本文件补充来源、版本、许可证与分发方式。
