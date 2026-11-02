# AGENTS.md �?接手本仓库的 Agent 必读（每次会话开始先读完本文件）

本仓�?`F:\dogsc-win` �?TypeScript 重写 macOS 应用 DogSC（源码在 `F:\dogsc`�?*只读，禁止修�?*）的跨平�?Windows 版本�?
## 0. 每次会话的固定流程（严格按顺序）
1. �?`docs/PROGRESS.md` 最�?30 行，找到「下一个任务」�?2. �?`docs/PORTING_RULES.md`（移植规范，必须遵守）�?3. �?`docs/TASKS.md` 中找到该任务卡，**只做这一张卡**�?4. 完成后执�?`npm test`，全部通过才算完成�?5. �?`docs/TASKS.md` 把该卡的 `[ ]` 改成 `[x]`；在 `docs/PROGRESS.md` 末尾追加一行日志�?6. `git add -A; git commit -m "<type>(core): <中文描述> (<任务�?)"`（遵�?Conventional Commits 规范，如 `feat(core): 移植录制标记与导出设置数据模�?(T1.1)`）�?7. 为当前提交打上含中文功能特征描述�?Git Tag：`git tag -a "<任务�?-<中文功能描述>" -m "<详细说明>"`�?8. 开始下一张卡，或结束会话�?
## 1. 硬性规�?- **唯一真相来源�?Swift 源码** `F:\dogsc\Sources\RecorderCore\*.swift`。`docs/reference/` 下的算法解析报告只作导读，数字与公式若与源码冲突，以源码为准�?- **禁止安装任何依赖**（npm/pnpm/pip/winget 等）。确实需要时：停下，�?`PROGRESS.md` �?`NEED-DEP: <包名> <理由>`，然后向用户提问�?- 只修改任务卡列出的文件。不要「顺手重构」其他文件�?- 不要为了让测试通过而改测试的期望值，除非你能指出 Swift 源码中的具体行号证明原期望是错的（把行号写进 commit message）�?- 运行环境：Windows + PowerShell，Node 24（原生运�?`.ts`，无需编译）。命令分隔用 `;` 而不�?`&&`�?
## 2. 防死循环 / 省额度规则（必须遵守�?- 同一个失败测试，最多修 **3 �?*。第 3 次仍失败：在 `PROGRESS.md` �?`BLOCKED: <任务�? <测试�? <错误首行>`，`git stash` 或保留改动并提交�?`WIP`，跳到下一张卡�?- 同一条命令连续执�?2 次输出完全相同且失败 �?不要再执行第 3 次，换思路或标�?BLOCKED�?- 单张卡读取的 Swift 源码超过 600 行时，按卡上给出的行号分段读，不要一次读整个大文件�?- 如果你发现自己在反复读同一个文件的同一段（�? 次），停止并写下你卡住的原因�?
## 3. 常用命令
```powershell
cd F:\dogsc-win
npm test                                      # 跑全部测�?node --test test/core/HexColor.test.ts        # 只跑一个测试文�?# 列出某个 Swift 文件的顶层声明及行号（用来分段阅读）�?Select-String -Path F:\dogsc\Sources\RecorderCore\ZoomAnimation.swift -Pattern '^(public |private |fileprivate )?(final )?(struct|enum|class|extension|func|static func) ' | % { "$($_.LineNumber): $($_.Line.Trim())" }
# 查找某个类型在哪�?Swift 文件里定义：
Select-String -Path F:\dogsc\Sources\RecorderCore\*.swift -Pattern '(struct|enum|class) MotionStyle\b'
```

## 4. 目录结构
```
src/core/<SwiftFileName>.ts      # �?Swift 文件 1:1 同名（ZoomAnimation.swift �?ZoomAnimation.ts�?test/core/<SwiftFileName>.test.ts
docs/PLAN.md                     # 宏观路线图（阶段 0~5�?docs/TASKS.md                    # 任务卡（微观，一卡一提交�?docs/PORTING_RULES.md            # Swift �?TS 移植规范 + 示例
docs/PROGRESS.md                 # 进度日志（只追加�?docs/reference/                  # 算法导读报告（非权威�?```
已完成的范例文件（照着写）：`src/core/ElementMotion.ts`、`MediaTimeRange.ts`、`HexColor.ts`、`PointerEventTimelineOrdering.ts`、`swift.ts`�?
