# CONTRACTS.md — 数据与接口契约 V2（高阶 AI 定稿，低阶 Agent 禁止擅自改动）

任何与本文件冲突的实现都是错的。确需修改契约：在 PROGRESS.md 写 `NEED-DECISION: <原因>` 并停止。

## 1. 目录约定
```
src/core/        纯算法（阶段1，禁止 import node:*）
src/capture/     仅 Node（采集；可 import node:*）
src/render/      纯函数（Node/浏览器共用，禁止 import node:*）
src/server/      仅 Node（本地 HTTP 服务）
web/             浏览器端页面与脚本（原生 ES module，不得 import node:*）
tools/           PowerShell / 辅助脚本
scripts/         命令行入口（node scripts/xxx.ts）
recordings/<id>/ 录制产物（已加入 .gitignore，不提交）
```

## 2. 鼠标事件 JSONL（`pointer.jsonl`）
每行一个 JSON 对象，UTF-8，`\n` 结尾。

第 1 行（表头，必须存在）：
```json
{"hdr":1,"originUnixMs":1762000000000,"screen":{"x":0,"y":0,"w":2560,"h":1600}}
```
- `originUnixMs`：钩子进程把 `t=0` 对齐到的 Unix 毫秒时间（`Date.now()` 语义）。
- `screen`：被录制显示器在虚拟桌面中的像素矩形（主显示器：x=0,y=0）。

之后每行（事件）：
```json
{"t":1.234,"x":1280,"y":800,"k":"move"}
```
- `t`：秒，浮点，相对 `originUnixMs`，由 `Stopwatch` 高精度计时，单调不减。
- `x`,`y`：虚拟桌面绝对像素（整数，可能超出 screen 矩形，解析时要夹到 0…1）。
- `k` 只允许 `"move" | "leftClick" | "rightClick"`（按下时刻产生；抬起事件钩子端丢弃）。
- 解析规则（`PointerJsonl.ts`）：忽略空行与无法解析的行；不是上述 `k` 的行忽略；
  归一化 `nx=(x-screen.x)/screen.w`，`ny=(y-screen.y)/screen.h`，再夹到 [0,1]；
  最后按 `t` 稳定排序。归一化坐标原点为屏幕左上，y 向下（与 `PointerEventRecord.location` 一致，不要翻转）。

## 3. 录制目录 `recordings/<id>/`
`<id>` = `YYYYMMDD-HHmmss`（同秒冲突时追加 `-01`..`-99`）。
| 文件 | 内容 |
|---|---|
| `screen.mp4` | `ddagrab`/`gdigrab` 录屏，H.264，**恒定帧率** `fps`（默认 60），**必须含 `draw_mouse=0`** |
| `pointer.jsonl` | 见 §2（Wave A T12.5 起支持 `Per-Monitor DPI V2` 与指定显示器矩形 `-ScreenX/Y/W/H`） |
| `meta.json` | `{"id","fps","width","height","frameCount","screenStartUnixMs","spawnUnixMs","firstFrameUnixMs","pointerOriginUnixMs","pointerOffsetSeconds","encoder","durationSeconds","displayDescriptor"}` |
| `project.json` | `encodeRecorderProject(project)` 的输出（`ProjectSchema.currentVersion`：Wave A 为 27，Wave B 升至 28；`capture` 必须写实录参数，统一使用 `CaptureConfiguration.ts` 枚举） |

- **唯一时长真相（P0-01）**：`RecordingSession` 必须在 `recorder.stop()` 后调用 `ffprobe`（`MediaProbe.ts`）获取真实 `durationSeconds`、`frameCount`、`width`、`height` 并写入 `meta.json`；**严禁使用 `Date.now()` 墙钟时间兜底**。
- **失败即失败（P0-02）**：若 `ffmpeg` 退出码非 0 或缺少可解码 `screen.mp4`，`recordSession` 必须 reject、停止子进程、**清理不完整录制目录**，CLI 以退出码 1 结束。
- **时间对齐（P1-05）**：通过 `ffmpeg -progress pipe:1` 解析首帧产出时间 `firstFrameUnixMs`，计算 `pointerOffsetSeconds = (pointerOriginUnixMs - firstFrameUnixMs) / 1000`。事件进入核心算法前：`source事件时间 = t + pointerOffsetSeconds`（视频时间轴）。

## 4. 渲染契约（阶段 3 / Wave A~E 扩展）
- 源视频不在浏览器里 seek。流程：`ffmpeg -i screen.mp4 -vf fps=<fps> -q:v 2 frames/%06d.jpg` 预解码，帧号从 **1** 开始（Wave D 起含 `camera_frames/%06d.jpg`）。
- 输出帧 n（n 从 0 开始）的输出时间 `tOut = n / fps`（用 `OutputFrameSchedule`）。
- **有效时长裁剪（P0-01）**：`FramePlan` 强制按 `effectiveDuration = min(durationSeconds, sourceFrameCount / fps)` 规划总帧数，`sourceFrameFile = round(sourceTime * fps) + 1`，严禁在源视频结束后用夹取末帧凑出尾部静止视频。
- 浏览器页面从 `GET /api/plan?...` 拿到：`{fps,width,height,frameCount,sourceFrameCount,durationSeconds,project(JSON),pointerEvents(JSON)}`，在页面内用 `src/core` 的 `FrameSceneEvaluator.scene(...)` 求值（Node 与浏览器同一份代码）。
- **导出稳健性（P1-01/02）**：页面逐帧 `gl.readPixels` 得 RGBA（`ffmpeg -vf vflip` 翻转）→ `POST /api/frame/<n>`（单帧超时/重试；异常发 `POST /api/error`）→ 发满后 `POST /api/done`。服务端严格按递增顺序写入 `ffmpeg stdin`，具备 `30s` 无帧 Watchdog；`/api/done` **必须校验 `receivedFrames === plan.frameCount`**（不相等返回 `409 Conflict` 并删除残缺文件）。
- 浏览器：本机 Edge `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，用 `--headless=new --disable-gpu-sandbox --use-angle=d3d11 <url>` 启动；页面自驱循环且逐帧 `ImageBitmap.close()` + 消费响应体以防止 OOM。
- `.ts` 供给与安全边界（P1-07）：`DevServer` / `ExportServer` / `StudioServer` 对 `/src/**/*.ts` 与 `/web/**/*.ts` 用 `node:module` 的 `stripTypeScriptTypes(source)` 擦类型返回；所有路径访问**必须通过 `SafePath.ts` (`path.relative`) 校验**，严禁使用 `.startsWith(rootDir)`。

## 5. 通用约束
- Wave A–E **零 npm 依赖**。外部可执行文件仅限：`ffmpeg`、`ffprobe`、`powershell.exe`（5.1）、`msedge.exe`。
- **不得使用 `-ExecutionPolicy Bypass`** 或任何绕过执行策略的手段；运行 `.ps1` 前先 `Get-ExecutionPolicy`，若 `-File` 被策略拒绝 → 写 `BLOCKED` 并询问用户。
- 所有子进程必须有超时与进程树清理（`taskkill /F /T`），测试里不得留下孤儿 `ffmpeg`/`powershell`/`msedge` 进程。
- 涉及真实屏幕/鼠标/外设的测试用 `{ skip: !process.env.DOGSC_E2E }` 标记，`npm test` 默认跳过；E2E 手动 `$env:DOGSC_E2E='1'; npm test`。

## 6. 环境状态与分层验证规范（2026-11-20 实测更新）
- **交互式桌面实测能力已确认**：在本机交互式 Windows 11 桌面会话下，`$env:DOGSC_E2E='1'; npm test` 已实测通过 **204/204**，`ffmpeg ddagrab`、`h264_nvenc`、`dshow`、`WH_MOUSE_LL` 钩子、无头 Edge WebGL2 均可用。仅非交互/孤立后台服务会话仍会遇到 `Desktop duplication access denied` / `error 5`（此类环境仍记 `NEED-USER-E2E`）。
- **本地验证环境事实**：Node `24.15.0`（`C:\Program Files\nodejs\node.exe`；`v22.18+` 原生类型擦除亦可运行）、`ffmpeg`（含 `ddagrab`/`gdigrab`/`dshow`/`h264_nvenc`/`libx264`）、`ffprobe`、PowerShell `5.1`（`RemoteSigned`）、Microsoft Edge `msedge.exe`。
- **禁止“伪全绿”**：所有端到端视觉、时长、光标、点击同步与 GUI 验收必须执行 `docs/MASTER_REFACTOR_PLAN_V2.md` §6 的 **G1–G6 门禁与 4 级验证渠道标注规范**（`CU-VERIFIED` / `BROWSER-MCP-VERIFIED` / `SYNTHETIC-DESKTOP-VERIFIED` / `HEADLESS-VERIFIED`）及 `scripts/verify-export.ts`。
