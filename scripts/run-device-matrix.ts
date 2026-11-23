/**
 * scripts/run-device-matrix.ts
 *
 * Automated Windows hardware, display/window/device enumeration, encoder fallback,
 * multi-resolution/HEVC/M4A export, and live T12.9 showinfo capture verification matrix (Gate G6).
 * Strictly cleans up temporary media artifacts under `out/t173-matrix/`.
 */

import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync, spawnSync } from 'node:child_process';
import { enumerateDisplays } from '../src/capture/DisplayEnumeration.ts';
import { enumerateWindows } from '../src/capture/WindowEnumeration.ts';
import { enumerateDirectShowDevices } from '../src/capture/MediaDevices.ts';
import { detectEncoder } from '../src/capture/ScreenRecorder.ts';
import { recordSession } from '../src/capture/RecordingSession.ts';
import { probeMediaFile } from '../src/capture/MediaProbe.ts';
import { buildAudioOnlyM4aArgs } from '../src/render/AudioMixPlan.ts';
import { resolveCscPath, resolveIExpressPath } from '../src/desktop/DesktopBuilder.ts';

function runCommand(cmd: string, args: string[], timeoutMs = 180_000): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  return {
    ok: res.status === 0,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  };
}

function getHostHardwareInfo(): unknown {
  const psScript = [
    '$os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber',
    '$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, NumberOfCores, NumberOfLogicalProcessors',
    '$cs = Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory',
    '$gpus = @(Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion)',
    '[PSCustomObject]@{ os = $os; cpu = $cpu; ramBytes = $cs.TotalPhysicalMemory; gpus = $gpus } | ConvertTo-Json -Depth 4',
  ].join('; ');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    return JSON.parse(out);
  } catch (err: any) {
    return { error: err?.message ?? String(err) };
  }
}

async function copyRecursive(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyRecursive(s, d);
    } else if (e.isFile()) {
      await fs.copyFile(s, d);
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
    },
    strict: false,
  });

  const rootDir = path.resolve(import.meta.dirname, '..');
  const tmpRoot = path.join(rootDir, 'out', 't173-matrix');
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  const report: Record<string, any> = {
    executedAt: new Date().toISOString(),
    nodeVersion: process.version,
    ffmpegVersion: runCommand('ffmpeg', ['-version']).stdout.split(/\r?\n/)[0] ?? 'unknown',
    toolchain: {
      cscPath: resolveCscPath(),
      iexpressPath: resolveIExpressPath(),
    },
    host: getHostHardwareInfo(),
    enumeration: {},
    liveCapture: {},
    invalidDisplayFailFast: {},
    exportMatrix: [],
    softwareFallbackAndAudio: {},
    desktopShellCheck: {},
  };

  try {
    // 1. Live Device Enumeration & Encoder Detection
    const [displays, windows, dshow, detectedEncoder] = await Promise.all([
      enumerateDisplays(),
      enumerateWindows(),
      enumerateDirectShowDevices(),
      detectEncoder(),
    ]);
    report.enumeration = {
      displayCount: displays.length,
      displays,
      windowCount: windows.length,
      sampleWindows: windows.slice(0, 6).map((w) => ({
        title: w.title,
        processName: w.processName,
        width: w.width,
        height: w.height,
      })),
      cameraCount: dshow.video.length,
      cameras: dshow.video,
      micCount: dshow.audio.length,
      microphones: dshow.audio.map((a) => a.name),
      detectedEncoder,
    };

    // 2. Live 3s 60fps T12.9 showinfo capture probe
    const liveRecsDir = path.join(tmpRoot, 'live-recs');
    await fs.mkdir(liveRecsDir, { recursive: true });
    try {
      const t0 = Date.now();
      const sessionDir = await recordSession({
        seconds: 3,
        fps: 60,
        outputIdx: 0,
        baseDir: liveRecsDir,
      });
      const elapsedMs = Date.now() - t0;
      const meta = JSON.parse(await fs.readFile(path.join(sessionDir, 'meta.json'), 'utf8'));
      const probed = await probeMediaFile(path.join(sessionDir, 'screen.mp4'));
      report.liveCapture = {
        status: 'VERIFIED',
        elapsedMs,
        encoder: meta.encoder,
        firstFrameClockSource: meta.firstFrameClockSource ?? null,
        spawnUnixMs: meta.spawnUnixMs ?? null,
        firstFrameUnixMs: meta.firstFrameUnixMs ?? null,
        pointerOffsetSeconds: meta.pointerOffsetSeconds,
        probed,
        durationSpreadSeconds: Number(Math.abs(probed.durationSeconds - Number(meta.durationSeconds)).toFixed(6)),
      };
    } catch (err: any) {
      report.liveCapture = {
        status: 'FAILED',
        error: err?.message ?? String(err),
      };
    }

    // 3. Invalid --display 9 Fail-Fast & Zero-Dirty-Dir Verification
    const invalidRecsDir = path.join(tmpRoot, 'invalid-recs');
    await fs.mkdir(invalidRecsDir, { recursive: true });
    let invalidRejected = false;
    let invalidErr = '';
    try {
      await recordSession({
        seconds: 1,
        fps: 30,
        outputIdx: 9,
        baseDir: invalidRecsDir,
      });
    } catch (err: any) {
      invalidRejected = true;
      invalidErr = err?.message ?? String(err);
    }
    const leftovers = await fs.readdir(invalidRecsDir);
    report.invalidDisplayFailFast = {
      status: invalidRejected && leftovers.length === 0 ? 'VERIFIED' : 'FAILED',
      rejected: invalidRejected,
      error: invalidErr,
      leftoverEntries: leftovers.length,
    };

    // 4. Multi-Resolution & Codec Export Matrix (isolated copy of 20261120-175917, 30 frames each)
    const sampleSrc = path.join(rootDir, 'recordings', '20261120-175917');
    if (existsSync(sampleSrc)) {
      const sampleCopy = path.join(tmpRoot, 'sample-session');
      await copyRecursive(sampleSrc, sampleCopy);

      const specs = [
        { name: '1080p @ 60fps H.264', resolution: '1080p', fps: '60', codec: 'h264', file: 'out_1080p60_h264.mp4' },
        { name: '1440p @ 30fps H.264', resolution: '1440p', fps: '30', codec: 'h264', file: 'out_1440p30_h264.mp4' },
        { name: '4K @ 30fps H.264', resolution: '4K', fps: '30', codec: 'h264', file: 'out_4k30_h264.mp4' },
        { name: '1080p @ 30fps HEVC', resolution: '1080p', fps: '30', codec: 'hevc', file: 'out_1080p30_hevc.mp4' },
      ];

      for (const sp of specs) {
        const outFile = path.join(tmpRoot, sp.file);
        const tStart = Date.now();
        const res = runCommand('node', [
          path.join(rootDir, 'scripts', 'export.ts'),
          '--dir',
          sampleCopy,
          '--resolution',
          sp.resolution,
          '--fps',
          sp.fps,
          '--codec',
          sp.codec,
          '--max-frames',
          '30',
          '--out',
          outFile,
        ]);
        const elapsedMs = Date.now() - tStart;
        if (res.ok && existsSync(outFile)) {
          const info = await probeMediaFile(outFile);
          report.exportMatrix.push({
            name: sp.name,
            status: 'VERIFIED',
            elapsedMs,
            width: info.width,
            height: info.height,
            fps: info.fps,
            frameCount: info.frameCount,
            codecName: info.codecName,
            sizeBytes: info.sizeBytes,
          });
        } else {
          report.exportMatrix.push({
            name: sp.name,
            status: 'FAILED',
            elapsedMs,
            stderr: res.stderr || res.stdout,
          });
        }
      }
    }

    // 5. Software Encoder Fallback (libx264 / libx265) & Pure Audio M4A Mix Probe
    const x264Out = path.join(tmpRoot, 'sw_libx264.mp4');
    const x264Run = runCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30',
      '-t', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', x264Out,
    ]);
    const x264Info = x264Run.ok ? await probeMediaFile(x264Out) : null;

    const x265Out = path.join(tmpRoot, 'sw_libx265.mp4');
    const x265Run = runCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30',
      '-t', '1', '-c:v', 'libx265', '-preset', 'veryfast', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', x265Out,
    ]);
    const x265Info = x265Run.ok ? await probeMediaFile(x265Out) : null;

    const wavIn = path.join(tmpRoot, 'tone.wav');
    const m4aOut = path.join(tmpRoot, 'audio_only.m4a');
    const wavRun = runCommand('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wavIn,
    ]);
    let m4aResult: Record<string, unknown> = { status: 'FAILED' };
    if (wavRun.ok) {
      const m4aArgs = buildAudioOnlyM4aArgs(
        [{ path: wavIn, kind: 'system', volume: 0.9, isMuted: false }],
        m4aOut,
        { durationSeconds: 1 }
      );
      if (m4aArgs) {
        const m4aRun = runCommand('ffmpeg', m4aArgs);
        const probeM4a = runCommand('ffprobe', [
          '-v', 'error', '-select_streams', 'a:0',
          '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate:format=duration,size',
          '-of', 'json', m4aOut,
        ]);
        if (m4aRun.ok && probeM4a.ok) {
          m4aResult = {
            status: 'VERIFIED',
            ffprobe: JSON.parse(probeM4a.stdout),
          };
        }
      }
    }

    report.softwareFallbackAndAudio = {
      libx264: x264Info ? { status: 'VERIFIED', width: x264Info.width, height: x264Info.height, fps: x264Info.fps, codecName: x264Info.codecName } : { status: 'FAILED', stderr: x264Run.stderr },
      libx265: x265Info ? { status: 'VERIFIED', width: x265Info.width, height: x265Info.height, fps: x265Info.fps, codecName: x265Info.codecName } : { status: 'FAILED', stderr: x265Run.stderr },
      audioOnlyM4a: m4aResult,
    };

    // 6. Built Desktop Shell Self-Check
    const dogscExe = path.join(rootDir, 'dist', 'DogSC.exe');
    if (existsSync(dogscExe)) {
      const ver = runCommand(dogscExe, ['--version']);
      const chk = runCommand(dogscExe, ['--check', '--root', rootDir]);
      report.desktopShellCheck = {
        status: ver.ok && chk.ok ? 'VERIFIED' : 'FAILED',
        version: ver.ok ? JSON.parse(ver.stdout) : ver.stderr,
        check: chk.ok ? JSON.parse(chk.stdout) : chk.stderr,
      };
    }

    const outJson = JSON.stringify(report, null, 2);
    if (typeof values.out === 'string' && values.out.length > 0) {
      await fs.mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
      await fs.writeFile(path.resolve(values.out), outJson, 'utf8');
    }
    console.log(outJson);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('[DeviceMatrix] 执行失败:', err);
  process.exit(1);
});

