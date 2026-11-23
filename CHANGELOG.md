# Changelog — DogSC Windows

## v1.2.0-windows (2026-11-23)

### 采集稳定性与桌面原生能力增强
- **三家 GPU 硬件编码自动探测与回退**：依次按 `h264_nvenc`（NVIDIA）→ `h264_amf`（AMD）→ `h264_qsv`（Intel）执行单帧空输出探活，全失败自动回退 `libx264`；导出阶段同步支持对应 H.264 / HEVC 硬编映射。
- **0.5s 抗崩溃碎片化 MP4 封装**：屏幕与摄像头录制默认启用 `+frag_keyframe+empty_moov+default_base_moof`（`-frag_duration 500000`），突发断电或进程异常终止时已落盘画面仍可正常读取。
- **防录屏提词备忘录浮窗**：在原生 C# 外壳 `desktop/DogSC.cs` 内置 `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` 置顶提词窗（快捷键 `Ctrl+Alt+Shift+N`），屏幕录制与共享画面中自动隐身，正文防抖自动保存至本地用户目录；新增 `--memo-check` 自检参数。
- **应用内 SHA-256 更新检查**：托盘菜单新增“检查更新...”与 CLI `--check-update` / `--verify-file` 校验指令，支持 SemVer 比对与安装包哈希核对。
- **便携运行时优先探测与打包**：`DogSC.exe` 启动时优先查找同级 `runtime\node.exe` 与 `runtime\ffmpeg.exe`；`scripts/package-windows.ts` 新增 `--bundle-node`（`npm run package:win:portable`）。

### DogSC Studio 工作台交互与视觉升级
- **统一线性 SVG 图标系统**：以统一 `1.65px` 线性矢量图标替换所有工具栏、侧边栏与时间线控件中的字符符号。
- **可视化预设图卡**：将背景壁纸/流体纹理（8 套对应 WebGL 着色器色板）、设备/窗口外框（7 种线框预览）、光标形态、摄像头裁切形状、开场透视预设及 5 套内置动效模板升级为可视化缩略图卡片。
- **主视频轨帧缩略图胶片条 + 自绘 HSV/HEX 调色板**：时间线主视频轨实时采样渲染源码视频帧缩略图并修正 `1×` 缩放下的横向滚动余量；用带 2D SV 取色区与色相滑条的自绘浮层替换系统原生颜色弹窗。
- **专业滑杆与拖拽零重建**：支持拖拽右侧数值标签横向微调（按住 `Shift` 精细 `0.25×`）、双击复位默认值，并在连续拖动滑杆与时间线片段期间局部更新 DOM 避免失焦闪烁。

---

## v1.1.0-windows (2026-11-23)

- **AI 智能剪辑助手与本地 Agent Bridge**：接入 Windows DPAPI 用户态加密存储密钥、随机 32 位 hex Bearer 鉴权 `AgentBridge`、本地规则 + OpenAI/Gemini 路由、单轮快照回撤，以及自动扫描本机 `codex` / `claude` / `gemini` / `kimi` CLI 状态。
- **完整后期功能栈**：支持 5 种入场动画双语字幕与 SRT 导入导出、基于波形峰值的静音停顿一键删剪、5 套 `.dmhtml` 动效卡片模板、48kHz 合成音效（`SoundSynth`）与 FFmpeg 语音动态闪避混音（Ducking）、多录制片尾拼接、8 手柄交互式裁剪及 7 轨实时波形时间线。

---

## v1.0.0-windows (2026-11-23)

- 完成 macOS 上游 `v0.2.0` 全部 54 个核心算法模块与 Schema `v28` 编解码移植，实现与 `v27`/`v28` 工程文件的双向无损互操作。
- 落地 Multi-Source 采集（`ddagrab` / `gdigrab` / DirectShow 麦克风与摄像头 / WASAPI 系统声音 / `WH_MOUSE_LL` 多屏鼠标钩子 / `showinfo` 首帧时钟对齐）、9 通道 WebGL2 合成管线、`StudioServer` 与原生 WinForms 托盘安装包（`DogSC.exe` / `iexpress` Setup）。
- 建立自动化测试、Chrome 实机检查与本地 AI 助手编辑能力。
