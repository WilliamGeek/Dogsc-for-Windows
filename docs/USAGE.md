# USAGE.md — DogSC Windows 使用与手动验收指南 (`v1.0.0-windows`)

## 1. 桌面工作台快速启动与系统托盘（`DogSC.exe`）

构建桌面入口后可直接双击 `dist\DogSC.exe`（或安装包安装后的“桌面 / 开始菜单 → DogSC Studio”）：

- **全局快捷键**：
  - `Ctrl + Alt + Shift + S`：唤醒或新开 DogSC Studio 独立窗口
  - `Ctrl + Alt + Shift + R`：直达 DogSC Studio 并弹出多源录制岛（`?action=record`）
  - `Ctrl + Alt + Shift + M`：分段打点提示气泡
- **CLI 管理子命令**：
```powershell
cd F:\dogsc-win
npm run build:desktop                 # 编译 dist/DogSC.exe 并自动运行 --version / --check
.\dist\DogSC.exe --version            # 查看版本与架构 JSON
.\dist\DogSC.exe --check --root .     # 检查 Node.js / FFmpeg / FFprobe / Edge 依赖
.\dist\DogSC.exe --tray-only          # 仅常驻系统托盘（不立即弹出工作台）
.\dist\DogSC.exe --uninstall          # 卸载用户目录、快捷方式与 HKCU 注册表项
```

若仅启动 Web 编辑器服务（无需托盘外壳）：
```powershell
npm run studio
# 或自定义录制根目录与端口
node scripts/studio.ts --port 18421 --recordings F:\dogsc-win\recordings
```

## 2. 屏幕、音频与多源录制 CLI

请在**已解锁登录的本地 Windows 交互式终端（PowerShell）**中运行实机录制：
```powershell
# 默认 10 秒，60fps CFR，主显示器
node scripts/record.ts --seconds 10 --fps 60 --display 0

# 双点击时钟校准工具
node scripts/calibrate.ts
```
每次录制在 `recordings/<YYYYMMDD-HHmmss>/` 生成 `screen.mp4`、`pointer.jsonl`、`meta.json`、`project.json`（及可选 `system-audio.wav`、`mic-audio.wav`、`camera.mp4`）。

## 3. 多规格 WebGL2 导出与纯音频 M4A

```powershell
# 默认按 project.json 导出 <录制目录>/export.mp4
node scripts/export.ts --dir F:\dogsc-win\recordings\<id>

# 自定义分辨率 / 帧率 / 码率质量 / 编码器（支持 original|1080p|1440p|4K, 30|60fps, compact|high|maximum, h264|hevc）
node scripts/export.ts --dir F:\dogsc-win\recordings\<id> --resolution 4K --fps 30 --codec hevc --quality maximum --out out_4k_hevc.mp4

# 仅导出混音后纯音频 M4A（跳过无头浏览器渲染）
node scripts/export.ts --dir F:\dogsc-win\recordings\<id> --format m4a --out audio.m4a
```

## 4. 打包构建与硬件矩阵探针

```powershell
# 构建便携 ZIP 与 IExpress Setup 安装包至 dist/
npm run package:win

# 运行硬件枚举 / 多分辨率与 HEVC 编码 / 软编回退 / M4A 探针矩阵
node scripts/run-device-matrix.ts
```

## 5. 交互式桌面最终手动验收清单（决策 D4 / `T11.7`）

在已解锁的本地桌面中运行：
```powershell
cd F:\dogsc-win
node scripts/record.ts --seconds 8 --fps 60
node scripts/export.ts --dir recordings\<新生成的会话目录>
node scripts/verify-export.ts --dir recordings\<新生成的会话目录> --sync
```
播放生成的 `export.mp4` 核对：
1. 仅存在 **1 只矢量光标**，源录制底片无系统 OS 光标重影；
2. 点击处缩放动画与绿色/珊瑚点击波纹同帧对齐（`pointerTimingSync` 误差 `<= 1` 帧）；
3. 成片结尾无黑帧或长时间静止尾帧冻结。
