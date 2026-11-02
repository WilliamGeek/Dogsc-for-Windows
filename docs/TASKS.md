# TASKS.md â€” é˜¶æ®µ 1 ä»»åŠ¡å¡ï¼ˆä¸€å¡ = ä¸€æ¬¡æäº¤ï¼‰

é€šç”¨å®Œæˆæ¡ä»¶ï¼ˆæ¯å¼ å¡éƒ½é€‚ç”¨ï¼Œå¡å†…ä¸å†é‡å¤ï¼‰ï¼š
1. ç›®æ ‡ `.ts` å·²æŒ‰ `PORTING_RULES.md` å†™å®Œï¼ŒSwift æºæ–‡ä»¶ä¸­**æ¯ä¸€ä¸ª**ç±»å‹/å‡½æ•°éƒ½æœ‰å¯¹åº”å®ç°ï¼ˆprivate çš„ä¹Ÿè¦ï¼Œç”¨äºå†…éƒ¨è°ƒç”¨ï¼›å¯ä¸å¯¼å‡ºï¼‰ã€‚
2. å¯¹åº”æµ‹è¯•æ–‡ä»¶å­˜åœ¨ï¼Œè¦†ç›– PORTING_RULES Â§6 + æœ¬å¡ã€Œå¿…æµ‹ã€ã€‚
3. `npm test` å…¨ç»¿ã€‚
4. å‹¾é€‰æœ¬å¡ã€è¿½åŠ  PROGRESS.mdã€git commitã€‚

> ã€Œåˆ†æ®µã€= å…ˆç”¨ AGENTS.md Â§3 çš„å‘½ä»¤åˆ—å‡ºé¡¶å±‚å£°æ˜è¡Œå·ï¼ŒæŒ‰å£°æ˜è¾¹ç•ŒæŠŠæ–‡ä»¶åˆ‡æˆ â‰¤500 è¡Œçš„æ®µï¼Œä¸€æ®µä¸€æ®µåœ°è¯»å’Œå†™ï¼ˆå†™å…¥åŒä¸€ä¸ª `.ts` æ–‡ä»¶ï¼‰ã€‚æ¯æ®µå†™å®Œéƒ½è·‘ä¸€æ¬¡ `npm test`ã€‚

---
## B0 è„šæ‰‹æ¶ï¼ˆå·²å®Œæˆï¼‰
- [x] T0.1 `package.json`ã€`src/core/swift.ts`ã€æµ‹è¯•æ¡†æ¶
- [x] T0.2 èŒƒä¾‹ï¼š`ElementMotion` `MediaTimeRange` `HexColor` `PointerEventTimelineOrdering`

## B1 å¶å­æ–‡ä»¶
- [x] T1.1 `RecordingMarker.swift`(15) `ExportSettings.swift`(19) â†’ ä¸¤ä¸ªåŒå `.ts`
- [x] T1.2 `BoundedMemoizationCache.swift`(86) â†’ TS `class`ï¼Œåˆ é™¤é”ã€‚å¿…æµ‹ï¼šå®¹é‡æ·˜æ±°é¡ºåºï¼›`valueIfBuilt` æ„å»ºå‡½æ•°è¿”å› `null`ï¼ˆè¢«å–æ¶ˆï¼‰æ—¶ä¸å†™å…¥ç¼“å­˜ã€‚
- [x] T1.3 `CanvasCustomAspectRatio.swift`(32)ã€`TimelineTrackOrdering.swift`(55)ã€`PointerTimelineAlignment.swift`(56)ã€‚è‹¥éœ€è¦ `CanvasStyle` çš„å€¼ â†’ æŒ‰ PORTING_RULES Â§7 å…ˆåš B2ã€‚
- [x] T1.4 `OutputFrameSchedule.swift`(96)ã€‚å¿…æµ‹ï¼š60fps ä¸‹ç¬¬ n å¸§æ—¶é—´ = n/60ï¼›æ—¶é•¿è¾¹ç•Œå¸§æ•°ã€‚

## B2 å·¥ç¨‹æ•°æ®æ¨¡å‹
- [x] T2.1 `ProjectModel.swift` ç¬¬ 1 æ®µï¼ˆæ–‡ä»¶å¼€å¤´ â†’ `CursorAssetID` ä¹‹å‰ï¼‰â†’ `ProjectModel.ts`ã€‚åˆ†æ®µã€‚
- [x] T2.2 `ProjectModel.swift` ç¬¬ 2 æ®µï¼ˆ`CursorAssetID` â†’ `CanvasStyle` ç»“æŸï¼‰ã€‚
- [x] T2.3 `ProjectModel.swift` ç¬¬ 3 æ®µï¼ˆå‰©ä½™ï¼Œå« `AudioStyle` `CameraStyle` `MotionStyle`ï¼‰ã€‚å¿…æµ‹ï¼š`makeMotionStyle()` é»˜è®¤å€¼ = å±å¹•å¼¹ç°§ 2.4/210/42ã€å…‰æ ‡å¼¹ç°§ 2.8/450/66ï¼ˆSwift L1267â€“1272ï¼‰ã€‚
- [x] T2.4 `ScreenFrameDefaults.swift`(56)ã€`HexColor` å·²æœ‰ï¼Œæ£€æŸ¥ `ProjectModel.ts` ä¸­å¼•ç”¨ HexColor å¤„æ”¹ä¸º importã€‚

## B3 ç¼©æ”¾åŠ¨ç”»
- [x] T3.1 `ZoomAnimation.swift` L1â€“L300ï¼ˆ`NormalizedPoint` â€¦ `ZoomAnimationClip`ï¼‰â†’ `ZoomAnimation.ts`ã€‚å¿…æµ‹ï¼š
  - `NormalizedPoint.constrained(0.12)`ï¼š(0,1) â†’ (0.12,0.88)ã€‚
  - `ZoomBezierCurve.value`ï¼š`linear` åœ¨ 0.3 å¤„ = 0.3ï¼ˆè¯¯å·®<1e-4ï¼‰ï¼›å››ä¸ªé¢„è®¾åœ¨ t=0/1 ç²¾ç¡®ä¸º 0/1ï¼›`quadratic/cubic/quintic` åœ¨ [0,1] ä¸Šå•è°ƒä¸å‡ï¼ˆé‡‡æ · 101 ç‚¹ï¼‰ã€‚
  - `ZoomAnimationClip` æ„é€ ï¼š`scale` < 1 è¢«æåˆ° 1ï¼›`enterDuration` 9 â†’ 5ï¼›`endTime < startTime` â†’ ç­‰äº startTimeã€‚
- [x] T3.2 `ZoomAnimation.swift` L300â€“L943ï¼ˆ`ZoomKeyframe`ã€`ZoomViewportTransform`ã€`ZoomAnimationTrack`ã€`ZoomInterpolator`ã€ç¼“å­˜ç±»ï¼‰ã€‚å¿…æµ‹ï¼š
  - `springProgress(t, 2.4, 210, 42)`ï¼št=0 â†’ 0ï¼Œt=1 â†’ 1ï¼ˆç²¾ç¡®ï¼‰ï¼Œtâˆˆ(0,1) ç»“æœåœ¨ [0,1]ã€‚
  - `ZoomInterpolator.sample` åœ¨æ— åŠ¨ç”»æ—¶ scale=1ã€focus=(0.5,0.5)ã€‚
- [x] T3.3 `FocusEffect.swift`(118)ã€`ZoomTransitionResolution.swift`(54)ã€‚

## B4 è‡ªåŠ¨è¿é•œ + å…‰æ ‡ï¼ˆæ ¸å¿ƒï¼‰
- [x] T4.1 `AutoZoomPlanner.swift`(651) â†’ `AutoZoomPlanner.ts`ã€‚é‡è½½æ”¹åï¼š`makeAnimationsFromPointerEvents` / `makeAnimationsFromClicks`ã€`clippedAnimations` / `clippedKeyframes`ã€`makeKeyframesFromPointerEvents` / `makeKeyframesFromClicks`ã€‚å¿…æµ‹ï¼š
  - ä¸¤æ¬¡ç‚¹å‡» t=1.0/1.5ã€ä½ç½® (0.5,0.5)/(0.52,0.5) â†’ 1 ä¸ª clipï¼›`startTime = 1.0 âˆ’ 0.7Ã—0.18 = 0.874`ã€‚
  - ä¸¤æ¬¡ç‚¹å‡»ç›¸éš” 3s â†’ 2 ä¸ª clipï¼Œç¬¬äºŒä¸ª `startTime â‰¥` ç¬¬ä¸€ä¸ª `effectEndTime`ã€‚
  - ç‚¹å‡»ä½ç½® (0.01,0.99) â†’ focus = (0.12,0.88)ã€‚
  - å•æ¬¡å·¦é”®ç‚¹å‡» t=0ã€ä½ç½® (0.5,0.5)ï¼Œä¹‹å t=0.1,0.2,â€¦,1.0 æ¯ 0.1s ä¸€ä¸ª move äº‹ä»¶ â†’ å”¯ä¸€ clip çš„ `endTime = max(0+0.9, 1.0+0.55) = 1.55`ï¼ˆæ´»åŠ¨å»¶é•¿ L245â€“305ï¼‰ã€‚
  - ç©ºè¾“å…¥ â†’ `[]`ã€‚
- [x] T4.2 `PointerTrack.swift` L1â€“L460ï¼ˆå« `makeSpringSamples`ï¼‰ã€‚åˆ†æ®µã€‚
- [x] T4.3 `PointerTrack.swift` L460â€“L894ï¼ˆç‚¹å‡»é”šå®š `anchoringClicks`ã€`smootherStep`ã€`PointerInterpolator`ï¼‰ã€‚å¿…æµ‹ï¼š
  - `motion.cursor = 'smooth'`ï¼ˆå– Swift ä¸­å¯¹åº” rawValueï¼‰æ—¶ï¼Œåœ¨å·¦é”®ç‚¹å‡»æ—¶åˆ»çš„ `samplePosition` ä¸ç‚¹å‡»åæ ‡è¯¯å·® < 1e-6ã€‚
  - `time <` ç¬¬ä¸€ä¸ªäº‹ä»¶æ—¶é—´ â†’ `position === null`ã€‚
  - `style.assetID` ä¸º hidden æ—¶ `cursor === null` ä½† `position !== null`ã€‚
- [x] T4.4 `CursorRenderGeometry.swift`(358)ã€‚

## B5 3D æŠ•å½±ä¸æ„å›¾
- [x] T5.1 `CompositionScene.swift` ä¸­çš„ `CompositionRect` `CompositionPoint` å…ˆç§»æ¤ï¼ˆå…¶ä½™éƒ¨åˆ†åœ¨ T5.5ï¼‰ã€‚
- [x] T5.2 `ScreenProjection.swift`(360)ã€‚å¿…æµ‹ï¼š
  - æ—‹è½¬å…¨ 0 â†’ quad å››è§’ = rect å››è§’ï¼ˆè¯¯å·®<1e-9ï¼‰ã€‚
  - `perspective = 0`ï¼ŒrotationY=30 â†’ æŠ•å½±ç»“æœä¸ºå¹³è¡Œå››è¾¹å½¢ï¼ˆTLâ†’TR å‘é‡ = BLâ†’BR å‘é‡ï¼‰ã€‚
  - rotationX=20, rotationY=-25, perspective=1ï¼šå¯¹ rect å†… 5 ä¸ªç‚¹ `unproject(project(p))` ä¸ p è¯¯å·® < 1e-6ã€‚
  - `contains(quad.center) === true`ï¼›è¿œå¤„ç‚¹ `false`ï¼›NaN ç‚¹ `false`ã€‚
- [x] T5.3 `ScreenMotion.swift`(611)ã€`ScreenMotionCreationStyle.swift`(45)ã€‚
- [x] T5.4 `CameraMotion.swift`(423)ã€`CameraContentFill.swift`(110)ã€‚
- [x] T5.5 `CompositionScene.swift` å‰©ä½™éƒ¨åˆ†ï¼ˆ`CompositionSceneEvaluator` ç­‰ï¼‰ã€‚

## B6 å¸§åœºæ™¯
- [x] T6.1 `OverlayTimeline.swift`(393)ã€‚
- [x] T6.2 `StickerTransition.swift`(266)ã€‚
- [x] T6.3 `FrameScene.swift` L1â€“L540ï¼ˆæ‰€æœ‰æ•°æ®ç»“æ„ï¼‰ã€‚
- [x] T6.4 `FrameScene.swift` L540â€“L1284ï¼ˆ`FrameSceneEvaluator`ï¼‰ã€‚å¿…æµ‹ï¼šåŒä¸€è¾“å…¥è°ƒç”¨ä¸¤æ¬¡ `deepEqual`ï¼›`refreshingCursor` åªæ”¹å˜ cursor å­—æ®µã€‚

## B7 æ—¶é—´çº¿ä¸å·¥ç¨‹
- [x] T7.1 `MediaTimeline.swift`(121)ã€`ProjectTimeline.swift`(312)
- [x] T7.2 `TimelineMap.swift`(305)ã€`TimelineMediaPlan.swift`(375)
- [x] T7.3 `ProjectMediaModel.swift`(410)ã€`ProjectPointerTrack.swift`(469)
- [x] T7.4 `ProjectValidator.swift`(210)ã€`ExportPolicy.swift`(68)ã€`CaptureConfiguration.swift`(492)
- [x] T7.5 `ProjectTimelineRetime.swift`(215)
- [x] T7.6 `ProjectTimelineEditing.swift`(935) åˆ† 2 æ®µ
- [x] T7.7 `ProjectTimelineEditingTransforms.swift`(1168) åˆ† 3 æ®µï¼ˆSwift `extension` å†™è¿›åŒä¸€ä¸ª `ProjectTimelineEditing` å‘½åç©ºé—´ï¼šåœ¨ `ProjectTimelineEditingTransforms.ts` ä¸­å¯¼å‡ºå‡½æ•°ï¼Œå†ç”± `ProjectTimelineEditing.ts` re-exportï¼‰
- [x] T7.8 `EditorTimeline.swift`(938) åˆ† 2 æ®µ

## B8 å¯é€‰
- [x] T8.1 `AudioCaptureDiagnostics` `CameraCaptureDiagnostics` `RecordingPerformanceDiagnostics`

## é˜¶æ®µ 1 æ”¶å°¾
- [x] T9.1 æ–°å¢ `test/core/pipeline.test.ts`ï¼šæ„é€  3 æ¬¡ç‚¹å‡»çš„ pointer äº‹ä»¶ â†’ `AutoZoomPlanner` â†’ æ„é€ å·¥ç¨‹ â†’ `FrameSceneEvaluator.scene` åœ¨ t=0ã€ç‚¹å‡»æ—¶åˆ»ã€æœ«å°¾ä¸‰ä¸ªæ—¶é—´ç‚¹æ±‚å€¼ï¼Œæ–­è¨€ä¸å« NaNï¼ˆé€’å½’æ£€æŸ¥æ‰€æœ‰æ•°å­—å­—æ®µï¼‰ã€‚
- [x] T9.2 åœ¨ PROGRESS.md å†™ã€Œé˜¶æ®µ 1 å®Œæˆã€ï¼Œ**åœæ­¢**ï¼Œç­‰å¾…ç”¨æˆ·ç¡®è®¤é˜¶æ®µ 2 æ–¹æ¡ˆã€‚


---
# ½×¶Î 2~5 ÈÎÎñ¿¨£¨¸ß½× AI ÓÚ 2026-11-02 ¹æ»®£»ÆõÔ¼¼û `docs/CONTRACTS.md`£¬¿ª¹¤Ç°±Ø¶Á£©

Í¨ÓÃ²¹³ä£¨½×¶Î 2 ÆğÊÊÓÃ£©£º
- Ã¿ÕÅ¿¨Ö»¸Ä¿¨ÄÚÁĞ³öµÄÎÄ¼ş£»ĞÂÔöÎÄ¼ş±ØĞëÔÚ¿¨ÄÚÁĞ³ö¡£
- Ã¿ÕÅ¿¨Íê³ÉÌõ¼şÈÔÊÇ AGENTS.md ¡ì0 µÄ 8 ²½¡£²âÊÔÎÄ¼ş·Å `test/<Ä¿Â¼>/`£¬ÓëÔ´ÎÄ¼şÍ¬Ãû¼Ó `.test.ts`¡£
- ¿¨ÄÚ¡¸º¯ÊıÇ©Ãû¡¹ÊÇ**Ó²Ô¼¶¨**£¬Ãû×Ö/²ÎÊıË³Ğò²»µÃ¸Ä¡£
- Óöµ½¿¨ÄÚÃ»Ğ´µÄ¾ö²ß£º²»Òª²Â£¬Ğ´ `NEED-DECISION` ²¢Í£Ö¹¡£

## ½×¶Î 2 ²É¼¯£¨B10£©
- [ ] T10.1 `src/capture/PointerJsonl.ts` + `test/capture/PointerJsonl.test.ts`
  - Ç©Ãû£º`export function parsePointerJsonl(text: string): { originUnixMs: number; screen: {x:number;y:number;w:number;h:number}; events: PointerEventRecord[] }`
  - `PointerEventRecord` ÓÃ `makePointerEventRecord({time, location: makeNormalizedPoint(nx,ny), kind})`£¨¼û `src/core/ZoomAnimation.ts`£©¡£
  - ¹æÔòÑÏ¸ñ°´ CONTRACTS ¡ì2¡£ÎŞ±íÍ· ¡ú `throw new Error('pointer.jsonl È±ÉÙ±íÍ·')`¡£
  - ±Ø²â£º¢ÙÕı³£ 3 ĞĞ£¨º¬ 1 ´Î leftClick£©£»¢Ú»µĞĞ/¿ÕĞĞ/Î´Öª k ±»ºöÂÔ£»¢Û×ø±êÔ½½ç±»¼Ğµ½ [0,1]£»¢ÜÂÒĞò t ±»ÎÈ¶¨ÅÅĞò£»¢İscreen Æ«ÒÆ£¨x=1920,w=1920£©¹éÒ»»¯ÕıÈ·£»¢ŞÎŞ±íÍ·Å×´í¡£
- [ ] T10.2 `tools/mousehook.ps1`£¨PowerShell 5.1 + `Add-Type` ÄÚÇ¶ C#£©+ `src/capture/MouseHook.ts` + `test/capture/MouseHook.test.ts`
  - ps1£ºC# Àï `SetWindowsHookEx(WH_MOUSE_LL=14,...)`£¬ÏûÏ¢Ñ­»·ÓÃ `Application.Run()`£¨`Add-Type -AssemblyName System.Windows.Forms`£©£»`Stopwatch` ¼ÆÊ±£»`WM_MOUSEMOVE(0x200)¡úmove`¡¢`WM_LBUTTONDOWN(0x201)¡úleftClick`¡¢`WM_RBUTTONDOWN(0x204)¡úrightClick`£¬ÆäÓà¶ªÆú£»move ÊÂ¼ş½ÚÁ÷µ½ ¡İ4ms Ò»Ìõ£»Ã¿ĞĞÁ¢¼´ `Console.Out.Flush()`¡£±íÍ·°´ CONTRACTS ¡ì2£¨screen ÓÃ `[System.Windows.Forms.Screen]::PrimaryScreen.Bounds`£»Èô½ø³Ì·Ç DPI ¸ĞÖª£¬ĞèÔÚ C# ÖĞµ÷ÓÃ `SetProcessDPIAware()` ÒÔÄÃµ½ÕæÊµÏñËØ£©¡£
  - ÍË³ö£ºstdin ¶Áµ½Ò»ĞĞ `q` »ò stdin ¹Ø±Õ ¡ú `Application.Exit()`¡¢Ğ¶ÔØ¹³×Ó¡£
  - MouseHook.ts£º`export function startMouseHook(): { process: ChildProcess; lines: AsyncIterable<string>; stop(): Promise<void> }`£»ÓÃ `child_process.spawn('powershell.exe',['-NoProfile','-File', <abs path>])`£¬**²»µÃ**¼Ó ExecutionPolicy ²ÎÊı¡£`stop()` Ğ´ `q\n`£¬2 ÃëÎ´ÍË³öÔò `kill()`¡£
  - ±Ø²â£¨ÓÃ `{ skip: !process.env.DOGSC_E2E }` °ü×¡ÕæÊµ½ø³Ì²¿·Ö£©£ºÆô¶¯ºó 3 ÃëÄÚ¶Áµ½±íÍ·ĞĞÇÒ `JSON.parse` ³É¹¦ÇÒº¬ `hdr/originUnixMs/screen`£»`stop()` ºó½ø³ÌÒÑÍË³ö¡£ÔÙĞ´Ò»¸ö**²»ĞèÒªÕæÊµ½ø³Ì**µÄ²âÊÔ£º¶Ô `startMouseHook` µÄ²ÎÊı¹¹Ôì²¿·Ö³é³É´¿º¯Êı `buildMouseHookCommand(): {command:string;args:string[]}` ²¢¶ÏÑÔ args ²»º¬ `Bypass`¡£
  - Èô `-File` ±»Ö´ĞĞ²ßÂÔ¾Ü¾ø£¨µ±Ç°»úÆ÷Îª RemoteSigned£¬±¾µØ½Å±¾Ó¦¿ÉÔËĞĞ£©£º`BLOCKED`£¬Ñ¯ÎÊÓÃ»§£¬**²»Òª**ÈÆ¹ı¡£
- [ ] T10.3 `src/capture/ScreenRecorder.ts` + `test/capture/ScreenRecorder.test.ts`
  - ´¿º¯Êı£º`export function buildFfmpegArgs(o: { outFile: string; fps: number; encoder: 'h264_nvenc'|'libx264'; outputIdx?: number }): string[]`
    - ÆÚÍû£¨nvenc£©£º`['-y','-f','lavfi','-i',`ddagrab=output_idx=${idx}:framerate=${fps}`,'-c:v','h264_nvenc','-preset','p4','-rc','vbr','-cq','23','-b:v','0','-pix_fmt','yuv420p','-r',String(fps),'-fps_mode','cfr',outFile]`£»ddagrab Êä³öÊÇ D3D11 Ö¡£¬×ª yuv420p Ğè `-vf hwdownload,format=bgra,format=yuv420p`£¬²åÔÚ `-c:v` Ç°£¨nvenc Óë libx264 ¶¼ÓÃ£©¡£ÒÔÊµ¼ÊÄÜÅÜÍ¨Îª×¼£¬ÅÜÍ¨ºó°Ñ×îÖÕ²ÎÊıĞ´»Ø±¾¿¨×¢ÊÍÓë²âÊÔÆÚÍû£¨µ¥¶ÀÒ»´ÎÌá½»ËµÃ÷Ô­Òò£©¡£
  - `export async function detectEncoder(): Promise<'h264_nvenc'|'libx264'>`£ºÖ´ĞĞ `ffmpeg -hide_banner -encoders`£¬Êä³öº¬ `h264_nvenc` ÔòÓÃÖ®£¨²»×öÊµ»ú±àÂëÌ½²â£©¡£
  - `export function startScreenRecording(o): { screenStartUnixMs:number; stop(): Promise<void> }`£º`Date.now()` ÔÚ spawn Ö®Ç°È¡£»`stop()` Íù stdin Ğ´ `q`£¬5 Ãë²»ÍË³öÔò kill¡£
  - ±Ø²â£ºbuildFfmpegArgs Á½ÖÖ encoder µÄ¶ÏÑÔ£»`detectEncoder` ·µ»ØÖµÊôÓÚÁ½ÕßÖ®Ò»¡£E2E£¨`DOGSC_E2E`£©£ºÂ¼ 2 Ãë£¬`ffprobe -v error -show_entries format=duration -of csv=p=0` Ê±³¤ÔÚ 1.5~3.5 Ãë¡£
- [ ] T10.4 `src/capture/RecordingSession.ts` + `test/capture/RecordingSession.test.ts`
  - ´¿º¯Êı£¨¿É²â£©£º`export function buildMeta(i:{id:string;fps:number;width:number;height:number;screenStartUnixMs:number;pointerOriginUnixMs:number;encoder:string;durationSeconds:number}): object`£¨º¬ `pointerOffsetSeconds`£¬¼û CONTRACTS ¡ì3£©¡£
  - ´¿º¯Êı£º`export function buildProjectFromRecording(events: PointerEventRecord[], offsetSeconds: number, durationSeconds: number): RecorderProject`£ºÊÂ¼şÊ±¼ä¼Ó offset ¡ú `makeAnimationsFromPointerEvents` ¡ú `makeRecorderProject({zoomAnimations, timeline: makeProjectTimeline({zoomClips})})`¡£
  - `export async function recordSession(o:{seconds:number; fps?:number; baseDir?:string}): Promise<string>`£¨·µ»ØÂ¼ÖÆÄ¿Â¼£©£ºÏÈÆô¶¯¹³×Ó²¢µÈ±íÍ·£¬ÔÙÆô¶¯Â¼ÆÁ£¬µÈ `seconds`£¬ÏÈÍ£Â¼ÆÁÔÙÍ£¹³×Ó£¬Ğ´ meta.json / project.json£¨`encodeRecorderProject`£©¡£
  - ±Ø²â£ºbuildMeta µÄ offset ¼ÆËã£»buildProjectFromRecording 3 ´Îµã»÷ ¡ú 3 ¸ö zoomAnimations ÇÒ `ProjectValidator.validate` ²»Å×´í£»offset Ê¹ËùÓĞÊÂ¼şÊ±¼ä +offset¡£
- [ ] T10.5 `scripts/record.ts`£¨CLI£©+ `docs/USAGE.md`
  - `node scripts/record.ts --seconds 10 [--fps 60]`£¬½áÊøÊ±´òÓ¡Â¼ÖÆÄ¿Â¼¡£USAGE.md Ğ´Ê¹ÓÃ·½·¨Óë¡¸ÊÖ¶¯ÑéÊÕÇåµ¥¡¹£¨¼û T10.6£©¡£
- [ ] T10.6 ½×¶Î 2 ÊÖ¶¯ÑéÊÕÓëĞ£×¼£¨**ĞèÒªÓÃ»§ÔÚ³¡²Ù×÷**£©
  - Agent ÏÈĞ´ºÃ `scripts/calibrate.ts`£ºÂ¼ 6 Ãë£¬ÆÁÄ»ÉÏÎŞĞèÈÎºÎ¶«Î÷£¬½öÌáÊ¾ÓÃ»§¡¸ÔÚµÚ 2¡¢4 Ãë¸÷µã»÷Ò»´ÎÆÁÄ»ÈÎÒâÎ»ÖÃ¡¹£¬½áÊøºó´òÓ¡ `pointer.jsonl` ÖĞµÄµã»÷Ê±¼äÓë `meta.json` µÄ offset¡£
  - ÓÃ»§ÊÖ¶¯ÑéÊÕ£º¢Ù`screen.mp4` ¿É²¥·Å ¢Ú`pointer.jsonl` ÀïÓĞµã»÷ĞĞ ¢Ûµã»÷×ø±ê´óÖÂÕıÈ·¡£°Ñ½á¹ûĞ´½ø PROGRESS.md£¬È»ºó**Í£Ö¹**£¬µÈÓÃ»§È·ÈÏ½øÈë½×¶Î 3¡£

## ½×¶Î 3 äÖÈ¾Óëµ¼³ö£¨B11£©¡ª¡ª¿ª¹¤Ç°Ğè¸ß½× AI ¸´ºË CONTRACTS ¡ì4
- [ ] T11.1 `src/server/DevServer.ts` + ²âÊÔ£º`export function startDevServer(o:{rootDir:string; port?:number}): Promise<{port:number; close():Promise<void>}>`£»¾²Ì¬ÎÄ¼ş + `.ts`¡úJS£¨CONTRACTS ¡ì4£©£»`port` È±Ê¡È¡ 0£¨Ëæ»ú£©¡£±Ø²â£ºGET `/src/core/swift.ts` ·µ»Ø 200¡¢`content-type` º¬ `javascript`¡¢ÕıÎÄ²»º¬ `: number` ÕâÀàÀàĞÍ±ê×¢£¨ÓÃ `export function clamp(` ¸½½ü¶ÏÑÔ¼´¿É£©£»Â·¾¶´©Ô½ `/../package.json` ·µ»Ø 403/404¡£
- [ ] T11.2 `src/render/FramePlan.ts` + ²âÊÔ£º`export function makeFramePlan(i:{project:RecorderProject; pointerEvents:PointerEventRecord[]; fps:number; durationSeconds:number; sourceFrameCount:number; canvas:{width:number;height:number}}): { frameCount:number; frameAt(n:number): { scene: FrameScene; sourceFrameFile: number } }`¡£ÑÏ¸ñ°´ CONTRACTS ¡ì4 µÄÓ³Éä¡£±Ø²â£ºn=0 µÄ sourceFrameFile=1£»Ä©Ö¡²»Ô½½ç£»Í¬Ò» n Á½´Î `deepEqual`£»Õû¶ÎËùÓĞ scene ÎŞ NaN£¨¸´ÓÃ `assertNoNaN` Ğ´·¨£¬¼û `test/core/pipeline.test.ts`£©¡£
- [ ] T11.3 `src/capture/FrameExtractor.ts` + ²âÊÔ£º`extractFrames(i:{video:string; outDir:string; fps:number}): Promise<number>` µ÷ÓÃ ffmpeg Ô¤½âÂë£¬·µ»ØÖ¡Êı£»´¿º¯Êı `buildExtractArgs` µ¥²â£»E2E ÓÃ `DOGSC_E2E`¡£
- [ ] T11.4 `web/render.html` + `web/renderer.ts`£º×îĞ¡ WebGL2 äÖÈ¾¡ª¡ªÇåÆÁÎª±³¾°É«¡¢°ÑÆÁÄ»Ö¡ JPEG ×÷ÎªÎÆÀí»­³É `scene.screen.projectedQuad` µÄËÄ±ßĞÎ£¨Á½¸öÈı½ÇĞÎ£¬Í¸ÊÓĞ£ÕıÓÃÆë´Î×ø±ê£¬²Î¿¼ `ScreenProjection.ts`£©¡£Ò³Ãæ¶Á URL `?mode=preview&frame=N` äÖÈ¾µ¥Ö¡¡£ÑéÊÕ£ºEdge ÃüÁîĞĞ `--headless=new --screenshot=out/t114.png --window-size=1920,1080 http://127.0.0.1:<port>/web/render.html?...` Éú³É·Ç¿Õ PNG£¨>10KB£©¡£
- [ ] T11.5 äÖÈ¾ÔöÇ¿£¨Ò»¸öĞ§¹ûÒ»´ÎÌá½»£¬¿É²ğ T11.5a~e£©£ºa Ô²½Ç+±ß¿ò£»b ÒõÓ°£»c ±³¾°£¨´¿É«/½¥±ä£¬¶Á `scene.background`£©£»d ¹â±ê£¨»­ `scene.cursor.layout`£¬ÏÈÓÃ¼òµ¥¼ıÍ·¶à±ßĞÎ£¬²»¼ÓÔØËØ²Ä£©+ µã»÷Á°äô£»e ÉãÏñÍ·/ÌùÖ½**Ìø¹ı**£¨½×¶Î 3 ²»×ö£©¡£
- [ ] T11.6 µ¼³ö£º`src/server/ExportServer.ts`£¨`/api/plan`¡¢`/api/frame/:n`¡¢`/api/done`£¬ÑÏ¸ñµİÔöË³Ğò£¬³¤¶ÈĞ£Ñé£©+ `web/exporter.ts`£¨Ñ­»·äÖÈ¾+POST£©+ `scripts/export.ts`£¨Æô¶¯·şÎñ¡úÆô¶¯ Edge¡úµÈ´ı¡úÊä³ö mp4£©¡£±Ø²â£ºExportServer ¶Ô´íÎó³¤¶È·µ»Ø 400¡¢ÂÒĞòÖ¡·µ»Ø 409£»ÓÃ¼ÙµÄ ffmpeg ÃüÁî£¨`node -e` ÍÌ stdin£©ÑéÖ¤Ö¡¼ÆÊı¡£
- [ ] T11.7 ½×¶Î 3 ÑéÊÕ£¨**ĞèÒªÓÃ»§ÔÚ³¡**£©£ºÓÃ T10 µÄÕæÊµÂ¼ÖÆµ¼³ö MP4£¬ÓÃ»§ÈâÑÛÈ·ÈÏ¡¸×Ô¶¯Ëõ·Å¸úËæµã»÷¡¢¹â±êÆ½»¬¡¹¡£Í¨¹ıºó PROGRESS.md Ğ´¡¸½×¶Î 3 Íê³É¡¹²¢**Í£Ö¹**¡£

## ½×¶Î 4 ±à¼­Æ÷£¨´ÖÁ£¶È£¬½×¶Î 3 Íê³ÉºóÓÉ¸ß½× AI Ï¸»¯³É¿¨£©
Ô¤ÀÀÒ³£¨ÍÏÊ±¼äÏßÔ¤ÀÀ£©¡ú Ëõ·ÅÆ¬¶ÎÍÏ×§£¨ÓÃ `EditorTimeline.ts`£©¡ú ¼ôÇĞ/±äËÙ£¨ÓÃ `ProjectTimelineEditing.ts`£©¡ú ±£´æ `project.json`¡£

## ½×¶Î 5 ´ò°ü£¨ĞèÓÃ»§¾ö²ß Electron/Tauri/´¿½Å±¾Æô¶¯Æ÷£©
