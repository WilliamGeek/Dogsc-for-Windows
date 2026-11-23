# 使用手册 — DogSC Windows (`v1.2.0`)

## 1. 桌面工作台与系统托盘（`DogSC.exe`）

双击 `dist\DogSC.exe`（或通过安装程序安装后的桌面 / 开始菜单快捷方式 **DogSC Studio**）即可在后台启动本地服务并打开无地址栏桌面工作台。

- **全局快捷键**：
  - `Ctrl + Alt + Shift + S`：唤醒或新开 DogSC Studio 主窗口
  - `Ctrl + Alt + Shift + R`：打开 DogSC Studio 并直达多源录制弹窗
  - `Ctrl + Alt + Shift + N`：显示 / 隐藏防录屏提词备忘录浮窗（仅本机可见，不进入录屏画面）
  - `Ctrl + Alt + Shift + M`：录制打点提示
- **常用 CLI 命令**：

```powershell
cd F:\dogsc-win

# 编译原生托盘外壳 dist/DogSC.exe 并执行环境自检
npm run build:desktop

# 环境与命令行管理
.\dist\DogSC.exe --version                                      # 输出版本号与架构 JSON
.\dist\DogSC.exe --check --root .                               # 检查 Node / FFmpeg / FFprobe / Edge 依赖
.\dist\DogSC.exe --memo-check                                   # 验证防录屏窗口保护属性 (WDA_EXCLUDEFROMCAPTURE)
.\dist\DogSC.exe --check-update                                 # 检查在线版本更新
.\dist\DogSC.exe --check-update --verify-file dist\DogSC.exe --expected-sha256 <SHA256>
.\dist\DogSC.exe --tray-only                                    # 仅常驻系统托盘启动
.\dist\DogSC.exe --uninstall                                    # 卸载安装目录、快捷方式与 HKCU 注册表项
```

如果仅需直接启动 Web 编辑器服务（不启用系统托盘）：

```powershell
npm run studio
# 或指定端口与录制目录
node scripts/studio.ts --port 18421 --recordings F:\dogsc-win\recordings
```

---

## 2. 编辑器常用操作与快捷键

| 快捷键 | 功能 |
| :--- | :--- |
| `Space` | 播放 / 暂停实时 WebGL2 预览 |
| `←` / `→` | 上一帧 / 下一帧步进 |
| `A` / `B` | 切换选择工具 / 剪刀分割工具 |
| `S` | 在播放头当前位置拆分主视频片段 |
| `Delete` / `Backspace` | 删除时间线上选中的片段、缩放段、字幕、动效或叠加音轨 |
| `Ctrl + Z` / `Ctrl + Y` | 全局撤销 / 重做（含 AI 单轮修改） |
| `Ctrl + K` | 聚焦左侧 AI 编辑输入框 |
| `Ctrl + Alt + L` | 展开 / 收起左侧 AI 与素材抽屉 |
| `?` | 打开快捷键速查弹窗 |

> **微调技巧**：检查器右侧的数值读数支持按住鼠标左键左右拖拽连续微调（按住 `Shift` 为 `0.25×` 精细调节），双击任意滑杆或数值即可恢复默认参数。

---

## 3. CLI 录制、导出与设备探针

在本地 Windows 桌面 PowerShell 中可直接用脚本完成批处理录制与导出：

```powershell
# 10 秒 60fps CFR 主屏录制（保存至 recordings/<YYYYMMDD-HHmmss>/）
node scripts/record.ts --seconds 10 --fps 60 --display 0

# 时钟偏移双击校准工具
node scripts/calibrate.ts

# 默认导出 MP4
node scripts/export.ts --dir recordings\<会话目录>

# 指定 4K / HEVC / 最高画质导出
node scripts/export.ts --dir recordings\<会话目录> --resolution 4K --fps 30 --codec hevc --quality maximum --out out_4k_hevc.mp4

# 仅导出混音与人声压低后的纯音频 M4A
node scripts/export.ts --dir recordings\<会话目录> --format m4a --out audio.m4a

# 运行视音频同步与首尾帧自动校验
node scripts/verify-export.ts --dir recordings\<会话目录> --sync

# 探测本机多屏/DirectShow设备与编码器矩阵
node scripts/run-device-matrix.ts
```

每次录制在 `recordings/<YYYYMMDD-HHmmss>/` 生成 `screen.mp4`、`pointer.jsonl`、`meta.json`、`project.json`（及可选 `system-audio.wav`、`mic-audio.wav`、`camera.mp4`）。

---

## 4. 构建安装包与便携包

```powershell
# 标准轻量版（自动生成 DogSC.exe、ZIP 与 Setup.exe，及 SHA256SUMS.txt）
npm run package:win

# 含便携 Node 运行时的全量压缩包（随包集成 runtime\node.exe）
npm run package:win:portable
```

---

## 5. AI 助手配置与外部 Agent Bridge

1. 打开左侧 **AI 助手** 标签，点击 **配置**：
   - 可选 **本地离线规则引擎**（无需联网与密钥）、**OpenAI 兼容接口**、**Google Gemini API** 或 **本机 AI CLI 桥接**。
   - API Key 使用 Windows **DPAPI 用户态加密**保存在本机用户目录，不写回 `project.json`。
2. 在同一配置卡片底部可复制当前会话的本地 HTTP 地址与随机 `Bearer Token`，用于让外部 CLI Agent（如 `claude`、`codex`、`gemini` 等）通过 `POST /api/recordings/<id>/ai/command` 自动化执行剪辑命令；每次 AI 修改均支持点击对话气泡下方的 **撤销此轮** 一键回退。
