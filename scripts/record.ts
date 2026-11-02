/**
 * scripts/record.ts
 *
 * Command-line entry point for recording screen and mouse pointer activity.
 * Usage:
 *   node scripts/record.ts --seconds 10 [--fps 60] [--display 0]
 */

import { recordSession } from '../src/capture/RecordingSession.ts';

function parseArgs(args: string[]): { seconds: number; fps: number; display: number } {
  let seconds = 10;
  let fps = 60;
  let display = 0;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--seconds' || arg === '-s') {
      const val = parseFloat(args[++i]);
      if (Number.isFinite(val) && val > 0) seconds = val;
    } else if (arg === '--fps' || arg === '-f') {
      const val = parseInt(args[++i], 10);
      if (Number.isFinite(val) && val > 0) fps = val;
    } else if (arg === '--display' || arg === '-d') {
      const val = parseInt(args[++i], 10);
      if (Number.isFinite(val) && val >= 0) display = val;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
DogSC 屏幕录制工具 (Windows CLI)

用法:
  node scripts/record.ts [选项]

选项:
  --seconds, -s <秒数>   录制时长（秒，默认 10）
  --fps,     -f <帧率>   视频帧率（默认 60）
  --display, -d <索引>   显示器索引（默认 0 为主屏）
  --help,    -h          显示此帮助信息
`);
      process.exit(0);
    }
  }

  return { seconds, fps, display };
}

async function main() {
  const { seconds, fps, display } = parseArgs(process.argv.slice(2));

  console.log('='.repeat(60));
  console.log('  DogSC Windows 屏幕与鼠标录制');
  console.log('='.repeat(60));
  console.log(`- 目标时长: ${seconds} 秒`);
  console.log(`- 录制帧率: ${fps} fps (CFR)`);
  console.log(`- 显示器索引: ${display}`);
  console.log('- 正在启动录制引擎...\n');

  try {
    const sessionDir = await recordSession({
      seconds,
      fps,
      outputIdx: display,
    });

    console.log('\n' + '='.repeat(60));
    console.log('✔ 录制顺利完成！');
    console.log(`📁 录制产物目录: ${sessionDir}`);
    console.log('  ├── screen.mp4   (原始屏幕视频)');
    console.log('  ├── pointer.jsonl (高精度鼠标事件流)');
    console.log('  ├── meta.json    (时钟对齐元数据)');
    console.log('  └── project.json (自动运镜工程定义)');
    console.log('='.repeat(60));
  } catch (err: any) {
    console.error('\n✖ 录制失败:', err.message || err);
    process.exit(1);
  }
}

main();
