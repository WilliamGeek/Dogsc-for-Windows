# AGENTS.md — 接手本仓库的 Agent 必读（每次会话开始先读完本文件）

本仓库 `F:\dogsc-win` 用 TypeScript 重写 macOS 应用 DogSC（源码在 `F:\dogsc`，**只读，禁止修改**）的跨平台/Windows 版本。

## 0. 每次会话的固定流程（严格按顺序）
1. 读 `docs/PROGRESS.md` 最后 30 行，找到「下一个任务」。（任务号 T10 起属阶段 2+：另须先读 `docs/CONTRACTS.md`，其契约不得擅改。）
2. 读 `docs/PORTING_RULES.md`（移植规范，必须遵守）。
3. 在 `docs/TASKS.md` 中找到该任务卡，**只做这一张卡**。
4. 完成后执行 `npm test`，全部通过才算完成。
5. 在 `docs/TASKS.md` 把该卡的 `[ ]` 改成 `[x]`；在 `docs/PROGRESS.md` 末尾追加一行日志。
6. `git add -A; git commit -m "<type>(core|capture|render|server): <中文描述> (<任务号>)"`（遵循 Conventional Commits 规范，如 `feat(capture): 解析鼠标事件JSONL (T10.1)`）。
7. 为当前提交打上含中文功能特征描述的 Git Tag：`git tag -a "<任务号>-<中文功能描述>" -m "<详细说明>"`。
8. 开始下一张卡，或结束会话。

## 1. 硬性规则
- **唯一真相来源是 Swift 源码** `F:\dogsc\Sources\RecorderCore\*.swift` 与 `docs/CONTRACTS.md`。`docs/reference/` 下的算法解析报告只作导读，数字与公式若与源码冲突，以源码为准。
- **禁止安装任何依赖**（npm/pnpm/pip/winget 等）。确实需要时：停下，在 `PROGRESS.md` 写 `NEED-DEP: <包名> <理由>`，然后向用户提问。
- 只修改任务卡列出的文件。不要「顺手重构」其他文件。
- 不要为了让测试通过而改测试的期望值，除非你能指出 Swift 源码或 CONTRACTS.md 中的具体依据证明原期望是错的（把依据写进 commit message）。
- 运行环境：Windows + PowerShell，Node 24（原生运行 `.ts`，无需编译）。命令分隔用 `;` 而不是 `&&`。

## 2. 防死循环 / 省额度规则（必须遵守）
- 同一个失败测试，最多修 **3 次**。第 3 次仍失败：在 `PROGRESS.md` 写 `BLOCKED: <任务号> <测试名> <错误首行>`，`git stash` 或保留改动并提交为 `WIP`，跳到下一张卡。
- 同一条命令连续执行 2 次输出完全相同且失败 → 不要再执行第 3 次，换思路或标记 BLOCKED。
- 单张卡读取的代码超过 600 行时，分段读，不要一次读整个大文件。
- 如果你发现自己在反复读同一个文件的同一段（≥3 次），停止并写下你卡住的原因。

## 3. 常用命令
```powershell
cd F:\dogsc-win
npm test                                      # 跑全部测试
node --test test/core/HexColor.test.ts        # 只跑一个测试文件
```

## 4. 目录结构
```
src/core/        # 纯算法（阶段1，禁止 import node:*）
src/capture/     # 仅 Node（采集；可 import node:*）
src/render/      # 纯函数（Node/浏览器共用，禁止 import node:*）
src/server/      # 仅 Node（本地 HTTP 服务）
web/             # 浏览器端页面与脚本（原生 ES module，不得 import node:*）
tools/           # PowerShell / 辅助脚本
scripts/         # 命令行入口（node scripts/xxx.ts）
docs/PLAN.md     # 宏观路线图（阶段 0~5）
docs/TASKS.md    # 任务卡（微观，一卡一提交）
docs/CONTRACTS.md # 阶段 2~3 数据与接口契约
docs/PROGRESS.md # 进度日志（只追加）
```
