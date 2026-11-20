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
2026-11-20 17:16 | T12.6 | DONE | ProjectMediaModel 删除重复 CaptureConfiguration 与英文假默认值，改为导入统一中文 rawValue 模型；decodeRecorderProject 兼容旧英文 source/codec/resolution/systemAudioScope 并归一化 frameRate；buildProjectFromRecording 接收真实 captureOptions，recordSession 写入 source/displayID/displayName/真实 fps/H.264/三项音频与摄像头 false。真实 30fps 录制 20261120-171556 的 project.capture 为 30fps/H.264/recordsSystemAudio=false/displayID=0；默认测试 224 pass/5 skip | 224 pass (5 skip 默认)

2026-11-20 17:43 | T12.7 | DONE | ScreenRecorder 解析 `-progress pipe:1` 的 frame/out_time_us 生成 ready 与 firstFrameUnixMs；RecordingSession 等首帧后再计时并把 spawn/firstFrame 写入 meta；calibrate 增加严格双点击 evaluateCalibration；新增 tools/e2e-testcard.html、scripts/verify-export.ts 与 VerifyExport 单测。真实 8.6s 测试卡录制 20261120-173816：两个点击视频时刻 1.935s/4.182s，导出 517 帧/8.616s；verify-export 全部通过（时长差 0.000s、帧数一致、captureFrameRate 60、无音频声明、点击帧非黑可读）。默认 226 pass/5 skip；E2E 236/236。已知：导出画面顶部未出现测试卡 48px 闪帧条，闪帧≤1帧尚未通过自动/视觉门禁 | 236 pass (E2E 全绿)

2026-11-20 18:20 | T12.8 | DONE | `SafePath` 以 `path.relative` 替换 DevServer/ExportServer 的 `startsWith`，同名前缀兄弟目录返回 403；补根 README / MIT LICENSE / THIRD_PARTY_NOTICES；package 0.3.1 / Node >=22.18；PLAN 修正 53 文件/14,380 行。修 T12.7 闪帧验收缺陷：自动运镜会裁掉顶部 48px 条，测试卡改为点击目标整圆同步闪绿，`verify-export --sync` 对源/导出 green run 做 onset ≤1 帧校验；导出总超时从 500ms/帧提高到 1.5s/帧。真实录制 20261120-175917：2176x1812/60fps/568 帧/9.466s，点击 2.620s/5.006s，导出 568 帧/9.466s/3,681,926B，`verify-export --sync` 退出 0（时长差 0.000s、帧数 568/568、captureFrameRate 60、recordsSystemAudio false、闪帧 source/export onset 均 143/286 帧、maxDelta 0）。T11.7 仍按 D4 等用户肉眼复核，未勾选 | 默认 247 项 (242 pass / 5 skip)；E2E 247/247

阶段 2 验收通过

下一个任务：T12.8（Wave A 第八卡：路径穿越安全修复、合规许可证与文档基线收官，并执行 Wave A 出口 G1+G2 真实闭环，详见 docs/MASTER_REFACTOR_PLAN_V2.md §4）

