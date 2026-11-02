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
