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
- [ ] T2.3 `ProjectModel.swift` 第 3 段（剩余，含 `AudioStyle` `CameraStyle` `MotionStyle`）。必测：`makeMotionStyle()` 默认值 = 屏幕弹簧 2.4/210/42、光标弹簧 2.8/450/66（Swift L1267–1272）。
- [ ] T2.4 `ScreenFrameDefaults.swift`(56)、`HexColor` 已有，检查 `ProjectModel.ts` 中引用 HexColor 处改为 import。

## B3 缩放动画
- [ ] T3.1 `ZoomAnimation.swift` L1–L300（`NormalizedPoint` … `ZoomAnimationClip`）→ `ZoomAnimation.ts`。必测：
  - `NormalizedPoint.constrained(0.12)`：(0,1) → (0.12,0.88)。
  - `ZoomBezierCurve.value`：`linear` 在 0.3 处 = 0.3（误差<1e-4）；四个预设在 t=0/1 精确为 0/1；`quadratic/cubic/quintic` 在 [0,1] 上单调不减（采样 101 点）。
  - `ZoomAnimationClip` 构造：`scale` < 1 被提到 1；`enterDuration` 9 → 5；`endTime < startTime` → 等于 startTime。
- [ ] T3.2 `ZoomAnimation.swift` L300–L943（`ZoomKeyframe`、`ZoomViewportTransform`、`ZoomAnimationTrack`、`ZoomInterpolator`、缓存类）。必测：
  - `springProgress(t, 2.4, 210, 42)`：t=0 → 0，t=1 → 1（精确），t∈(0,1) 结果在 [0,1]。
  - `ZoomInterpolator.sample` 在无动画时 scale=1、focus=(0.5,0.5)。
- [ ] T3.3 `FocusEffect.swift`(118)、`ZoomTransitionResolution.swift`(54)。

## B4 自动运镜 + 光标（核心）
- [ ] T4.1 `AutoZoomPlanner.swift`(651) → `AutoZoomPlanner.ts`。重载改名：`makeAnimationsFromPointerEvents` / `makeAnimationsFromClicks`、`clippedAnimations` / `clippedKeyframes`、`makeKeyframesFromPointerEvents` / `makeKeyframesFromClicks`。必测：
  - 两次点击 t=1.0/1.5、位置 (0.5,0.5)/(0.52,0.5) → 1 个 clip；`startTime = 1.0 − 0.7×0.18 = 0.874`。
  - 两次点击相隔 3s → 2 个 clip，第二个 `startTime ≥` 第一个 `effectEndTime`。
  - 点击位置 (0.01,0.99) → focus = (0.12,0.88)。
  - 单次左键点击 t=0、位置 (0.5,0.5)，之后 t=0.1,0.2,…,1.0 每 0.1s 一个 move 事件 → 唯一 clip 的 `endTime = max(0+0.9, 1.0+0.55) = 1.55`（活动延长 L245–305）。
  - 空输入 → `[]`。
- [ ] T4.2 `PointerTrack.swift` L1–L460（含 `makeSpringSamples`）。分段。
- [ ] T4.3 `PointerTrack.swift` L460–L894（点击锚定 `anchoringClicks`、`smootherStep`、`PointerInterpolator`）。必测：
  - `motion.cursor = 'smooth'`（取 Swift 中对应 rawValue）时，在左键点击时刻的 `samplePosition` 与点击坐标误差 < 1e-6。
  - `time <` 第一个事件时间 → `position === null`。
  - `style.assetID` 为 hidden 时 `cursor === null` 但 `position !== null`。
- [ ] T4.4 `CursorRenderGeometry.swift`(358)。

## B5 3D 投影与构图
- [x] T5.1 `CompositionScene.swift` 中的 `CompositionRect` `CompositionPoint` 先移植（其余部分在 T5.5）。
- [x] T5.2 `ScreenProjection.swift`(360)。必测：
  - 旋转全 0 → quad 四角 = rect 四角（误差<1e-9）。
  - `perspective = 0`，rotationY=30 → 投影结果为平行四边形（TL→TR 向量 = BL→BR 向量）。
  - rotationX=20, rotationY=-25, perspective=1：对 rect 内 5 个点 `unproject(project(p))` 与 p 误差 < 1e-6。
  - `contains(quad.center) === true`；远处点 `false`；NaN 点 `false`。
- [ ] T5.3 `ScreenMotion.swift`(611)、`ScreenMotionCreationStyle.swift`(45)。
- [ ] T5.4 `CameraMotion.swift`(423)、`CameraContentFill.swift`(110)。
- [ ] T5.5 `CompositionScene.swift` 剩余部分（`CompositionSceneEvaluator` 等）。

## B6 帧场景
- [ ] T6.1 `OverlayTimeline.swift`(393)。
- [ ] T6.2 `StickerTransition.swift`(266)。
- [ ] T6.3 `FrameScene.swift` L1–L540（所有数据结构）。
- [ ] T6.4 `FrameScene.swift` L540–L1284（`FrameSceneEvaluator`）。必测：同一输入调用两次 `deepEqual`；`refreshingCursor` 只改变 cursor 字段。

## B7 时间线与工程
- [ ] T7.1 `MediaTimeline.swift`(121)、`ProjectTimeline.swift`(312)
- [ ] T7.2 `TimelineMap.swift`(305)、`TimelineMediaPlan.swift`(375)
- [ ] T7.3 `ProjectMediaModel.swift`(410)、`ProjectPointerTrack.swift`(469)
- [ ] T7.4 `ProjectValidator.swift`(210)、`ExportPolicy.swift`(68)、`CaptureConfiguration.swift`(492)
- [ ] T7.5 `ProjectTimelineRetime.swift`(215)
- [ ] T7.6 `ProjectTimelineEditing.swift`(935) 分 2 段
- [ ] T7.7 `ProjectTimelineEditingTransforms.swift`(1168) 分 3 段（Swift `extension` 写进同一个 `ProjectTimelineEditing` 命名空间：在 `ProjectTimelineEditingTransforms.ts` 中导出函数，再由 `ProjectTimelineEditing.ts` re-export）
- [ ] T7.8 `EditorTimeline.swift`(938) 分 2 段

## B8 可选
- [ ] T8.1 `AudioCaptureDiagnostics` `CameraCaptureDiagnostics` `RecordingPerformanceDiagnostics`

## 阶段 1 收尾
- [ ] T9.1 新增 `test/core/pipeline.test.ts`：构造 3 次点击的 pointer 事件 → `AutoZoomPlanner` → 构造工程 → `FrameSceneEvaluator.scene` 在 t=0、点击时刻、末尾三个时间点求值，断言不含 NaN（递归检查所有数字字段）。
- [ ] T9.2 在 PROGRESS.md 写「阶段 1 完成」，**停止**，等待用户确认阶段 2 方案。
