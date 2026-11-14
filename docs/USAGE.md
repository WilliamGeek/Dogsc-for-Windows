# USAGE.md — DogSC Windows 使用与手动验收指南

## 1. 屏幕与鼠标录制 CLI
在系统终端（PowerShell 或 CMD）中执行：
```powershell
# 基础录制（默认 10 秒，60fps，主显示器）
node scripts/record.ts

# 自定义录制时长与帧率
node scripts/record.ts --seconds 15 --fps 60

# 指定副屏录制（display 为显示器索引）
node scripts/record.ts --seconds 10 --display 1
```

## 2. 录制产物结构
每次录制会在 `recordings/<YYYYMMDD-HHmmss>/` 目录下生成 4 个核心文件：
- `screen.mp4`：基于 Desktop Duplication API (ddagrab) 与 NVIDIA NVENC 硬件加速编码的 60fps 恒定帧率视频（视觉近无损）；
- `pointer.jsonl`：基于 Windows 低级鼠标钩子（WH_MOUSE_LL）记录的绝对像素坐标与毫秒级事件流；
- `meta.json`：记录屏幕分辨率、编码器型号、时钟对齐偏移量 `pointerOffsetSeconds` 及总时长；
- `project.json`：自动运镜算法根据点击时空聚类自动生成的完整工程模型，可直接供后续渲染器求值。

## 3. 手动校准与验收清单（对应任务卡 T10.6）
由于 Windows 会话限制（如远程后台服务无法直接抓屏），真实桌面与鼠标采集应在用户交互终端中进行验收：

### 验收清单：
1. **画面流畅度与清晰度**：打开 `screen.mp4`，确认帧率为 60fps，UI 字体清晰边缘锐利无色块；
2. **事件流捕获准确性**：打开 `pointer.jsonl`，确认首行为合法表头，后续行包含移动与点击事件；
3. **时钟对齐精度**：查看 `meta.json` 中的 `pointerOffsetSeconds`（正常范围通常在 0.1~0.4s）；
4. **自动运镜工程生成**：打开 `project.json`，确认 `zoomAnimations` 数量与实际点击次数匹配。

## 4. 阶段 3：WebGL2 渲染预览与批量 MP4 导出

### 批量导出命令（对应任务卡 T11.6）
使用无头 Microsoft Edge WebGL2 逐帧渲染并流式编码为 H.264 MP4：
```powershell
# 默认导出到 <录制目录>/export.mp4
node scripts/export.ts --dir F:\dogsc-win\recordings\20261114-184749

# 指定输出文件路径
node scripts/export.ts --dir F:\dogsc-win\recordings\20261114-184749 --out F:\dogsc-win\recordings\20261114-184749\export.mp4

# 限制导出前 N 帧（用于快速冒烟测试）
node scripts/export.ts --dir F:\dogsc-win\recordings\20261114-184749 --max-frames 60
```

### 单帧预览 URL 参数（配合 `startDevServer`）
通过 `src/server/DevServer.ts` 启动静态与 TS 编译服务后，可在浏览器访问：
- `http://127.0.0.1:<port>/web/render.html?mode=preview&dir=/recordings/<id>&frame=0`：预览指定录制目录的指定输出帧；
- `http://127.0.0.1:<port>/web/render.html?mode=preview&frame=44`：无录制目录时使用内置程序化桌面合成画面预览（含自动运镜与点击波纹）。

### 阶段 3 手动验收清单（对应任务卡 T11.7）
1. **播放导出成片**：打开 `recordings\20261114-184749\export.mp4`；
2. **背景与屏幕效果**：确认黑曜石网格背景、屏幕圆角、柔和阴影与桌面画面方向正确（无上下颠倒）；
3. **自动缩放与光标**：确认第 6 秒附近点击时画面平滑缩放聚焦至点击位置，矢量光标平滑跟随并伴随点击涟漪波纹。
