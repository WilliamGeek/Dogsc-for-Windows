# TASKS.md — 阶段 1 任务卡（一卡 = 一次提交）

通用完成条件（每张卡都适用，卡内不再重复）：
1. 目标 `.ts` 已按 `PORTING_RULES.md` 写完，Swift 源文件中**每一个**类型/函数都有对应实现（private 的也要，用于内部调用；可不导出）。
2. 对应测试文件存在，覆盖 PORTING_RULES §6 + 本卡「必测」。
3. `npm test` 全绿。
4. 勾选本卡、追加 PROGRESS.md、git commit。

> 「分段」= 先用 AGENTS.md §3 的命令列出顶层声明行号，按声明边界把文件切成 ≤500 行的段，一段一段地读和写（写入同一个 `.ts` 文件）。每段写完都跑一次 `npm test`。

---
## B0 脚手架（已完成）
- [x] T0.1 `package.json`、`src/core/swift.ts`、测试框架
- [x] T0.2 范例：`ElementMotion` `MediaTimeRange` `HexColor` `PointerEventTimelineOrdering`

## B1 叶子文件
- [x] T1.1 `RecordingMarker.swift`(15) `ExportSettings.swift`(19) → 两个同名 `.ts`
- [x] T1.2 `BoundedMemoizationCache.swift`(86) → TS `class`，删除锁。必测：容量淘汰顺序；`valueIfBuilt` 构建函数返回 `null`（被取消）时不写入缓存。
- [x] T1.3 `CanvasCustomAspectRatio.swift`(32)、`TimelineTrackOrdering.swift`(55)、`PointerTimelineAlignment.swift`(56)。若需要 `CanvasStyle` 的值 → 按 PORTING_RULES §7 先做 B2。
- [x] T1.4 `OutputFrameSchedule.swift`(96)。必测：60fps 下第 n 帧时间 = n/60；时长边界帧数。

## B2 工程数据模型
- [x] T2.1 `ProjectModel.swift` 第 1 段（文件开头 → `CursorAssetID` 之前）→ `ProjectModel.ts`。分段。
- [x] T2.2 `ProjectModel.swift` 第 2 段（`CursorAssetID` → `CanvasStyle` 结束）。
- [x] T2.3 `ProjectModel.swift` 第 3 段（剩余，含 `AudioStyle` `CameraStyle` `MotionStyle`）。必测：`makeMotionStyle()` 默认值 = 屏幕弹簧 2.4/210/42、光标弹簧 2.8/450/66（Swift L1267–1272）。
- [x] T2.4 `ScreenFrameDefaults.swift`(56)、`HexColor` 已有，检查 `ProjectModel.ts` 中引用 HexColor 处改为 import。

## B3 缩放动画
- [x] T3.1 `ZoomAnimation.swift` L1–L300（`NormalizedPoint` … `ZoomAnimationClip`）→ `ZoomAnimation.ts`。必测：
  - `NormalizedPoint.constrained(0.12)`：(0,1) → (0.12,0.88)。
  - `ZoomBezierCurve.value`：`linear` 在 0.3 处 = 0.3（误差<1e-4）；四个预设在 t=0/1 精确为 0/1；`quadratic/cubic/quintic` 在 [0,1] 上单调不减（采样 101 点）。
  - `ZoomAnimationClip` 构造：`scale` < 1 被提到 1；`enterDuration` 9 → 5；`endTime < startTime` → 等于 startTime。
- [x] T3.2 `ZoomAnimation.swift` L300–L943（`ZoomKeyframe`、`ZoomViewportTransform`、`ZoomAnimationTrack`、`ZoomInterpolator`、缓存类）。必测：
  - `springProgress(t, 2.4, 210, 42)`：t=0 → 0，t=1 → 1（精确），t∈(0,1) 结果在 [0,1]。
  - `ZoomInterpolator.sample` 在无动画时 scale=1、focus=(0.5,0.5)。
- [x] T3.3 `FocusEffect.swift`(118)、`ZoomTransitionResolution.swift`(54)。

## B4 自动运镜 + 光标（核心）
- [x] T4.1 `AutoZoomPlanner.swift`(651) → `AutoZoomPlanner.ts`。重载改名：`makeAnimationsFromPointerEvents` / `makeAnimationsFromClicks`、`clippedAnimations` / `clippedKeyframes`、`makeKeyframesFromPointerEvents` / `makeKeyframesFromClicks`。必测：
  - 两次点击 t=1.0/1.5、位置 (0.5,0.5)/(0.52,0.5) → 1 个 clip；`startTime = 1.0 − 0.7×0.18 = 0.874`。
  - 两次点击相隔 3s → 2 个 clip，第二个 `startTime ≥` 第一个 `effectEndTime`。
  - 点击位置 (0.01,0.99) → focus = (0.12,0.88)。
  - 单次左键点击 t=0、位置 (0.5,0.5)，之后 t=0.1,0.2,…,1.0 每 0.1s 一个 move 事件 → 唯一 clip 的 `endTime = max(0+0.9, 1.0+0.55) = 1.55`（活动延长 L245–305）。
  - 空输入 → `[]`。
- [x] T4.2 `PointerTrack.swift` L1–L460（含 `makeSpringSamples`）。分段。
- [x] T4.3 `PointerTrack.swift` L460–L894（点击锚定 `anchoringClicks`、`smootherStep`、`PointerInterpolator`）。必测：
  - `motion.cursor = 'smooth'`（取 Swift 中对应 rawValue）时，在左键点击时刻的 `samplePosition` 与点击坐标误差 < 1e-6。
  - `time <` 第一个事件时间 → `position === null`。
  - `style.assetID` 为 hidden 时 `cursor === null` 但 `position !== null`。
- [x] T4.4 `CursorRenderGeometry.swift`(358)。

## B5 3D 投影与构图
- [x] T5.1 `CompositionScene.swift` 中的 `CompositionRect` `CompositionPoint` 先移植（其余部分在 T5.5）。
- [x] T5.2 `ScreenProjection.swift`(360)。必测：
  - 旋转全 0 → quad 四角 = rect 四角（误差<1e-9）。
  - `perspective = 0`，rotationY=30 → 投影结果为平行四边形（TL→TR 向量 = BL→BR 向量）。
  - rotationX=20, rotationY=-25, perspective=1：对 rect 内 5 个点 `unproject(project(p))` 与 p 误差 < 1e-6。
  - `contains(quad.center) === true`；远处点 `false`；NaN 点 `false`。
- [x] T5.3 `ScreenMotion.swift`(611)、`ScreenMotionCreationStyle.swift`(45)。
- [x] T5.4 `CameraMotion.swift`(423)、`CameraContentFill.swift`(110)。
- [x] T5.5 `CompositionScene.swift` 剩余部分（`CompositionSceneEvaluator` 等）。

## B6 帧场景
- [x] T6.1 `OverlayTimeline.swift`(393)。
- [x] T6.2 `StickerTransition.swift`(266)。
- [x] T6.3 `FrameScene.swift` L1–L540（所有数据结构）。
- [x] T6.4 `FrameScene.swift` L540–L1284（`FrameSceneEvaluator`）。必测：同一输入调用两次 `deepEqual`；`refreshingCursor` 只改变 cursor 字段。

## B7 时间线与工程
- [x] T7.1 `MediaTimeline.swift`(121)、`ProjectTimeline.swift`(312)
- [x] T7.2 `TimelineMap.swift`(305)、`TimelineMediaPlan.swift`(375)
- [x] T7.3 `ProjectMediaModel.swift`(410)、`ProjectPointerTrack.swift`(469)
- [x] T7.4 `ProjectValidator.swift`(210)、`ExportPolicy.swift`(68)、`CaptureConfiguration.swift`(492)
- [x] T7.5 `ProjectTimelineRetime.swift`(215)
- [x] T7.6 `ProjectTimelineEditing.swift`(935) 分 2 段
- [x] T7.7 `ProjectTimelineEditingTransforms.swift`(1168) 分 3 段（Swift `extension` 写进同一个 `ProjectTimelineEditing` 命名空间：在 `ProjectTimelineEditingTransforms.ts` 中导出函数，再由 `ProjectTimelineEditing.ts` re-export）
- [x] T7.8 `EditorTimeline.swift`(938) 分 2 段

## B8 可选
- [x] T8.1 `AudioCaptureDiagnostics` `CameraCaptureDiagnostics` `RecordingPerformanceDiagnostics`

## 阶段 1 收尾
- [x] T9.1 新增 `test/core/pipeline.test.ts`：构造 3 次点击的 pointer 事件 → `AutoZoomPlanner` → 构造工程 → `FrameSceneEvaluator.scene` 在 t=0、点击时刻、末尾三个时间点求值，断言不含 NaN（递归检查所有数字字段）。
- [x] T9.2 在 PROGRESS.md 写「阶段 1 完成」，**停止**，等待用户确认阶段 2 方案。

---
# 阶段 2~5 任务卡（高阶 AI 于 2026-11-02 规划；契约见 `docs/CONTRACTS.md`，开工前必读）

通用补充（阶段 2 起适用）：
- 每张卡只改卡内列出的文件；新增文件必须在卡内列出。
- 每张卡完成条件仍是 AGENTS.md §0 的 8 步。测试文件放 `test/<目录>/`，与源文件同名加 `.test.ts`。
- 卡内「函数签名」是**硬约定**，名字/参数顺序不得改。
- 遇到卡内没写的决策：不要猜，写 `NEED-DECISION` 并停止。

## 阶段 2 采集（B10）
- [x] T10.1 `src/capture/PointerJsonl.ts` + `test/capture/PointerJsonl.test.ts`
  - 签名：`export function parsePointerJsonl(text: string): { originUnixMs: number; screen: {x:number;y:number;w:number;h:number}; events: PointerEventRecord[] }`
  - `PointerEventRecord` 用 `makePointerEventRecord({time, location: makeNormalizedPoint(nx,ny), kind})`（见 `src/core/ZoomAnimation.ts`）。
  - 规则严格按 CONTRACTS §2。无表头 → `throw new Error('pointer.jsonl 缺少表头')`。
  - 必测：①正常 3 行（含 1 次 leftClick）；②坏行/空行/未知 k 被忽略；③坐标越界被夹到 [0,1]；④乱序 t 被稳定排序；⑤screen 偏移（x=1920,w=1920）归一化正确；⑥无表头抛错。
- [x] T10.2 `tools/mousehook.ps1`（PowerShell 5.1 + `Add-Type` 内嵌 C#）+ `src/capture/MouseHook.ts` + `test/capture/MouseHook.test.ts`
  - ps1：C# 里 `SetWindowsHookEx(WH_MOUSE_LL=14,...)`，消息循环用 `Application.Run()`（`Add-Type -AssemblyName System.Windows.Forms`）；`Stopwatch` 计时；`WM_MOUSEMOVE(0x200)→move`、`WM_LBUTTONDOWN(0x201)→leftClick`、`WM_RBUTTONDOWN(0x204)→rightClick`，其余丢弃；move 事件节流到 ≥4ms 一条；每行立即 `Console.Out.Flush()`。表头按 CONTRACTS §2（screen 用 `[System.Windows.Forms.Screen]::PrimaryScreen.Bounds`；若进程非 DPI 感知，需在 C# 中调用 `SetProcessDPIAware()` 以拿到真实像素）。
  - 退出：stdin 读到一行 `q` 或 stdin 关闭 → `Application.Exit()`、卸载钩子。
  - MouseHook.ts：`export function startMouseHook(): { process: ChildProcess; lines: AsyncIterable<string>; stop(): Promise<void> }`；用 `child_process.spawn('powershell.exe',['-NoProfile','-File', <abs path>])`，**不得**加 ExecutionPolicy 参数。`stop()` 写 `q\n`，2 秒未退出则 `kill()`。
  - 必测（用 `{ skip: !process.env.DOGSC_E2E }` 包住真实进程部分）：启动后 3 秒内读到表头行且 `JSON.parse` 成功且含 `hdr/originUnixMs/screen`；`stop()` 后进程已退出。再写一个**不需要真实进程**的测试：对 `startMouseHook` 的参数构造部分抽成纯函数 `buildMouseHookCommand(): {command:string;args:string[]}` 并断言 args 不含 `Bypass`。
  - 若 `-File` 被执行策略拒绝（当前机器为 RemoteSigned，本地脚本应可运行）：`BLOCKED`，询问用户，**不要**绕过。
- [ ] T10.3 `src/capture/ScreenRecorder.ts` + `test/capture/ScreenRecorder.test.ts`
  - 纯函数：`export function buildFfmpegArgs(o: { outFile: string; fps: number; encoder: 'h264_nvenc'|'libx264'; outputIdx?: number }): string[]`
    - 期望（nvenc）：`['-y','-f','lavfi','-i',`ddagrab=output_idx=${idx}:framerate=${fps}`,'-c:v','h264_nvenc','-preset','p4','-rc','vbr','-cq','23','-b:v','0','-pix_fmt','yuv420p','-r',String(fps),'-fps_mode','cfr',outFile]`；ddagrab 输出是 D3D11 帧，转 yuv420p 需 `-vf hwdownload,format=bgra,format=yuv420p`，插在 `-c:v` 前（nvenc 与 libx264 都用）。以实际能跑通为准，跑通后把最终参数写回本卡注释与测试期望（单独一次提交说明原因）。
  - `export async function detectEncoder(): Promise<'h264_nvenc'|'libx264'>`：执行 `ffmpeg -hide_banner -encoders`，输出含 `h264_nvenc` 则用之（不做实机编码探测）。
  - `export function startScreenRecording(o): { screenStartUnixMs:number; stop(): Promise<void> }`：`Date.now()` 在 spawn 之前取；`stop()` 往 stdin 写 `q`，5 秒不退出则 kill。
  - 必测：buildFfmpegArgs 两种 encoder 的断言；`detectEncoder` 返回值属于两者之一。E2E（`DOGSC_E2E`）：录 2 秒，`ffprobe -v error -show_entries format=duration -of csv=p=0` 时长在 1.5~3.5 秒。
- [ ] T10.4 `src/capture/RecordingSession.ts` + `test/capture/RecordingSession.test.ts`
  - 纯函数（可测）：`export function buildMeta(i:{id:string;fps:number;width:number;height:number;screenStartUnixMs:number;pointerOriginUnixMs:number;encoder:string;durationSeconds:number}): object`（含 `pointerOffsetSeconds`，见 CONTRACTS §3）。
  - 纯函数：`export function buildProjectFromRecording(events: PointerEventRecord[], offsetSeconds: number, durationSeconds: number): RecorderProject`：事件时间加 offset → `makeAnimationsFromPointerEvents` → `makeRecorderProject({zoomAnimations, timeline: makeProjectTimeline({zoomClips})})`。
  - `export async function recordSession(o:{seconds:number; fps?:number; baseDir?:string}): Promise<string>`（返回录制目录）：先启动钩子并等表头，再启动录屏，等 `seconds`，先停录屏再停钩子，写 meta.json / project.json（`encodeRecorderProject`）。
  - 必测：buildMeta 的 offset 计算；buildProjectFromRecording 3 次点击 → 3 个 zoomAnimations 且 `ProjectValidator.validate` 不抛错；offset 使所有事件时间 +offset。
- [ ] T10.5 `scripts/record.ts`（CLI）+ `docs/USAGE.md`
  - `node scripts/record.ts --seconds 10 [--fps 60]`，结束时打印录制目录。USAGE.md 写使用方法与「手动验收清单」（见 T10.6）。
- [ ] T10.6 阶段 2 手动验收与校准（**需要用户在场操作**）
  - Agent 先写好 `scripts/calibrate.ts`：录 6 秒，屏幕上无需任何东西，仅提示用户「在第 2、4 秒各点击一次屏幕任意位置」，结束后打印 `pointer.jsonl` 中的点击时间与 `meta.json` 的 offset。
  - 用户手动验收：①`screen.mp4` 可播放 ②`pointer.jsonl` 里有点击行 ③点击坐标大致正确。把结果写进 PROGRESS.md，然后**停止**，等用户确认进入阶段 3。

## 阶段 3 渲染与导出（B11）——开工前需高阶 AI 复核 CONTRACTS §4
- [ ] T11.1 `src/server/DevServer.ts` + 测试：`export function startDevServer(o:{rootDir:string; port?:number}): Promise<{port:number; close():Promise<void>}>`；静态文件 + `.ts`→JS（CONTRACTS §4）；`port` 缺省取 0（随机）。必测：GET `/src/core/swift.ts` 返回 200、`content-type` 含 `javascript`、正文不含 `: number` 这类类型标注（用 `export function clamp(` 附近断言即可）；路径穿越 `/../package.json` 返回 403/404。
- [ ] T11.2 `src/render/FramePlan.ts` + 测试：`export function makeFramePlan(i:{project:RecorderProject; pointerEvents:PointerEventRecord[]; fps:number; durationSeconds:number; sourceFrameCount:number; canvas:{width:number;height:number}}): { frameCount:number; frameAt(n:number): { scene: FrameScene; sourceFrameFile: number } }`。严格按 CONTRACTS §4 的映射。必测：n=0 的 sourceFrameFile=1；末帧不越界；同一 n 两次 `deepEqual`；整段所有 scene 无 NaN（复用 `assertNoNaN` 写法，见 `test/core/pipeline.test.ts`）。
- [ ] T11.3 `src/capture/FrameExtractor.ts` + 测试：`extractFrames(i:{video:string; outDir:string; fps:number}): Promise<number>` 调用 ffmpeg 预解码，返回帧数；纯函数 `buildExtractArgs` 单测；E2E 用 `DOGSC_E2E`。
- [ ] T11.4 `web/render.html` + `web/renderer.ts`：最小 WebGL2 渲染——清屏为背景色、把屏幕帧 JPEG 作为纹理画成 `scene.screen.projectedQuad` 的四边形（两个三角形，透视校正用齐次坐标，参考 `ScreenProjection.ts`）。页面读 URL `?mode=preview&frame=N` 渲染单帧。验收：Edge 命令行 `--headless=new --screenshot=out/t114.png --window-size=1920,1080 http://127.0.0.1:<port>/web/render.html?...` 生成非空 PNG（>10KB）。
- [ ] T11.5 渲染增强（一个效果一次提交，可拆 T11.5a~e）：a 圆角+边框；b 阴影；c 背景（纯色/渐变，读 `scene.background`）；d 光标（画 `scene.cursor.layout`，先用简单箭头多边形，不加载素材）+ 点击涟漪；e 摄像头/贴纸**跳过**（阶段 3 不做）。
- [ ] T11.6 导出：`src/server/ExportServer.ts`（`/api/plan`、`/api/frame/:n`、`/api/done`，严格递增顺序，长度校验）+ `web/exporter.ts`（循环渲染+POST）+ `scripts/export.ts`（启动服务→启动 Edge→等待→输出 mp4）。必测：ExportServer 对错误长度返回 400、乱序帧返回 409；用假的 ffmpeg 命令（`node -e` 吞 stdin）验证帧计数。
- [ ] T11.7 阶段 3 验收（**需要用户在场**）：用 T10 的真实录制导出 MP4，用户肉眼确认「自动缩放跟随点击、光标平滑」。通过后 PROGRESS.md 写「阶段 3 完成」并**停止**。

## 阶段 4 编辑器（粗粒度，阶段 3 完成后由高阶 AI 细化成卡）
预览页（拖时间线预览）→ 缩放片段拖拽（用 `EditorTimeline.ts`）→ 剪切/变速（用 `ProjectTimelineEditing.ts`）→ 保存 `project.json`。

## 阶段 5 打包（需用户决策 Electron/Tauri/纯脚本启动器）

