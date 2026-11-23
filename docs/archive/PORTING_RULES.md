# PORTING_RULES.md — Swift → TypeScript 移植规范

> 目标：**行为逐行等价**，不是「写一个类似的」。照着 Swift 一行一行翻译，保留原有注释（翻成英文原样保留即可）。

## 1. 运行时限制（Node 24 原生类型擦除）
Node 直接运行 `.ts`，只会「擦掉类型」，因此以下 TS 语法**禁止使用**（会直接报错）：
- `enum`、`const enum`、`namespace`、`module X {}`
- 构造函数参数属性 `constructor(private x: number)`
- `import x = require()`、`export =`
- 装饰器

另外：
- 导入路径**必须带 `.ts` 后缀**：`import { clamp } from './swift.ts';`
- **只导入类型时必须写 `import type`**：`import type { MotionStyle } from './ProjectModel.ts';`
  （否则运行时会因为找不到导出而报错。）
- 只能用 Node 内置模块（`node:test`、`node:assert/strict` 等），且 **`src/core/` 内禁止 import 任何 `node:*` 模块**（core 将来要在浏览器里运行）；测试文件不受此限。

## 2. 数值语义（最容易出错）
| Swift | TS | 说明 |
|---|---|---|
| `min(a,b)` / `max(a,b,c)` | `min()` / `max()` from `./swift.ts` | **禁止用 Math.min/Math.max**，NaN 语义不同 |
| `min(max(v, lo), hi)` | `clamp(v, lo, hi)` | 顺序不可颠倒 |
| `x.isFinite` | `Number.isFinite(x)` | |
| `Int(d)` | `toInt(d)` | 向零截断 |
| `Double(i)` | 直接用 | |
| `abs` `sqrt` `sin` `cos` `exp` `pow` `hypot` `atan2` | `Math.*` | |
| `.pi` | `Math.PI` | |
| `.infinity` | `Number.POSITIVE_INFINITY` | |
| `.leastNonzeroMagnitude` | `leastNonzeroMagnitude` from swift.ts | |
| `0.000_001` | `0.000_001`（TS 也支持下划线） | |
| `&+=` | `+=` | |
| `a / b`（两个 Int） | `Math.trunc(a / b)` | Swift 整数除法截断 |
| `a % b`（Double） | `a % b` | Swift `truncatingRemainder` 同 JS `%` |

## 3. 类型映射
| Swift | TS 写法 |
|---|---|
| `struct X { var a; let b }` | `export interface X { a: number; readonly b: number }` + `export function makeX(...)`（复刻 `init` 里的 clamp 逻辑） |
| struct 的方法 `x.foo(y)` | `export function xFoo(x: X, y): R`（文件内导出的自由函数） |
| struct 计算属性 `var end: T { ... }` | `export function xEnd(x: X): T` |
| `init?` 可失败构造 | 返回 `X \| null` |
| `throws` | 抛 `Error`（`class XError extends Error`，字段赋值写在构造函数体内） |
| `Optional<T>` / `T?` | `T \| null`（统一用 null，不用 undefined） |
| `enum E: String { case a = "甲" }` | `export type E = '甲' \| ...` + `export const EAllCases = [...]`。**值用 rawValue**（中文 rawValue 也照抄） |
| 无 rawValue 的 enum | `type E = 'a' \| 'b'`，值用 case 名 |
| 带关联值的 enum `case x(Int)` | 判别联合 `{ kind: 'x'; value: number }` |
| 无 case 的 enum（命名空间，如 `AutoZoomPlanner`） | 模块内函数 + `export const AutoZoomPlanner = Object.freeze({ fnA, fnB })` |
| `static let foo = X(...)` | `export const XFoo = makeX(...)` |
| `class`（引用类型，如缓存） | TS `class`（字段在构造函数体内赋值） |
| `UUID` | `string`，新建用 `newUUID()` |
| `TimeInterval` / `Double` / `CGFloat` | `number` |
| `[T]` | `T[]`（入参写 `readonly T[]`） |
| `[K: V]` | `Map<K, V>`（key 是 struct 时用 `JSON.stringify(key)` 作 string key） |
| `Set<T>` | `Set<T>`（同上） |
| `Equatable ==` | 测试里用 `assert.deepEqual`；业务代码需要时写 `xEquals(a, b)` |
| `Codable` | Phase 1 **不要求**兼容 macOS 工程文件；只在 Swift 自定义了 `init(from:)` 时写 `xFromJSON` |
| `Sendable` `@unchecked` `NSLock` | 忽略（JS 单线程），锁直接删掉 |
| `Task.isCancelled` 取消检查 | 改为可选参数 `cancellationCheck: () => boolean = () => false` |

## 4. 函数重载与默认参数
- Swift 允许同名不同参数类型（如 `makeAnimations(for: [PointerEventRecord])` 与 `makeAnimations(for: [PointerClick])`）。TS 中**改名**：`makeAnimationsFromPointerEvents` / `makeAnimationsFromClicks`。在注释中写明对应的 Swift 签名。
- 超过 2 个默认参数时，改为最后一个 `options: Partial<{...}> = {}` 对象，并在函数体首行解构默认值，默认值必须与 Swift 完全一致。

## 5. 值语义（第二容易出错）
Swift struct 赋值即复制，TS 对象是引用。规则：
- **永远不修改入参**。
- Swift `var c = clip; c.endTime = x` → `const c = { ...clip, endTime: x }`。
- Swift `var result = planned; result[i].endTime = x` → `const result = planned.map(c => ({ ...c }));` 然后再改。
- 嵌套 struct 被修改时（`a.b.c = 1`）→ `{ ...a, b: { ...a.b, c: 1 } }`。

## 6. 测试规范（每个移植文件都要有）
文件：`test/core/<Name>.test.ts`，使用 `node:test` + `node:assert/strict`。最低要求：
1. **构造函数 clamp**：每个 `makeX` 至少一个越界输入用例。
2. **边界**：空数组、单元素、NaN/Infinity 输入。
3. **至少 1 个手算用例**：在测试注释中写出计算过程，并注明依据的 Swift 行号。
4. **任务卡 "必测" 列表中的每一条**。
5. 浮点比较用 `assert.ok(Math.abs(a - b) < 1e-9)`，不要对浮点结果用 `equal`（除非是 0/1 这类精确端点）。

## 7. 依赖未移植的文件时
- 只需要**类型**：直接 `import type` 未来的文件路径（类型会被擦除，运行不受影响）。
- 需要**值/函数**（例如测试要用 `MotionStyle` 的默认值）：先停下当前卡，在 PROGRESS.md 记一行 `REORDER: Tx 依赖 <文件>`，去做那个文件对应的卡，做完再回来。**禁止**写临时 stub。
