# 上游 v0.2.0 核心算法差异审计与依赖拓扑图（`docs/V020_DIFF_MAP.md`）

> **任务卡**：`T13.1`（Wave B 首卡）  
> **审计时间**：2026-11-23  
> **上游仓库**：`https://github.com/laogou717/dogsc`  
> **目标标签**：`v0.2.0`（Commit `2955c52b60e0cc4bc51898f3c868a925979e5fb5`，只读克隆于 `F:\dogsc-v0.2.0`）  
> **本地旧基线**：`v0.1.8`（只读位于 `F:\dogsc\Sources\RecorderCore`，共 `44` 个 `.swift` 文件）  
> **Windows 目标目录**：`F:\dogsc-win\src\core`（现有 `44` 个对应 `.ts` 模块 + `swift.ts`）

---

## 一、总览统计

- `RecorderCore` 源文件规模：`44`（`v0.1.8`）→ `53`（`v0.2.0`）：
  - **新增（`NEW`）**：`9` 个 `.swift` 文件
  - **移除（`REMOVED`）**：`0` 个
  - **未改动（`SAME`，忽略空白差异）**：`10` 个 `.swift` 文件
  - **已修改（`MOD`，`git diff --no-index -w --numstat`）**：`34` 个 `.swift` 文件
    - 其中 **25 个含实质行为/结构/Schema 变更**
    - 其中 **9 个为纯删减注释/清理改动（`+0/-N`）**

---

## 二、新增 9 个模块与依赖拓扑

### 移植层级拓扑（严格遵循 `PORTING_RULES.md §7` 禁止临时 stub）

```text
Tier 1 (T13.2: 独立值类型与混合数学)
  ├─ CameraBeauty.swift
  ├─ ScreenCardAppearance.swift (L1-86 核心模型; L88-287 RecorderProject 扩展延至 T13.5)
  └─ SegmentSceneStyle.swift (L1-281 完整模型与 Canvas/Camera/HexColor 混合)

Tier 2a (T13.3a: 叶子多源与后期素材模型)
  ├─ RecordingSource.swift (L1-75 核心结构; L77-154 RecorderProject 扩展延至 T13.5)
  ├─ RecordingAspectTransitions.swift (L1-95 结构化切片输入 + 240ms 平滑插值)
  └─ PostProductionModel.swift (L1-506 后期叠层/素材/字幕模型)

Tier 2b (T13.3b / T13.4: 依赖 T13.5 多源共享模块升级后再接线，先在 T13.5 同步共享层)
  ├─ RecordingSourceEditing.swift (依赖 RecordingSource, TimelineMap, ProjectTimelineEditing, RecordingProjectImport, ProjectValidator)
  ├─ VisualTrackTransfer.swift (值类型 MainTrackVisualStyle/VisualClipSound 独立; 转轨操作依赖 ProjectTimelineEditing, TimelineMap)
  └─ RecordingProjectImport.swift (依赖 RecordingSource, RecordingSourceEditing, ProjectTimelineEditing, TimelineMap, RecorderProject)
```

> **显式 REORDER 说明**：原 `TASKS.md` 将 `T13.3`/`T13.4` 排在 `T13.5` 之前。实测 `RecordingSourceEditing`、`RecordingProjectImport` 与 `VisualTrackTransfer` 运行时依赖 `T13.5` 中 `ProjectTimeline` / `OverlayTimeline` / `TimelineMap` / `ProjectTimelineEditing` 的 v0.2.0 多源新接口（如 `RecordingSegment.sourceID` / `media` / `sceneStyle` / `crop`、`insertMediaSegment`、`AnimationClip` 等）。按 `PORTING_RULES.md §7`，`T13.2` 先完成 Tier 1，`T13.3a` 完成 Tier 2a 叶子模型，Stage 3 先执行 `T13.5` 同步 44 个共享模块，随后补完 `T13.3b` / `T13.4` 与 `T13.6`（G3 Schema 双向 Golden 测试）。

### 新增 9 文件明细表

| 上游文件 (`v0.2.0`) | 行数 | 顶级导出符号 | 关键跨文件依赖 | 目标 TS 文件 | 归属卡 |
|---|---:|---|---|---|---|
| `CameraBeauty.swift` | 23 | `CameraBeautySettings` (`smoothing`, `whitening`, `isEnabled`) | 无（纯值对象） | `src/core/CameraBeauty.ts` | `T13.2` |
| `ScreenCardAppearance.swift` | 287 | `ScreenCardAppearance`, `ScreenAppearanceTarget`; `RecorderProject` 扩展 (`resolvedCrop`, `settlingSegmentAppearance`, `segmentCrops`, `screenCanvas`, `settledCamera`, `cameraAppearanceTransitionSample`, `cameraMotionBase`, `setScreenAppearance`, `preserveLegacyScreenAppearances`) | `CanvasStyle`, `HexColor`, `ScreenFrameStyle`; 扩展部分依赖 `SegmentSceneStyle`, `RecordingSource`, `CameraMotion`, `RecorderProject` | `src/core/ScreenCardAppearance.ts` | `T13.2` (L1-86) + `T13.5` (扩展) |
| `SegmentSceneStyle.swift` | 281 | `SegmentSceneStyle`, `RecordingSegmentBoundary`, `SegmentAppearanceTransition`, `HexColor.mixing`, `CanvasStyle.blend`, `CameraStyle.blend` | `ProjectModel` (`CanvasStyle`, `CameraStyle`, `RecordingSegment`), `HexColor`, `ScreenFrameStyle` | `src/core/SegmentSceneStyle.ts` | `T13.2` |
| `RecordingSource.swift` | 154 | `RecordingSource` (`primaryID`, `media`, `crop`, `screenAppearance`, `colorIndex`), `RecorderProject` 多源方法 (`sources`, `source(_:)`, `setMedia`, `captureFrameRate`, `setCrop`, `setSegmentCrop`) | `ProjectMediaManifest`, `NormalizedCrop`, `ScreenCardAppearance`, `RecorderProject` | `src/core/RecordingSource.ts` | `T13.3a` (模型) + `T13.5` (扩展) |
| `RecordingAspectTransitions.swift` | 95 | `RecordingAspectTransitions` (`duration = 0.240`, `sourceAspectRatio(atOutputTime:sourceID:)`) | `TimelineMediaPlan`, `NormalizedCrop`, `ScreenFrameStyle`, `SegmentSceneStyle` | `src/core/RecordingAspectTransitions.ts` | `T13.3a` |
| `PostProductionModel.swift` | 506 | `TimedOverlayClip`, `MediaAssetKind`, `MediaAsset`, `VideoClip`, `AudioClip`, `SubtitleCue`/`Font`/`Entrance`/`Style`/`Text`/`SRT` | `OverlayTimeline` (`OverlayTiming`, `AnimationClip`), `NormalizedPoint`, `MainTrackVisualStyle`, `VisualClipSound` | `src/core/PostProductionModel.ts` | `T13.3a` |
| `RecordingSourceEditing.swift` | 92 | `RecorderProject.stabilizeRecordingColors()`, `RecordingSourceEditing` (`usageCount`, `insertingFullRecording`, `removing`, `droppingMissingSources`) | `RecordingSource`, `SourceSequence`, `TimelineMap`, `ProjectTimelineEditing`, `RecordingProjectImport`, `ProjectValidator` | `src/core/RecordingSourceEditing.ts` | `T13.3b` |
| `VisualTrackTransfer.swift` | 138 | `MainTrackVisualStyle`, `VisualClipSound`, `TransferableVisualClip`, `VisualTrackTransferError`, `VisualTrackTransfer` (`moveToMain`, `moveToOverlay`) | `PostProductionModel` (`VideoClip`), `OverlayTimeline` (`StickerClip`), `ProjectTimelineEditing`, `TimelineMap` | `src/core/VisualTrackTransfer.ts` | `T13.4` |
| `RecordingProjectImport.swift` | 295 | `RecordingProjectImportOptions`, `RecordingProjectImport` (`adding`, `inserting`, `insertionTime`, `splitEdits`) | `RecordingSource`, `RecordingSourceEditing`, `ProjectTimelineEditing`, `TimelineMap`, `RecorderProject` | `src/core/RecordingProjectImport.ts` | `T13.4` |

---

## 三、44 个共享模块差异对照

### A. 25 个行为/Schema 修改模块（按变更规模排序）

| 上游 `.swift` | Diff (`-w`) | 行数变化 (`v0.1.8` → `v0.2.0`) | 本地对应 TS 模块 | 主要变化域（待 `T13.5` 逐行对齐） |
|---|---:|---:|---|---|
| `FrameScene.swift` | `+324/-61` | `1284 → 1547` | `src/core/FrameScene.ts` | 多源画面、片段级样式切换/转场、外框适配、贴图/音视频通道求值 |
| `ProjectTimelineEditing.swift` | `+244/-105` | `935 → 1074` | `src/core/ProjectTimelineEditing.ts` | `insertMediaSegment`、`RecordingSegment` 多源与样式/裁剪编辑、叠层随剪辑迁移 |
| `OverlayTimeline.swift` | `+179/-5` | `393 → 567` | `src/core/OverlayTimeline.ts` | `AnimationClip`、HTML 动效元素编辑 `MotionElementEdit` / `AnimationPropertyValue` |
| `ProjectTimeline.swift` | `+173/-5` | `312 → 480` | `src/core/ProjectTimeline.ts` | `InsertedMedia`（13 个字段）、`RecordingSegment` 新增 `media/sourceID/sceneStyle/crop`、片段边界查询 |
| `TimelineMediaPlan.swift` | `+121/-118` | `375 → 378` | `src/core/TimelineMediaPlan.ts` | 多录制源 `sourceID` / `segmentID` / `media` 切片规划与音轨计划 |
| `ProjectTimelineEditingTransforms.swift` | `+109/-16` | `1168 → 1261` | `src/core/ProjectTimelineEditingTransforms.ts` | 视频/音频/字幕/动画叠层与 `RecordingSegment` 随拆剪/删除/变速变换 |
| `TimelineMap.swift` | `+96/-67` | `305 → 334` | `src/core/TimelineMap.ts` | 多源分段映射、`outputTime` ↔ `sourceID/sourceTime` 定位 |
| `PointerTrack.swift` | `+93/-49` | `894 → 938` | `src/core/PointerTrack.ts` | 多录制源指针轨迹查询、光标点击按下反馈支持 |
| `ExportSettings.swift` | `+68/-1` | `19 → 86` | `src/core/ExportSettings.ts` | `ExportVideoCodec` (`h264`/`hevc` 与 4096 像素限幅)、`ExportQuality` (`compact`/`high`/`maximum`) |
| `ProjectPointerTrack.swift` | `+66/-28` | `469 → 507` | `src/core/ProjectPointerTrack.ts` | 多录制源合并指针流与时间轴对齐 |
| `ExportPolicy.swift` | `+60/-12` | `68 → 116` | `src/core/ExportPolicy.ts` | 导出帧率/分辨率/编码/预估大小策略对齐 v0.2.0 |
| `AutoZoomPlanner.swift` | `+54/-89` | `651 → 616` | `src/core/AutoZoomPlanner.ts` | 自动运镜规划与多源/片段边界适配 |
| `ProjectModel.swift` | `+36/-91` | `1323 → 1268` | `src/core/ProjectModel.ts` | `ProjectSchema.currentVersion = 28`、`deviceTablet` 入选项、预置展示名、`CursorStyle.pressesOnClick`、`CameraStyle.beauty` |
| `CompositionScene.swift` | `+33/-72` | `501 → 462` | `src/core/CompositionScene.ts` | 场景合成模型与多源/外框几何对齐 |
| `CursorRenderGeometry.swift` | `+29/-31` | `358 → 356` | `src/core/CursorRenderGeometry.ts` | 光标点击按压形变与倾斜几何 |
| `ProjectMediaModel.swift` | `+27/-135` | `410 → 302` | `src/core/ProjectMediaModel.ts` | 移除 v23 以前废弃迁移动作、新增 `additionalSources`、`decodedVersion < 28` 调用 `preserveLegacyScreenAppearances()` |
| `ZoomTransitionResolution.swift` | `+27/-5` | `54 → 76` | `src/core/ZoomTransitionResolution.ts` | 缩放转场边界解析适配 |
| `CameraMotion.swift` | `+25/-4` | `423 → 444` | `src/core/CameraMotion.ts` | `CameraMotionTrack.transitionSample` 等片段过渡采样接口 |
| `ProjectTimelineRetime.swift` | `+24/-7` | `215 → 232` | `src/core/ProjectTimelineRetime.ts` | 变速映射对多源与扩展叠层轨道的适配 |
| `ProjectValidator.swift` | `+14/-0` | `210 → 224` | `src/core/ProjectValidator.ts` | 多源 `additionalSources` 与扩展引用校验 |
| `ZoomAnimation.swift` | `+11/-142` | `943 → 812` | `src/core/ZoomAnimation.ts` | 缩放动画清理与边界稳健性调整 |
| `RecordingMarker.swift` | `+6/-1` | `15 → 20` | `src/core/RecordingMarker.ts` | 新增 `sourceID: UUID?` 与 `resolvedSourceID`（默认 `.primaryID`） |
| `ScreenFrameDefaults.swift` | `+3/-3` | `56 → 56` | `src/core/ScreenFrameDefaults.ts` | 外框默认圆角/比例微调（包括平板/设备框） |
| `CameraContentFill.swift` | `+2/-32` | `110 → 80` | `src/core/CameraContentFill.ts` | 摄像头填充裁剪精简 |
| `EditorTimeline.swift` | `+2/-195` | `938 → 745` | `src/core/EditorTimeline.ts` | 编辑器时间线轨道模型精简（配合 `PostProductionModel` 与多源） |

### B. 9 个纯删减/注释清理模块（`+0/-N`）

| 上游 `.swift` | Diff (`-w`) | 行数变化 | 本地对应 TS 模块 | 归类结论 |
|---|---:|---:|---|---|
| `AudioCaptureDiagnostics.swift` | `+0/-4` | `57 → 53` | `src/core/AudioCaptureDiagnostics.ts` | 仅删减冗长注释/兼容注释，`T13.5` 可顺手校验 |
| `BoundedMemoizationCache.swift` | `+0/-5` | `86 → 81` | `src/core/BoundedMemoizationCache.ts` | 仅删减注释 |
| `CameraCaptureDiagnostics.swift` | `+0/-17` | `207 → 190` | `src/core/CameraCaptureDiagnostics.ts` | 仅删减注释 |
| `CaptureConfiguration.swift` | `+0/-37` | `492 → 455` | `src/core/CaptureConfiguration.ts` | 仅删减兼容注释（Codable/legacy bridge） |
| `MediaTimeRange.swift` | `+0/-13` | `39 → 26` | `src/core/MediaTimeRange.ts` | 仅删减注释 |
| `MediaTimeline.swift` | `+0/-12` | `121 → 109` | `src/core/MediaTimeline.ts` | 仅删减注释 |
| `OutputFrameSchedule.swift` | `+0/-9` | `96 → 87` | `src/core/OutputFrameSchedule.ts` | 仅删减注释 |
| `RecordingPerformanceDiagnostics.swift` | `+0/-18` | `156 → 138` | `src/core/RecordingPerformanceDiagnostics.ts` | 仅删减注释 |
| `ScreenProjection.swift` | `+0/-92` | `360 → 268` | `src/core/ScreenProjection.ts` | 仅删减注释与未使用辅助 |

### C. 10 个完全未改动模块（`SAME`）

`CanvasCustomAspectRatio.swift` (32L)、`ElementMotion.swift` (36L)、`FocusEffect.swift` (118L)、`HexColor.swift` (79L)、`PointerEventTimelineOrdering.swift` (28L)、`PointerTimelineAlignment.swift` (56L)、`ScreenMotion.swift` (611L)、`ScreenMotionCreationStyle.swift` (45L)、`StickerTransition.swift` (266L)、`TimelineTrackOrdering.swift` (55L)。

---

## 四、Schema v27 → v28 持久化字段对照与迁移契约

> 说明：Windows 本地 `src/core/ProjectModel.ts` 当前 `ProjectSchema.currentVersion = 27`（已包含 `CanvasAspectRatio` `'1:2.39'` 与 `CanvasResolution` `'原始素材'/'1080p'/'1440p'/'4K'` 及 `ScreenFrameStyle` 设备外框枚举分支）。下面列出 `v0.1.8 (v27)` 升级至 `v0.2.0 (v28)` 的全部字段级差异与迁移策略。

| 模型位置 | 新增 / 变更字段 | 类型 / 取值 | 缺省解码默认值（兼容 v23–v27） | 编码规则（v28）与迁移说明 |
|---|---|---|---|---|
| `ProjectSchema` | `minimumSupportedVersion` / `currentVersion` | `23` / `28`（原 `27`） | `23 <= version <= 28`；越界抛 `ProjectSchemaError` | 编码恒输出 `version: 28`；本地已含 v1..v27 兼容逻辑需保留（Windows 额外兼容保留策略，按 G3 要求不丢未知字段与老工程） |
| `ScreenFrameStyle` | `allCases` | 加入 `.deviceTablet` | 原解包已支持 `.deviceTablet` 等所有枚举名 | Picker 展示列表扩展平板设备框 |
| `BackgroundPatternPreset` / `DynamicBackgroundPreset` | `displayName` | 网格/点阵中文短名；动态背景改为 `流动网格`/`流动点阵`/`流体渐变` | 不影响 JSON 存储（`rawValue` 不变） | UI 显示名同步更新 |
| `CursorStyle` | `pressesOnClick` | `boolean` | `true` | 总是编码输出 `pressesOnClick` |
| `CameraStyle` | `beauty` | `CameraBeautySettings` (`smoothing`, `whitening`) | `makeCameraBeautySettings()` (`0, 0`) | 随 `CameraStyle` 编解码 |
| `ExportSettings` | `videoCodec`, `quality` | `videoCodec?: 'h264' \| 'hevc'`; `quality: 'compact' \| 'high' \| 'maximum'` | `videoCodec: null/undefined`（`resolvedVideoCodec` 回落 `'h264'`；`init` 默认 `'h264'`）, `quality: 'high'` | 新增 `outputDimensions(for:)`: H.264 最大边限幅 `4096` 偶像素对齐 |
| `RecordingMarker` | `sourceID` | `string \| null` | `null`（`resolvedSourceID` 返回 `RecordingSource.primaryID`） | 非空时编码 `sourceID` |
| `RecordingSegment` | `media`, `sourceID`, `sceneStyle`, `crop` | `InsertedMedia \| null`, `string \| null`, `SegmentSceneStyle \| null`, `NormalizedCrop \| null` | 四者皆缺省为 `null`（`sourceID = null` 代表主录制 `RecordingSource.primaryID`） | `crop` 仅在脱离录制源独立裁剪时写入；`sceneStyle` 仅在分段独立样式时写入 |
| `InsertedMedia` | 完整插入素材模型（13 字段） | `path`, `fileDuration`, `name`, `usesFrameStyle`, `screenAppearance`, `sourceAspectRatio`, `motionPath`, `imagePath`, `properties`, `soundPath`, `elementEdits`, `overlayOrigin`, `transferSound` | `usesFrameStyle = false`, `properties = {}`, `elementEdits = {}`, 其余可选为 `null` | `sourceAspectRatio` 过滤非正/非有限值 |
| `RecorderProject` | `additionalSources` | `RecordingSource[]` | `[]` | **编码契约**：`additionalSources` 为空时省略该键，保持单源 v28 载荷最小化；**解码迁移**：`if (decodedVersion < 28) preserveLegacyScreenAppearances()` 将顶层 `canvas` 的卡片外观冻结到既有的 `additionalSources` 与已插入媒体段（避免后续修改主录制意外改动旧片段）。|

---

## 五、Wave B 后续执行映射（`T13.2`–`T13.6`）

1. **`T13.2`（Stage 2）**：按 `PORTING_RULES.md` 移植 `CameraBeauty`、`ScreenCardAppearance`（L1–86 核心结构）、`SegmentSceneStyle` 及完整单测。
2. **`T13.3a`（Stage 2）**：移植叶子多源与后期模型 `RecordingSource`（核心结构）、`RecordingAspectTransitions`、`PostProductionModel` 及完整单测。
3. **`T13.5`（Stage 3 首卡）**：逐行同步 25 个实质修改共享文件与 9 个清理文件至 `v0.2.0`，将 `ProjectSchema.currentVersion` 升至 `28`，接入 `CameraStyle.beauty`、`CursorStyle.pressesOnClick`、`ExportSettings`、`RecordingMarker.sourceID`、`RecordingSegment` 多源/样式/插片、`RecorderProject.additionalSources` 与 `preserveLegacyScreenAppearances()`，补齐 `ScreenCardAppearance` / `RecordingSource` 上挂在 `RecorderProject` 的扩展方法与单测。
4. **`T13.3b` & `T13.4`（Stage 3 接续）**：移植 `RecordingSourceEditing`、`RecordingProjectImport` 与 `VisualTrackTransfer` 运行时转轨算法（零 stub），勾销 `TASKS.md` 中 `T13.3` 与 `T13.4`。
5. **`T13.6`（Stage 3 门禁 G3）**：构造来自上游 `v0.2.0` 的 v27 与 v28 Golden Fixture JSON（含单源、多源、插入图片/HTML 动效、`SegmentSceneStyle`、未知扩展字段保留），实现 `test/core/SchemaInterop.test.ts` 通过双向往返验证。
