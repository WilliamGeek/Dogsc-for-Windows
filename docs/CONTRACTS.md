# CONTRACTS.md — 阶段 2~3 的数据与接口契约（高阶 AI 定稿，低阶 Agent 禁止擅自改动）

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
`<id>` = `YYYYMMDD-HHmmss`（本地时间）。
| 文件 | 内容 |
|---|---|
| `screen.mp4` | ddagrab 录屏，H.264，**恒定帧率** `fps`（默认 60），无音频 |
| `pointer.jsonl` | 见 §2 |
| `meta.json` | `{"id","fps","width","height","screenStartUnixMs","pointerOriginUnixMs","pointerOffsetSeconds","encoder","durationSeconds"}` |
| `project.json` | `encodeRecorderProject(project)` 的输出（阶段1 `ProjectMediaModel.ts`） |

时间对齐：`pointerOffsetSeconds = (pointerOriginUnixMs - screenStartUnixMs) / 1000`。
`screenStartUnixMs` = Node 在 spawn ffmpeg **之前一刻**取的 `Date.now()`（已知误差约 0.1~0.4s，阶段2 末尾有校准卡）。
事件进入核心算法前：`source事件时间 = t + pointerOffsetSeconds`（视频时间轴）。

## 4. 渲染契约（阶段 3）
- 源视频不在浏览器里 seek。流程：`ffmpeg -i screen.mp4 -vf fps=<fps> -q:v 2 frames/%06d.jpg` 预解码，帧号从 **1** 开始。
- 输出帧 n（n 从 0 开始）的输出时间 `tOut = n / fps`（用阶段1 `OutputFrameSchedule`）。
- 源帧：`sourceTime = TimelineMap.sourceTime(tOut)`（以 `TimelineMap.ts` 实际方法名为准），`sourceFrameFile = round(sourceTime * fps) + 1`，夹到 `[1, 帧总数]`。
- 浏览器页面从 `GET /api/plan?...` 拿到：`{fps,width,height,frameCount,project(JSON),pointerEvents(JSON)}`，在页面内用 `src/core` 的 `FrameSceneEvaluator.scene(...)` 求值（Node 与浏览器同一份代码）。
- 导出：页面每渲染完一帧，`gl.readPixels` 得 RGBA（**注意 WebGL 原点在左下，需垂直翻转**，写入前翻转或让 ffmpeg 加 `-vf vflip`；本项目约定：用 ffmpeg `-vf vflip`），`POST /api/frame/<n>`（body=原始 RGBA，长度必须 = width*height*4）；服务端严格按 n 递增顺序写入 ffmpeg stdin：
  `ffmpeg -y -f rawvideo -pix_fmt rgba -s WxH -r FPS -i - -vf vflip -c:v h264_nvenc -pix_fmt yuv420p out.mp4`（无 NVENC 回退 `libx264`）。
- 页面发完所有帧后 `POST /api/done`，服务端关闭 ffmpeg stdin 并等待退出。
- 浏览器：本机 Edge `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，用 `--headless=new --disable-gpu-sandbox --use-angle=d3d11 <url>` 启动；**不使用 CDP/puppeteer**，页面自己驱动循环。
- `.ts` 供给：`src/server/DevServer.ts` 对 `/src/**/*.ts` 与 `/web/**/*.ts` 请求用 `node:module` 的 `stripTypeScriptTypes(source)` 擦类型后以 `text/javascript` 返回。

## 5. 阶段 2 / 3 通用约束
- 零依赖。外部可执行文件仅限：`ffmpeg`、`powershell.exe`（5.1）、`msedge.exe`。
- **不得使用 `-ExecutionPolicy Bypass`** 或任何绕过执行策略的手段；运行 `.ps1` 前先 `Get-ExecutionPolicy`，若 `-File` 被策略拒绝 → 写 `BLOCKED` 并询问用户。
- 所有子进程必须有超时与 kill，测试里不得留下孤儿 ffmpeg/powershell 进程（`afterEach` 中 kill）。
- 涉及真实屏幕/鼠标的测试用 `{ skip: !process.env.DOGSC_E2E }` 标记，`npm test` 默认跳过；E2E 手动 `$env:DOGSC_E2E=1; npm test`。

## 6. �������ƣ�2026-11-02 ʵ�⣩
Agent ���ڻỰ**�޷����ʽ���ʽ����**��`ffmpeg ddagrab` �� `Desktop duplication access denied`��`gdigrab` �� `error 5`��
��ˣ�
- ���漰��ʵ��Ļ/���� E2E��T10.2��T10.3��T10.4 �� E2E ���֡�T10.6��T11.7��**Agent ���ó������У�Ҳ�����跨�ƹ�**��ֻд���� + ���������⣬���� PROGRESS.md �� `NEED-USER-E2E: <�����> <����>`�����û����Լ��� PowerShell ��ִ�� `$env:DOGSC_E2E=1; npm test` �����������
- ����֤���ã�Agent �Ự�ڣ���ffmpeg �� `ddagrab`/`h264_nvenc`/`libx264`��`ffprobe` ���ڣ�Node 24.15��PowerShell 5.1��ִ�в��� RemoteSigned��Edge λ�� `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`��
- ��Ⱦ�׶Σ�T11.x��ʹ�õ�����¼�õ��ļ��뱾�� HTTP��������������ʣ��� Edge headless �ܷ��� Agent �Ự����δ��֤��T11.4 ��ʧ�ܰ� `NEED-USER-E2E` ������
