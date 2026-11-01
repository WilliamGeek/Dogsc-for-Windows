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

下一个任务：T3.2
