/**
 * scripts/calibrate.ts
 *
 * Calibration and manual acceptance tool for Phase 2 (Capture).
 * Records 6 seconds of screen and mouse activity with live interactive countdown.
 * Prompts user to click at t=2s and t=4s, then prints alignment diagnostics.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordSession } from '../src/capture/RecordingSession.ts';
import { parsePointerJsonl } from '../src/capture/PointerJsonl.ts';

export interface CalibrationClickLike {
  time: number;
  kind?: string;
}

export interface CalibrationResult {
  ok: boolean;
  failures: string[];
}

/**
 * Strict two-click calibration assertion. A passing run must contain exactly
 * two clicks: #1 at 2s and #2 at 4s, each within toleranceSeconds.
 */
export function evaluateCalibration(
  clicks: readonly CalibrationClickLike[],
  durationSeconds: number,
  toleranceSeconds = 0.6
): CalibrationResult {
  const failures: string[] = [];
  if (clicks.length !== 2) {
    failures.push(`点击数应为 2 次，实际为 ${clicks.length} 次`);
  }

  const expected = [2, 4];
  for (let i = 0; i < expected.length; i++) {
    const click = clicks[i];
    if (!click) continue;
    const min = expected[i] - toleranceSeconds;
    const max = expected[i] + toleranceSeconds;
    if (click.time < min || click.time > max) {
      failures.push(
        `第 ${i + 1} 次点击应落在 ${min.toFixed(2)}s ~ ${max.toFixed(2)}s，实际为 ${click.time.toFixed(3)}s`
      );
    }
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds < 6 - toleranceSeconds) {
    failures.push(`录制时长应至少覆盖 6 秒校准窗口，实际为 ${durationSeconds.toFixed(3)}s`);
  }

  return { ok: failures.length === 0, failures };
}

async function main() {
  console.log('='.repeat(65));
  console.log('  DogSC Windows 阶段 2 屏幕与鼠标录制校准工具 (Calibration)');
  console.log('='.repeat(65));
  console.log('本脚本将进行为期 6 秒的快速录制。');
  console.log('请在录制开始后根据提示操作：');
  console.log('  👉 第 2 秒：在屏幕任意位置点击一次鼠标左键；');
  console.log('  👉 第 4 秒：在屏幕另一位置再点击一次鼠标左键。\n');

  console.log('3 秒后开始录制...');
  for (let c = 3; c > 0; c--) {
    console.log(`倒计时: ${c}...`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('\n>>> 录制已启动！<<<');

  // Interactive countdown ticker in parallel with recording
  const ticker = (async () => {
    const prompts: Record<number, string> = {
      1: '[00:01] 正在移动光标...',
      2: '[00:02] 🔔 【请现在点击第 1 次！】',
      3: '[00:03] 移动光标至其他区域...',
      4: '[00:04] 🔔 【请现在点击第 2 次！】',
      5: '[00:05] 即将完成...',
      6: '[00:06] 录制结束。',
    };

    for (let s = 1; s <= 6; s++) {
      await new Promise((r) => setTimeout(r, 1000));
      console.log(prompts[s] || `[00:0${s}]...`);
    }
  })();

  let sessionDir: string;
  try {
    const sessionPromise = recordSession({
      seconds: 6,
      fps: 60,
    });
    const [dir] = await Promise.all([sessionPromise, ticker]);
    sessionDir = dir;
  } catch (err: any) {
    console.error('\n✖ 录制执行失败:', err.message || err);
    console.error('提示：如果提示 "Desktop duplication access denied"，请确保在交互式控制台运行。');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(65));
  console.log('✔ 校准录制完成，正在分析数据...');
  console.log(`📁 产物目录: ${sessionDir}\n`);

  // Analyze metadata
  const metaPath = resolve(sessionDir, 'meta.json');
  const pointerPath = resolve(sessionDir, 'pointer.jsonl');
  const screenPath = resolve(sessionDir, 'screen.mp4');

  let durationSeconds = 0;
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    durationSeconds = meta.durationSeconds;
    console.log('【时钟对齐诊断】');
    console.log(`- 编码器: ${meta.encoder}`);
    console.log(`- 屏幕尺寸: ${meta.width} x ${meta.height}`);
    console.log(`- 录制帧率: ${meta.fps} fps`);
    console.log(`- 实际录制时长: ${meta.durationSeconds.toFixed(3)} 秒`);
    console.log(`- 鼠标与视频时钟偏移 (pointerOffsetSeconds): ${meta.pointerOffsetSeconds.toFixed(3)} 秒`);
    if (Math.abs(meta.pointerOffsetSeconds) < 0.5) {
      console.log('  ✔ 时钟偏移在正常基准范围 (0.0s ~ 0.4s) 内。');
    } else {
      console.log('  ⚠ 时钟偏移偏大，请检查系统启动延迟。');
    }
  }

  if (existsSync(pointerPath)) {
    const content = readFileSync(pointerPath, 'utf-8');
    const parsed = parsePointerJsonl(content);
    const clicks = parsed.events.filter((e) => e.kind === 'leftClick' || e.kind === 'rightClick');

    console.log('\n【鼠标事件诊断】');
    console.log(`- 捕获总事件数: ${parsed.events.length} 条`);
    console.log(`- 捕获点击数: ${clicks.length} 次`);
    clicks.forEach((c, idx) => {
      console.log(
        `  [点击 #${idx + 1}] 时刻: ${c.time.toFixed(3)}s, 归一化位置: (${c.location.x.toFixed(3)}, ${c.location.y.toFixed(3)}), 类型: ${c.kind}`
      );
    });

    const calibration = evaluateCalibration(clicks, durationSeconds);
    if (!calibration.ok) {
      console.error('\n✖ 严格校准验收失败:');
      for (const reason of calibration.failures) {
        console.error(`  - ${reason}`);
      }
      process.exit(1);
    }
    console.log('\n✔ 严格校准验收通过：2 次点击均落在 2s/4s ±0.6s 窗口内。');
  }

  console.log('\n【用户手动验收检查项】');
  console.log(`1. 播放视频: 打开 "${screenPath}" 确认画面正常录制且播放流畅`);
  console.log('2. 确认事件: 上方记录的点击时刻与位置是否与您的实际操作一致');
  console.log('='.repeat(65));
}

const invokedPath = process.argv[1];
if (invokedPath && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((err: any) => {
    console.error('\n✖ 校准执行失败:', err?.message || err);
    process.exit(1);
  });
}
