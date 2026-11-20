# PLAN.md — DogSC Windows 重构总路线（宏观 → 微观）

## 0. 背景与已定决策
| 项 | 决策 | 理由 |
|---|---|---|
| 原项目 | `F:\dogsc`（Swift，macOS 14+，约 10 万行），只读 | 无法在 Windows 编译 |
| 可复用部分 | `Sources/RecorderCore`（v0.2.0 实测 53 文件 / 14,380 行，**只依赖 Foundation**） | 纯算法：运镜规划、弹簧、3D 投影、光标平滑、时间线编辑、帧场景求值 |
| 不可复用部分 | `Sources/DogSCApp`（ScreenCaptureKit / Metal / AVFoundation / SwiftUI） | 需按 Windows 能力重写 |
| 语言 | **TypeScript**，Node 24 原生运行 `.ts`，零 npm 依赖 | 本机已有 Node 24 / pnpm / ffmpeg；**没有** Rust、.NET SDK、Python、CMake、MSVC |
| 测试 | `node:test` | 内置，零依赖 |
| 移植粒度 | Swift 文件与 TS 文件 1:1 同名 | 低智能 Agent 最容易对照 |
| 新仓库 | `F:\dogsc-win`（git 管理，一卡一提交） | 可回滚 |

## 1. 阶段总览
```mermaid
flowchart LR
    P0["阶段0 脚手架+范例\n(已完成)"] --> P1["阶段1 RecorderCore 移植\n纯TS 零依赖"]
    P1 --> P2["阶段2 Windows 采集\nffmpeg ddagrab + 鼠标钩子"]
    P2 --> P3["阶段3 渲染与导出\n浏览器 WebGL2 + ffmpeg 编码"]
    P3 --> P4["阶段4 编辑器 UI\n本地 Web 界面"]
    P4 --> P5["阶段5 打包分发"]
```

| 阶段 | 产出 | 是否需要安装依赖 | 谁来做 |
|---|---|---|---|
| 0 | 脚手架、移植规范、4 个范例文件 + 测试 | 否 | 高阶 AI（已完成） |
| 1 | `src/core/*.ts` 全部算法 + 单测 | 否 | 普通 Agent，按 `TASKS.md` 逐卡执行 |
| 2 | 录屏 + 鼠标事件 JSONL | 默认方案否（见 §3） | 普通 Agent；方案选择需用户确认 |
| 3 | 按 `FrameScene` 渲染并导出 MP4 | 默认方案否 | 建议高阶 AI 先写渲染契约，再交给普通 Agent |
| 4 | 时间线编辑器 | 默认方案否 | 普通 Agent |
| 5 | 安装包 | 是（Electron/Tauri 二选一） | 需用户决策 |

## 2. 阶段 1 的批次（详见 TASKS.md）
批次按依赖顺序排列，**必须按顺序做**：

| 批次 | 内容 | 关键价值 |
|---|---|---|
| B1 | 叶子文件（无依赖或只依赖类型） | 热身，熟悉规范 |
| B2 | `ProjectModel`（数据模型 + `MotionStyle` 默认值） | 后续所有算法的参数来源 |
| B3 | `ZoomAnimation` / `FocusEffect` / `ZoomTransitionResolution` | 弹簧缓动、贝塞尔求解、缩放轨道 |
| B4 | `AutoZoomPlanner` / `PointerTrack` / 光标几何 | **自动运镜 + 光标平滑（核心卖点）** |
| B5 | `ScreenProjection` / `ScreenMotion` / `CameraMotion` / `CompositionScene` | 3D 倾斜、画面构图 |
| B6 | `OverlayTimeline` / `StickerTransition` / `FrameScene` | 每帧场景求值（渲染器唯一输入） |
| B7 | 时间线与工程（剪辑、变速、映射、校验） | 编辑器后端 |
| B8 | 诊断类文件（可选，最后做或跳过） | 低价值 |

**阶段 1 验收标准**：`npm test` 全绿；`docs/TASKS.md` 中 B1–B7 全部 `[x]`；`FrameSceneEvaluator.scene(...)` 对同一输入两次调用结果 `deepEqual`。

## 3. 阶段 2–5 方案（粗粒度，开工前需用户确认）
### 阶段 2 采集（默认零安装方案）
- **屏幕**：本机 ffmpeg 的 `ddagrab`（Desktop Duplication API，GPU）录制为 MP4；备选 `gdigrab`。
  示例：`ffmpeg -f lavfi -i ddagrab=output_idx=0:framerate=60 -c:v h264_nvenc out.mp4`（无 NVIDIA 时用 `libx264`）。
- **系统声音/麦克风**：ffmpeg `-f dshow`（需列设备：`ffmpeg -list_devices true -f dshow -i dummy`）。
- **鼠标事件**：Windows PowerShell 5.1 自带 `Add-Type` 可现场编译 C#，实现 `WH_MOUSE_LL` 低级鼠标钩子，输出 JSONL（`{time,x,y,kind}`）到 stdout，由 Node 子进程读取。零安装。
  - 备选（需安装）：`uiohook-napi`。
- 时间对齐：录制开始时记录 `performance.timeOrigin`/QPC 时间戳，对应 `PointerTimelineAlignment.ts`。
### 阶段 3 渲染导出（默认零安装方案）
- Node 内置 `http` 起本地服务，浏览器（本机 Chrome/Edge）打开页面；WebGL2 按 `FrameScene` 画：背景 → 阴影 → 屏幕四边形（用 `ProjectedScreenQuad` 的 4 点做透视纹理映射）→ 光标 → 贴纸。
- 导出：浏览器逐帧渲染 → `fetch` 回传 RGBA → Node 写入 `ffmpeg -f rawvideo -pix_fmt rgba -s WxH -r 60 -i - out.mp4`。
- 备选（需安装）：Electron 离屏渲染。
- 浏览器不能直接运行 `.ts`：本地服务在返回 `/src/**/*.ts` 时调用 Node 24 内置的 `module.stripTypeScriptTypes()`（`node:module`）现场擦除类型并以 `text/javascript` 返回，零安装。因此 `src/core` 可在 Node 与浏览器共用（`src/core` 内禁止使用 `node:*` 模块，`crypto.randomUUID` 两端都有）。
### 阶段 4 编辑器
- 同一本地 Web 页面，原生 DOM + 上述类型擦除服务。若 UI 复杂到需要打包工具，再向用户申请安装 `esbuild`（阶段 4 唯一可能的依赖）。
### 阶段 5 打包
- 需用户在 Electron（简单、体积大）与 Tauri（需装 Rust）之间选择。

## 4. 对早期算法报告的勘误（以 Swift 源码为准）
`docs/reference/dogsc_core_algorithm_deep_dive.md` 是导读，存在以下已知错误：
1. 弹簧默认参数写错。真实值（`ProjectModel.swift` L1267–1272）：屏幕 `mass 2.4 / stiffness 210 / damping 42`；光标 `mass 2.8 / stiffness 450 / damping 66`。
2. 光标倾斜并非 `atan2(v) × strength`，真实逻辑见 `PointerTrack.swift` `cursorRotationRadians`（L218 起，含速度窗口、上一速度权重、最大角度 7–9°）。
3. 「Apple 风格」「100% 绝对」等措辞为修饰，无工程含义。
其余结构性描述（双重聚类、18% 前摇、1.4s 间隔、0.55s 停留、0.72s 弹簧归一化、单应性映射、五次平滑点击锚定）已与源码核对一致。
