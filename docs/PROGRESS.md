# PROGRESS.md — 进度日志（只追加，不要改历史行）

格式：`YYYY-MM-DD HH:MM | 任务号 | DONE/BLOCKED/WIP/REORDER/NEED-DEP | 说明 | 测试数`

2026-11-01 23:55 | T0.1 | DONE | 脚手架、swift.ts 语义辅助函数、node:test 跑通（Node 24 原生 .ts） | 10 pass
2026-11-01 23:55 | T0.2 | DONE | 范例：ElementMotion / MediaTimeRange / HexColor / PointerEventTimelineOrdering | 10 pass
2026-11-01 23:55 | PLAN | DONE | 高阶 AI 完成 PLAN.md / TASKS.md / PORTING_RULES.md / AGENTS.md | -

2026-11-01 23:58 | T5.1 | DONE | CompositionScene.ts 仅 CompositionRect/Point（其余属 T5.5，追加到同一文件） | -
2026-11-01 23:58 | T5.2 | DONE | ScreenProjection 完整移植（高阶 AI 提前完成，作为算法类范例） | 16 pass
2026-11-02 00:10 | T1.1 | DONE | RecordingMarker & ExportSettings 移植完成 | 20 pass
2026-11-02 00:39 | T1.2 | DONE | BoundedMemoizationCache LRU 缓存移植完成 | 24 pass
2026-11-02 00:43 | T1.3 | DONE | CanvasCustomAspectRatio, TimelineTrackOrdering, PointerTimelineAlignment 移植完成 | 32 pass
2026-11-02 00:45 | T1.4 | DONE | OutputFrameSchedule 帧调度与浮点截断移植完成 | 37 pass
2026-11-02 01:20 | T2.1 | DONE | ProjectModel 第 1 段 (版本、画布、开场序列、背景模型) 移植完成 | 43 pass
2026-11-02 01:29 | T2.2 | DONE | ProjectModel 第 2 段 (光标样式、裁剪区域、画布样式与像素分辨率) 移植完成 | 46 pass
2026-11-02 01:35 | T2.3 | DONE | ProjectModel 第 3 段 (音频、摄像头与运动物理样式默认值) 移植完成 | 48 pass
2026-11-02 01:38 | T2.4 | DONE | ScreenFrameDefaults 窗口外框样式预设移植完成 (B2 收官) | 50 pass
2026-11-02 04:36 | T3.1 | DONE | ZoomAnimation 第 1 段 (点坐标、贝塞尔高精度求根、缩放Clip构造) 移植完成 | 53 pass
2026-11-02 04:45 | T3.2 | DONE | ZoomAnimation 第 2 段 (关键帧、视口变换、缩放轨道二分查找、弹簧与缓动插值) 移植完成 | 60 pass
2026-11-02 04:49 | T3.3 | DONE | FocusEffect (焦点特效求值) 与 ZoomTransitionResolution (过渡意图求解与尾部裁剪) 移植完成 (B3 收官) | 63 pass
2026-11-02 04:54 | T4.1 | DONE | AutoZoomPlanner (点击时空聚类、18%进入前摇、指针活跃度延长、信封合并) 移植完成 | 69 pass
2026-11-02 05:03 | T4.2 | DONE | PointerTrack 第 1 段 (数据结构、240Hz物理弹簧模拟与预热缓存) 移植完成 | 70 pass
2026-11-02 05:04 | T4.3 | DONE | PointerTrack 第 2 段 (点击锚定与五次平滑插值、单调埃尔米特样条、PointerInterpolator) 移植完成 | 74 pass
2026-11-02 05:06 | T4.4 | DONE | CursorRenderGeometry (光标渲染几何、热点偏置与四种点击动效布局) 移植完成 (B4 收官) | 76 pass
2026-11-02 05:12 | T5.3 | DONE | ScreenMotion (屏幕运动轨道、视口锚点与无奇点像素位移) 与 ScreenMotionCreationStyle 移植完成 | 79 pass
2026-11-02 05:17 | T5.4 | DONE | CameraMotion (摄像头运动轨道与多布局渐变) 与 CameraContentFill (比例填充与水平镜像) 移植完成 | 82 pass
2026-11-02 05:30 | T5.5 | DONE | CompositionSceneEvaluator (场景几何求值、多布局相机、MotionTrackCacheStore) 移植完成 (B5 收官) | 88 pass
2026-11-02 05:33 | T6.1 | DONE | OverlayTimeline (马赛克裁剪/聚光灯、贴纸片段、互补退出动画与OverlayTiming) 移植完成 | 93 pass
2026-11-02 05:36 | T6.2 | DONE | StickerTransition (贴纸背景过渡遮罩、相邻片段平滑手递手接力与BackdropBridge) 移植完成 | 97 pass
2026-11-02 05:39 | T6.3 | DONE | FrameScene 第 1 段 (FrameScreenScene、FrameCameraScene、FrameCursorScene、FrameColorContract、FrameRenderPlan 等所有帧场景数据结构) 移植完成 | 104 pass
2026-11-02 05:56 | T6.4 | DONE | FrameScene 第 2 段 (FrameSceneEvaluator、scene纯函数求值、开场动画采样、refreshingCursor与光标分离调度) 移植完成 (B6 收官) | 106 pass
2026-11-02 06:03 | T7.1 | DONE | MediaTimeline (源轨道与时间线映射、Piecewise相机同步曲线) 与 ProjectTimeline (剪辑片段、完整TransitionTiming与音频覆写) 移植完成 | 113 pass
2026-11-02 06:23 | T7.2 | DONE | TimelineMap (时间线二分检索、单调性校验与指针事件切片映射) 与 TimelineMediaPlan (多轨道切片吸附与辅助时钟对齐) 移植完成 | 123 pass
2026-11-02 06:37 | T7.3 | DONE | ProjectMediaModel (工程媒体清单、项目JSON序列化与多版本兼容) 与 ProjectPointerTrack (剪辑桥接五次平滑插值、闲置隐藏与相机跟随阻尼) 移植完成 | 130 pass
2026-11-02 06:49 | T7.4 | DONE | ProjectValidator (全工程参数域严格校验)、ExportPolicy (动态导出媒体清单与码率阶梯) 与 CaptureConfiguration (录制配置、帧间隔诊断与交付率统计) 移植完成 | 144 pass
2026-11-02 07:00 | T7.5 | DONE | ProjectTimelineRetime (播放倍速重定时、时间锚点映射、缩放/贴纸动画重排与非重叠自适应修复) 移植完成 | 147 pass
2026-11-02 07:05 | T7.6 | REORDER | T7.6 依赖 ProjectTimelineEditingTransforms (T7.7) 中的 ripple/inserting/validate，按 PORTING_RULES §7 优先执行 T7.7 | 147 pass
2026-11-02 07:13 | T7.7 | DONE | ProjectTimelineEditingTransforms (时间线涟漪剪裁、相邻接点平滑回退过渡恢复、片段重映射与全轨道严格校验) 移植完成 | 153 pass
2026-11-02 07:22 | T7.6 | DONE | ProjectTimelineEditing (主录屏片段拆分/双向裁切/移动重排/首尾空隙与剪切点恢复/同质合并、独立音频覆写与屏幕/摄像运动CRUD) 移植完成 | 159 pass
2026-11-02 07:30 | T7.8 | DONE | EditorTimeline (编辑器轨道交互段模型、时间坐标映射、片段分割、磁吸吸附移动/调整、手柄命中测试与自适应空隙拟合) 移植完成 (B7 收官) | 167 pass
2026-11-02 07:36 | T8.1 | DONE | AudioCaptureDiagnostics (音频样本丢包与吞吐率统计)、CameraCaptureDiagnostics (系统/应用丢帧与帧间隔)、RecordingPerformanceDiagnostics (CPU/内存/磁盘与温度等级监控) 移植完成 (B8 收官) | 170 pass
2026-11-02 07:47 | T9.1 | DONE | pipeline.test.ts 端到端管道集成测试 (3次点击事件序列 -> AutoZoomPlanner 运镜生成 -> RecorderProject 全参数工程装配 -> FrameSceneEvaluator 全时段场景求值与递归零 NaN 校验) | 173 pass
2026-11-02 07:48 | T9.2 | DONE | 阶段 1 完成：所有核心模块（B0–B8）及端到端集成测试（T9.1）全部通过，共 173 个测试用例全绿，等待用户确认阶段 2 方案 | 173 pass

阶段 1 完成

2026-11-02 14:30 | PLAN-P2 | DONE | 高阶 AI 完成阶段2-5规划：docs/CONTRACTS.md（数据/接口契约）+ TASKS.md 新增 T10.1-T11.7 任务卡；用户已确认：Edge+WebGL2 渲染、PowerShell 鼠标钩子、每阶段结束停下等确认 | 173 pass
2026-11-02 14:35 | PLAN-P2 | NOTE | 实测 Agent 会话无法访问桌面(ddagrab access denied / gdigrab error 5)；已写入 CONTRACTS §6：真实采集 E2E 一律由用户在自己终端验证，Agent 只做纯函数与单测 | 173 pass
2026-11-02 19:50 | T10.1 | DONE | PointerJsonl (鼠标事件 JSONL 解析器，表头校验、坐标归一化、坏行容错、时间戳稳定排序) | 179 pass
2026-11-02 19:56 | T10.2 | DONE | tools/mousehook.ps1 (WH_MOUSE_LL 低级鼠标钩子) 与 MouseHook.ts 进程生命周期管理 (安全启动参数、异步行流、双向优雅停止) | 180 pass (1 skip E2E)
2026-11-02 19:59 | T10.3 | DONE | ScreenRecorder (ffmpeg ddagrab 屏幕录制参数构造、NVENC/libx264 自动探测与优雅停止) | 183 pass (2 skip E2E)
2026-11-02 20:03 | T10.4 | DONE | RecordingSession (录制时钟偏置计算、事件时间对齐、工程自动生成、双进程生命周期编排) | 186 pass (3 skip E2E)
2026-11-02 20:06 | T10.5 | DONE | scripts/record.ts (CLI命令行入口) 与 docs/USAGE.md (录制与手动验收指南) | 186 pass (3 skip E2E)
2026-11-02 20:08 | T10.6 | DONE | scripts/calibrate.ts (阶段2交互式校准工具) 交付完成，阶段2代码与单测全部就绪，停止等待用户手动校准与阶段3确认 | 186 pass (3 skip E2E)
2026-11-14 19:10 | T10.6 | VERIFIED | 用户手动执行 scripts/calibrate.ts 验收成功 (1080p 60fps h264_nvenc 录屏正常播放，鼠标点击精确捕获，时钟偏移 -0.001s)，阶段 2 正式完结收官 | 186 pass (3 skip E2E)
2026-11-14 19:21 | T11.1 | DONE | DevServer (原生Node HTTP服务、安全路径遍历拦截、stripTypeScriptTypes 动态类型擦除无构建服务) | 187 pass (3 skip E2E)
2026-11-14 19:26 | T11.2 | DONE | FramePlan (输出帧与源帧映射、CONTRACTS §4 sourceFrameFile=1约束、FrameSceneEvaluator幂等求值与零NaN校验) | 188 pass (3 skip E2E)
2026-11-14 19:40 | T11.3 | DONE | FrameExtractor (ffmpeg视频预解码帧序列提取、buildExtractArgs纯函数与错误处理) | 191 pass (4 skip E2E)
2026-11-14 20:00 | T11.4 | DONE | WebGL2最小渲染页 (web/render.html + web/renderer.ts 透视校正齐次顶点生成与无头Edge截图验证 out/t114.png 203KB) | 193 pass (4 skip E2E)
2026-11-14 20:03 | T11.5a | DONE | 屏幕SDF圆角裁剪与抗锯齿边框渲染 (computeScreenShaderUniforms 纯函数与GLSL片段着色器) | 194 pass (4 skip E2E)
2026-11-14 20:08 | T11.5b | DONE | 屏幕3D透视圆角阴影渲染 (buildShadowQuadVertices外扩透视投影与SDF柔和衰减着色器) | 195 pass (4 skip E2E)
2026-11-14 20:12 | T11.5c | DONE | 画布背景渐变与参数化网格图案渲染 (resolveBackgroundShaderParams全预设映射与BG片元着色器) | 196 pass (4 skip E2E)
2026-11-14 20:21 | T11.5d | DONE | 矢量光标多边形与点击涟漪特效渲染 (shadow+outline+fill箭头三角形与SDF点击波纹，实机截图 out/t115d.png 276KB 验收完美) | 198 pass (4 skip E2E)
2026-11-14 20:27 | T11.6 | DONE | 无头浏览器批量导出引擎 (ExportServer顺序帧长度/序号严格校验与ffmpeg流式管道、web/exporter.ts、scripts/export.ts、200单测全绿) | 200 pass (4 skip E2E)
2026-11-14 22:35 | T11.7 | NEED-USER-E2E | 实机录制导出 export.mp4 完成 (518帧/1920x1080/60fps/8.63s/6.13MB/h264_nvenc，首张放大抽检帧 out/t117_check.png 已验证正立/背景/圆角阴影/1.8x缩放/矢量光标与点击涟漪，待用户肉眼验收) | 200 pass (4 skip E2E)
2026-11-20 15:43 | PLAN-V2 | DONE | 基于 2026-11-20 实测对齐审计报告完成宏微观全栈重构总计划 V2 (新增 docs/MASTER_REFACTOR_PLAN_V2.md，升级 AGENTS/CONTRACTS/TASKS 共34张原子卡 T12.1~T17.4 与 G1~G6 / Computer Use 审核手册)；暂停 T11.7 验收，优先执行 Wave A 止血修复 P0-01~03 与 P1-01~07 | 200 pass (4 skip E2E)
2026-11-20 16:56 | T12.1 | DONE | MediaProbe 以 ffprobe 建立真实媒体真相；RecordingSession 写入真实 duration/frameCount/width/height；export 与 FramePlan 改用真实源时长。实机复导出 20261120-140843 为 588 帧/9.800s（旧成片 743 帧/12.383s），尾部复帧消除；`DOGSC_E2E=1 npm test` 213/213 全绿 | 213 pass (0 skip E2E)
2026-11-20 17:01 | T12.2 | DONE | ScreenRecorder 暴露 exited/stderr，stop 对 spawn error/超时/非零退出强制 reject；RecordingSession 增加 allocateUniqueSessionDir、早期崩溃 Promise.race 与失败目录递归清理，await finished(pointer.jsonl)；无效显示器 `--display 9` 实测 EXIT=1、stderr 含 `Failed to enumerate DXGI output 9`，recordings 无新增脏目录 | 216 pass (0 skip E2E)
2026-11-20 17:03 | T12.3 | DONE | ddagrab 默认 draw_mouse=0，WebGL 矢量光标成为唯一光标；detectEncoder 增加 1 帧 h264_nvenc 真机探活与 libx264 回退。实机 4 秒录制 `20261120-170249` 为 249 帧/4.150s，源帧 `out/t123_source_2_5.png` 无系统光标烘焙；E2E 218/218 全绿 | 218 pass (0 skip E2E)
2026-11-20 17:09 | T12.4 | DONE | ExportServer 增加 inactivity(30s)/total 双看门狗、`/api/error` 秒报、`/api/done` 总帧数强校验与半成品删除；web/exporter 单帧 AbortController 超时重试且失败上报；scripts/export Windows 下 taskkill Edge 进程树。真实导出 20261120-140843 全量 588 帧/9.800s，耗时 62.91s，无 headless Edge 残留；E2E 221/221 全绿 | 221 pass (0 skip E2E)
2026-11-20 17:13 | T12.5 | DONE | 新增 DisplayEnumeration（Per-Monitor V2 DPI + 负坐标/主屏排序/显式 index），mousehook 支持 -ScreenX/Y/W/H 并优先 SetProcessDpiAwarenessContext(-4)，RecordingSession 枚举显示器、索引越界前置报错并把 displayDescriptor 写入 meta。实机录制 20261120-171216：DISPLAY5 2176×1812，pointer 表头与 screen.mp4 分辨率一致，125 帧/2.083s；默认测试 222 pass/5 skip | 222 pass (5 skip 默认)
2026-11-20 17:16 | T12.6 | DONE | ProjectMediaModel 删除重复 CaptureConfiguration 与英文假默认值，改为导入统一中文 rawValue 模型；decodeRecorderProject 兼容旧英文 source/codec/resolution/systemAudioScope 并归一化 frameRate；buildProjectFromRecording 接收真实 captureOptions，recordSession 写入 source/displayID/displayName/真实 fps/H.264/三项音频与摄像头 false。真实 30fps 录制 20261120-171556 的 project.capture 为 30fps/H.264/recordsSystemAudio=false/displayID=0；默认测试 224 pass/5 skip | 224 pass (5 skip 默认)

2026-11-20 17:43 | T12.7 | DONE | ScreenRecorder 解析 `-progress pipe:1` 的 frame/out_time_us 生成 ready 与 firstFrameUnixMs；RecordingSession 等首帧后再计时并把 spawn/firstFrame 写入 meta；calibrate 增加严格双点击 evaluateCalibration；新增 tools/e2e-testcard.html、scripts/verify-export.ts 与 VerifyExport 单测。真实 8.6s 测试卡录制 20261120-173816：两个点击视频时刻 1.935s/4.182s，导出 517 帧/8.616s；verify-export 全部通过（时长差 0.000s、帧数一致、captureFrameRate 60、无音频声明、点击帧非黑可读）。默认 226 pass/5 skip；E2E 236/236。已知：导出画面顶部未出现测试卡 48px 闪帧条，闪帧≤1帧尚未通过自动/视觉门禁 | 236 pass (E2E 全绿)

2026-11-20 18:20 | T12.8 | DONE | `SafePath` 以 `path.relative` 替换 DevServer/ExportServer 的 `startsWith`，同名前缀兄弟目录返回 403；补根 README / MIT LICENSE / THIRD_PARTY_NOTICES；package 0.3.1 / Node >=22.18；PLAN 修正 53 文件/14,380 行。修 T12.7 闪帧验收缺陷：自动运镜会裁掉顶部 48px 条，测试卡改为点击目标整圆同步闪绿，`verify-export --sync` 对源/导出 green run 做 onset ≤1 帧校验；导出总超时从 500ms/帧提高到 1.5s/帧。真实录制 20261120-175917：2176x1812/60fps/568 帧/9.466s，点击 2.620s/5.006s，导出 568 帧/9.466s/3,681,926B，`verify-export --sync` 退出 0（时长差 0.000s、帧数 568/568、captureFrameRate 60、recordsSystemAudio false、闪帧 source/export onset 均 143/286 帧、maxDelta 0）。T11.7 仍按 D4 等用户肉眼复核，未勾选 | 默认 247 项 (242 pass / 5 skip)；E2E 247/247
2026-11-23 01:38 | T12.9 | DONE | ScreenRecorder 在编码前插入 showinfo 滤镜并用 -bf 0 -rc-lookahead 0 消除 NVENC 管线延迟，解析 n: 0 即刻测定 firstFrameUnixMs；verify-export 补齐 evaluatePointerToFlashSync 指针真同步检验、子进程 30s 超时与 --report 输出；e2e-testcard 移除顶部条 60ms CSS 渐变（247 pass / 5 skip） | 247 pass (5 skip E2E)
2026-11-23 01:43 | T12.10 | DONE | SafePath 增加 realpathSync 符号链接/junction 外逸拦截，ExportServer 异步等待进程退出兜底清理残片，RecordingSession 增加 stoppingNormally 守卫，还原丢失的 PLAN-V2 与 T12.1~T12.5 进度历史并隔离无效旧录制目录 | 248 pass (5 skip E2E)

阶段 2 验收通过

2026-11-23 02:00 | T13.1 | DONE | 完成上游 v0.2.0 只读克隆(F:\dogsc-v0.2.0)与 44→53 模块逐文件 -w diff 审计，输出 docs/V020_DIFF_MAP.md（9新增/25行为修改/9清理/10未改、Schema v28 字段对照与 REORDER 依赖拓扑） | 248 pass (5 skip E2E)
2026-11-23 02:04 | T13.2 | DONE | 移植 CameraBeautySettings、ScreenCardAppearance（核心模型）与 SegmentSceneStyle（片段边界 lookup / 240ms smoothstep / hexColorMixing / canvasStyleBlend / cameraStyleBlend），CameraStyle 接入 beauty 默认值，新增 10 项核心单测并通过 zero node:* 校验 | 258 pass (5 skip E2E)
2026-11-23 02:07 | T13.3 | REORDER | REORDER: T13.3(RecordingSourceEditing) / T13.4(VisualTrackTransfer, RecordingProjectImport) 依赖 T13.5 的 ProjectTimeline/OverlayTimeline/TimelineMap/ProjectTimelineEditing v0.2.0 多源接口，先完成叶子模型 T13.3a，禁止写临时 stub | 258 pass (5 skip E2E)
2026-11-23 02:08 | T13.3a | DONE | 移植 RecordingSource（核心结构）、RecordingAspectTransitions（240ms 兼容外框比例平滑插值与中途抢占重定位）与 PostProductionModel（MediaAsset / VideoClip / AudioClip / Subtitle* / MainTrackVisualStyle / VisualClipSound），新增 7 项核心单测且 zero node:* 校验通过 | 265 pass (5 skip E2E)
2026-11-23 02:30 | T13.5a | DONE | 同步 Schema v28 持久化模型（ProjectSchema v28、CursorStyle.pressesOnClick、ScreenFrameDefaults、RecordingMarker.sourceID、ExportSettings videoCodec/quality/4096 限幅、OverlayTimeline MotionElementEdit/AnimationClip、ProjectTimeline InsertedMedia/多源片段/图层组织、ProjectMediaModel v27->v28 自动冻结旧外观与 _unknownFields 无损保留、ExportPolicy 多源介质/码率阶梯与 CaptureEncodingPolicy、ProjectValidator 悬空源校验），消除 RecorderProject 扩展环依赖 | 271 pass (5 skip E2E)
2026-11-23 02:33 | T13.6 | DONE | 构建上游 v27 单源与 v28 全量多源黄金夹具 (test/fixtures/schema/) 与门禁 G3 SchemaInterop 测试（验证 v27->v28 迁移、v27<28 旧外观冻结幂等性、未知字段无损保留、v28 多源双向编码幂等与 v22/v29/悬空源拒收） | 275 pass (5 skip E2E)
2026-11-23 02:54 | T13.5b-1 | DONE | 同步 TimelineMap（多源 duration map / 重复源片段 / sourceID / sceneStyle / crop）、TimelineMediaPlan（Slice sourceID/media 与多源媒体映射）、ProjectTimelineRetime（多源片段保持与全轨重定时+修复马赛克timing映射）、ProjectTimelineEditingTransforms（动画轨/跨源场景错误/sticker sourceStart/全轨 ripple 与 remap/timelineInsertionTime/timelineSplitEdits）与 ProjectTimelineEditing（insertMediaSegment/insertPrimarySegments/movePrimarySegments/多源merge检查），新增 5 项单测且 zero node:* 校验通过 | 280 pass (5 skip E2E)
2026-11-23 02:59 | T13.3 | DONE | 移植 RecordingSourceEditing（projectStabilizeRecordingColors / usageCount / insertingFullRecording / removing / droppingMissingSources），新增 5 项单测（含范围插入分割跨 boundary 动效与音频、删源颜色稳定及唯一源拦截、缺源容错恢复与 fullRecording 回退），zero node:* 校验通过 | 285 pass (5 skip E2E)
2026-11-23 03:04 | T13.4 | DONE | 移植 VisualTrackTransfer（find/moveToMain/moveToOverlay 全轨往返互转与静音音量继承）与 RecordingProjectImport（adding/inserting 多源混入、冻结音频、裁剪对齐与 groupID 无冲突重映射），通过 53/53 上游 Swift 模块全量文件对照校验，新增 5 项单测且 zero node:* 校验通过 | 290 pass (5 skip E2E)
2026-11-23 03:24 | T13.5b-2a | DONE | 同步 CameraMotion（baseSample/transitionSample）、ScreenCardAppearance（cameraAppearanceTransitionSample/cameraMotionBase）、ZoomAnimation/ZoomTransitionResolution（transitionIntentVersion 0->1 修复与子帧片段过滤/微隙桥接）、AutoZoomPlanner（makeAnimationsInTimelineMap 多源隔离规划）、CursorRenderGeometry（80ms+180ms pressScale 曲线）、PointerTrack（零相位前后双向弹簧与 pressScale）、ProjectPointerTrack & TimelineMediaPlan（多源 eventsBySource 与同源相机区间限制），新增 6 项单测且 zero node:* 校验通过 | 296 pass (5 skip E2E)
2026-11-23 03:35 | T13.5 | DONE | 同步 CompositionScene（3.6%/4.6% 设备边框、cameraEdgeInset 安全边距与 cameraMotionBase，并修复 evaluateCameraWithAspect 误传位置参数调用 makeCameraMotionState 改用 makeCameraMotionStateFromBase）与 FrameScene（多源 sourceContentRect / beauty / pressScale / insertedMedia / post 音字动轨 / layerOrder 与 refreshingCursor），完成上游 v0.2.0 全部 53/53 RecorderCore 模块对齐并收官 Wave B；新增 2 项单测，zero node:* 与 53/53 文件存在性校验通过 | 298 pass / 303 total (0 fail, 5 skip E2E)
2026-11-23 03:36 | ARCH-DAG-WaveB | DONE | 刷新 docs/ARCHITECTURE_DAG.json 并通过 cli.py validate --strict 与 render --strict（24 节点 / 35 路径 / 0 警告）重建 docs/WORKFLOW.html（488.4 KB）与 docs/WORKFLOW.md；同步点亮 M_CoreV20（✓ 53模块 v28）、e_probe_v20/e_v20_plan、G_MediaProbe（T12.9 showinfo）、X_CapFail（T12.10）、G_Verify（G1-G3），保持 Wave C-F 与 T11.7 虚化（opacity 0.65） | cli.py --strict 0 warnings
2026-11-23 03:57 | T14.1 | DONE | 将 web/renderer.ts 单体着色器拆分为 web/passes/{glUtils,background,screen,cursor}.ts，新增 resolveLayerRenderOrder/dispatchSceneLayers 按 scene.layerOrder 动态调度、computeEffectiveScreenOpacity 抑制计算及 OffscreenRenderTarget FBO 基础设施；保持 renderer.ts 向后兼容导出并新增 5 项单测，zero node:* 与 stripTypeScriptTypes 全过 | 303 pass / 308 total (0 fail, 5 skip E2E)
2026-11-23 03:59 | T14.2 | DONE | 新增 web/passes/camera.ts（CameraPass + computeCameraShaderUniforms/sampleCameraUV/buildCameraQuadVertices/buildCameraShadowVertices），实现水平镜像、AspectFill uvRect 裁剪、SDF 圆角/圆形遮罩、柔和阴影与边框、缩放避让、贴纸 cameraSuppression/不透明度淡出与保边磨皮美白；接入 renderer.ts 调度并新增 2 项单测 | 305 pass / 310 total (0 fail, 5 skip E2E)
2026-11-23 04:03 | T14.3 | DONE | 新增 web/passes/spotlight.ts（SpotlightPass / computeBlurMosaicUniforms / computeSpotlightPassUniforms / evaluateSpotlightOutsideMask）并扩展 web/passes/screen.ts 片元着色器实现截屏矩形圆角模糊+像素化马赛克（防跨界采样泄露）与 3D 透视对齐多区域聚光灯并集遮罩（共享至 glUtils.ts 保持无环依赖）；接入 renderer.ts 并新增 2 项单测 | 307 pass / 312 total (0 fail, 5 skip E2E)
2026-11-23 04:10 | T14.4 | DONE | 新增 web/passes/stickers.ts（StickerPass + BackdropBlurRelay + computeStickerRenderPlan + buildRotatedQuadVertices），实现 9-tap 可分离高斯模糊 FBO 两段接力（beforeCamera / beforeStickers 防转场背景透穿帮）、layerIndex 排序与贴纸旋转/圆角/边框/软阴影渲染；接入 renderer.ts 并新增 1 项单测 | 308 pass / 313 total (0 fail, 5 skip E2E)
2026-11-23 04:18 | T14.5 | DONE | 新增 web/passes/chrome.ts（ChromePass + computeChromePassGeometry 覆盖窗口/浏览器/手机竖横屏/平板竖横屏 6 类 3D 透视外框及内嵌 contentVertices 与红黄绿灯/地址栏/灵动岛细节，同步修正 Screen/Spotlight/Cursor 对外框投影基准的适配）与 web/passes/focus.ts（FocusPass FBO 模糊与径向/旋转线性聚焦圈外部暗化混合），完成轻3D/聚拢/侧滑开场序列几何与零 NaN 单测校验（新增 3 项单测） | 311 pass / 316 total (0 fail, 5 skip E2E)
2026-11-23 04:21 | T14.6 | DONE | 全量升级 web/passes/cursor.ts（resolveCursorShape / computeCursorRenderParams / buildCursorShapeTriangles / computeClickShaderUniforms），补齐 arrow/pointingHand/crosshair 光标形态、velocity 倾斜角 rotationRadians、pressScale 按压缩放、闲置/hidden 隐藏与 ripple/glow/pulse/burst 四种点击特效 GLSL 渲染（含 glow 光晕与 8 方位 burst 散射粒）；收官 Wave C 全通道扩展渲染并新增 1 项单测 | 312 pass / 317 total (0 fail, 5 skip E2E)
2026-11-23 04:24 | ARCH-DAG-WaveC | DONE | 刷新 docs/ARCHITECTURE_DAG.json 并通过 cli.py validate --strict 与 render --strict（24 节点 / 35 路径 / 0 警告）重建 docs/WORKFLOW.html（488.6 KB）与 docs/WORKFLOW.md；点亮 M_WebGLFull（✓ 全通道 Pass）、e_plan_glfull、e_glfull_expsrv，同步 Start/G_Verify 312 通过单测计数与 e_verify_review 文案，保持 Wave D-F 与 T11.7 虚化（opacity 0.65） | cli.py --strict 0 warnings
2026-11-23 04:58 | T15.1 | DONE | 新增 src/capture/WindowEnumeration.ts（Per-Monitor V2 DPI 窗口枚举与 BOM/最小化过滤解析），扩展 ScreenRecorder.ts（alignEvenRegion + ddagrab 偶对齐区域与 gdigrab -draw_mouse 0 单窗口采集参数）及 RecordingSession.ts（多屏物理区域/窗口坐标映射与 CaptureSource 联动），新增 4 项单测；同步完成 Chromium 实时 WebGL2 全通道着色器/画布与刷新后 WORKFLOW.html 双重视觉验收 PASS | 316 pass / 321 total (0 fail, 5 skip E2E)
2026-11-23 05:01 | T15.2 | DONE | 新增 tools/wasapi-loopback.ps1（纯内联 C# COM Interop 零第三方依赖 WASAPI 回环 WAV 录制与 RIFF/data 块头闭合）与 src/capture/SystemAudioRecorder.ts（buildWasapiCommand 无 Bypass / parseWasapiHeaderLine / computeAudioOffsetSeconds / startSystemAudioRecording），已实测 Add-Type C# 在 Win PowerShell 5.1 下编译通过（WASAPI_CS_COMPILED=True）并新增 4 项单测 | 320 pass / 325 total (0 fail, 5 skip E2E)
2026-11-23 05:05 | T15.3 | DONE | 新增 src/capture/MediaDevices.ts（兼容 FFmpeg 8.x [in#0] 与传统 [dshow] 节的 DirectShow 设备枚举解析，实机检出 1 摄像头与 9 麦克风含中文设备名）与 src/capture/MicRecorder.ts（buildMicFfmpegArgs / -progress pipe:1 首样本时钟对齐 / startMicRecording 启停与故障拒收），新增 3 项单测 | 323 pass / 328 total (0 fail, 5 skip E2E)
2026-11-23 10:34 | T15.4 | DONE | 新增 src/capture/CameraRecorder.ts（DirectShow dshow 摄像头录制、-vf showinfo 首帧 n:0 时钟锚点、buildCameraSyncAnchor、extractCameraFrames），扩展 RecordingSession.ts 多源音视频录制与 ProjectMediaManifest / CaptureConfiguration 真实标志，ExportServer.ts 开放 /camera_frames/ 安全路径受控静态帧服务，新增 5 项单测 | 328 pass / 333 total (0 fail, 5 skip E2E)
2026-11-23 10:36 | T15.5 | DONE | 新增 src/render/AudioMixPlan.ts（buildAtempoFilterChain 任意倍速 [0.5,2.0] 级联、buildSessionAudioTracks、buildAudioMixFilterGraph atrim/adelay/afade/amix、buildAudioOnlyM4aArgs），扩展 ExportServer.ts 单遍 rawvideo+AAC 音画合流与 scripts/export.ts --format m4a 纯音频直出，并通过真机 ffmpeg 合成双 WAV -> M4A + ffprobe 实测（新增 4 项单测） | 332 pass / 337 total (0 fail, 5 skip E2E)
2026-11-23 10:38 | T15.6 | DONE | 新增 src/capture/SegmentedSession.ts（buildConcatListFileContent / buildLosslessConcatArgs / stitchSegmentedPointerTracks 暂停扣除鼠标轨合流 / LiveRecordingMarkerRecorder 暂停冻结时钟与 Ctrl+Shift+M/F8 热键规范 / concatMediaSegmentsLossless），并通过真机 ffmpeg 双段 MP4 无损拼接 + ffprobe 实测，Wave D 全部收官（新增 4 项单测，core=54 / web=11 零 node:* 且全过 stripTypeScriptTypes） | 336 pass / 341 total (0 fail, 5 skip E2E)
2026-11-23 10:41 | ARCH-DAG-WaveD | DONE | 刷新 docs/ARCHITECTURE_DAG.json 并通过 cli.py validate --strict 与 render --strict（24 节点 / 35 路径 / 0 警告）重建 docs/WORKFLOW.html（489.0 KB）与 docs/WORKFLOW.md；点亮 C_MultiSrc（区域/窗口/摄像头/分段）、C_Audio（WASAPI+Mic）、M_AudioMux（混音+M4A）及对应通路与 336 通过单测计数，保持 M_EditorUI（Wave E）、M_ShellPkg（Wave F）与 H_Review（T11.7）虚化（opacity 0.65） | cli.py --strict 0 warnings
2026-11-23 11:15 | T16.1 | DONE | 新增 src/server/StudioServer.ts（validateRecordingId / resolveExportSpec / 录制列表与明细 / ProjectValidator 强校验原子写入 project.json / 预解码 prepare-frames / 硬件设备枚举 / 后台录制与可取消多规格 MP4·M4A 导出 / 全路径 SafePath + 原始 .. 防护）与 scripts/studio.ts（Edge --app 无地址栏窗口模式启动器），新增 3 项单测 | 339 pass / 344 total (0 fail, 5 skip E2E)
2026-11-23 11:19 | T16.2 | DONE | 新增 web/studio.html、web/studio/styles.css（对齐 macOS Warm Graphite 暗色/柔银浅色双主题、44px 顶栏/监视条与 7 轨家族色）、web/studio/state.ts（不可变 StudioHistory 撤销重做栈与 ProjectValidator 受控编辑器算子）、web/studio/player.ts（全 9 通道 WebGL2 实时预览与 LRU 纹理缓存）及 web/studio/app.ts；core=54/web=14 零 node:* 且全过 stripTypeScriptTypes | 339 pass / 344 total (0 fail, 5 skip E2E)
2026-11-23 11:22 | T16.3 | DONE | 新增 web/studio/timeline.ts（4 轨多色家族时间线：主视频分割/删段/1×-4×倍速与剪刀光标、缩放轨拖拽移动与双边句柄伸缩+双击新建、马赛克/聚光灯区域轨与音频轨，时间标尺刷屏、录制打点 pin 与首帧防抖撤销融合）与 test/render/StudioState.test.ts，全部编辑器算子均通过 ProjectValidator | 343 pass / 348 total (0 fail, 5 skip E2E)
2026-11-23 11:25 | T16.4 | DONE | 新增 web/studio/inspector.ts（画面/运镜/开场/光标/摄像头/声音 6 大标签零假开关实时调节器，含 5 类图案+3 类流动背景、6 类设备外框、4 种点击特效、美颜滑块与马赛克/聚光灯属性）与 web/studio/recorderIsland.ts（Windows 多源显示/窗口/WASAPI/Mic/摄像头录制岛弹窗）；core=54/web=17 全零 node:* 且全过 stripTypeScriptTypes | 343 pass / 348 total (0 fail, 5 skip E2E)

2026-11-23 11:42 | T16.5 | DONE | 完成 web/studio/exportSheet.ts（760px 双栏三阶段交互导出弹窗：MP4/M4A、原始素材/1080p/1440p/4K、30/60fps、H.264/HEVC、3 档画质、ExportPolicy 实时预估体积、进度条/取消/打开目录）与全链路 sourceFps/quality/videoCodec/TimelineMap 对齐（FramePlan/ExportServer/StudioServer/renderer/player/app/scripts/export.ts）；实测 2176x1812@60fps 源导出 --resolution 1080p --fps 30 生成 1920x1598@30fps H.264 MP4（core=54/web=18 全零 node:*） | 344 pass / 349 total (0 fail, 5 skip E2E)

2026-11-23 13:07 | T16.6 | DONE | Chrome 1436x901 四轮 Live Studio E2E 闭环验收通过并修复 BUG-1..4（#studio-stage ResizeObserver 等比贴合与 .monitor-bar 解锁、/favicon.ico 204 + SVG 图标、无音轨 M4A 导出按钮禁用防护、app.ts:138 setInspectorTab TypeError、getRenderedScreenContentRect 内嵌内容区 0.63px 精确靶心投影）；Studio 修改（圆角 48/流体背景/windowLight/1080p30 HEVC）持久化并通过 60 帧 CLI 再导出（ffprobe: hevc 1920x1598@30fps, 60f, 8.48s）；存档 docs/audits/T16.6-studio-audit-report.json（Pass 4 控制台 0 报错/HTTP>=400 为 0）；基线 verify-export 非 --sync 通过（--sync 在 2026-11-20 历史会话呈预期 T12.9 前 24 帧漂移，待 Wave F T17.3 实机重录验收） | 344 pass / 349 total (0 fail, 5 skip E2E)

2026-11-23 13:09 | ARCH-DAG-WaveE | DONE | 刷新 docs/ARCHITECTURE_DAG.json（dogsc-win-v0.5.0）并通过 cli.py validate --strict 与 render --strict 重建 docs/WORKFLOW.html 与 docs/WORKFLOW.md；点亮 M_EditorUI（✓ Studio E2E 通过）与 e_expsrv_editor，刷新 Start/M_AudioMux/G_Verify/Deliver 状态，保持 M_ShellPkg 与 H_Review 虚化（opacity 0.65） | cli.py --strict 0 warnings

2026-11-23 13:18 | T17.1 | DONE | 新增 src/desktop/DesktopBuilder.ts（零依赖双分辨率 32/64 PNG-in-ICO 图标生成、csc.exe/iexpress 定位与构建参数）、desktop/DogSC.cs（严格 C# 5 单实例 WinForms 托盘 + RegisterHotKey Ctrl+Alt+Shift+S/R/M + --version/--check/--install/--uninstall + StudioServer/Edge --app 无栏工作台）、desktop/assets/dogsc.ico、scripts/build-desktop.ts 与 test/desktop/DesktopShell.test.ts；web/studio/app.ts 支持 ?action=record 直达录制岛；实测编译 dist/DogSC.exe (26,112B) 并通过 --version / --check 全绿；core=54/web=18 全零 node:* | 347 pass / 352 total (0 fail, 5 skip E2E)

2026-11-23 13:21 | T17.2 | DONE | 新增 scripts/package-windows.ts 与 test/desktop/PackageWindows.test.ts，更新 THIRD_PARTY_NOTICES.md 与 package.json（studio/build:desktop/package:win）；实测打包 109 项干净运行时产物并生成 dist/DogSC.exe (26,112B)、DogSC-Windows-x64-v1.0.0.zip (384,204B)、iexpress Setup DogSC-Setup-x64-v1.0.0.exe (577,536B) 与 dist/SHA256SUMS.txt；完整标注未代码签名状态及 FFmpeg/Node/Edge 非捆绑合规声明；core=54/web=18 全零 node:* | 350 pass / 355 total (0 fail, 5 skip E2E)

2026-11-23 13:30 | T17.3 | DONE | 新增 scripts/run-device-matrix.ts 并输出严谨区分 VERIFIED/UNTESTED 的 docs/DEVICE_MATRIX_REPORT.md：在 Win11 Build 26200 (i7-13700HX / 16GB / RTX 4060 Laptop) 实测通过显示器(1)/摄像头(1)/麦克风(9)枚举、--display 9 越界零残留、1080p60/1440p30/4K30(3840x3198)/HEVC WebGL2+NVENC 导出、libx264/libx265 软编、AAC M4A 混音与 DogSC.exe --check (13项 VERIFIED)；并如实标注后台锁定桌面会话下 ddagrab access denied/windowCount=0、Win10、AMD/Intel、物理多屏与 D4 T11.7 待交互复核为 UNTESTED | 350 pass / 355 total

下一个任务：T17.4 版本号升级 v1.0.0、最终 README/USAGE/CHANGELOG 归档、ARCH-DAG-WaveF Chrome 终审与打标 v1.0.0-windows





