// Tests for: WindowEnumeration, ScreenRecorder region/window modes, and RecordingSession geometry

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseWindowsJson } from '../../src/capture/WindowEnumeration.ts';
import { alignEvenRegion, buildFfmpegArgs } from '../../src/capture/ScreenRecorder.ts';
import { resolveSessionCaptureGeometry } from '../../src/capture/RecordingSession.ts';
import type { DisplayDescriptor } from '../../src/capture/DisplayEnumeration.ts';

test('T15.1: alignEvenRegion rounds odd sizes down to even >= 2 and clamps to displayBounds', () => {
  assert.deepEqual(
    alignEvenRegion({ x: 11.7, y: -5, width: 641, height: 363 }),
    { x: 11, y: 0, width: 640, height: 362 }
  );

  // Clamping near bottom-right display edge still keeps even dimensions >= 2
  assert.deepEqual(
    alignEvenRegion({ x: 1800, y: 1000, width: 200, height: 150 }, { width: 1920, height: 1080 }),
    { x: 1800, y: 1000, width: 120, height: 80 }
  );
  assert.deepEqual(
    alignEvenRegion({ x: 1919, y: 1079, width: 10, height: 10 }, { width: 1920, height: 1080 }),
    { x: 1918, y: 1078, width: 2, height: 2 }
  );

  assert.throws(() => alignEvenRegion({ x: 0, y: 0, width: 1, height: 100 }), /至少为 2x2/);
  assert.throws(() => alignEvenRegion({ x: NaN, y: 0, width: 100, height: 100 }), /非有限数字/);
});

test('T15.1: buildFfmpegArgs builds valid ddagrab region and gdigrab window arguments', () => {
  const regionArgs = buildFfmpegArgs({
    outFile: 'region.mp4',
    fps: 60,
    encoder: 'h264_nvenc',
    outputIdx: 1,
    captureMode: 'region',
    region: { x: 100, y: 50, width: 801, height: 601 },
  });
  const regionInputIdx = regionArgs.indexOf('-i');
  assert.ok(regionInputIdx !== -1);
  assert.equal(
    regionArgs[regionInputIdx + 1],
    'ddagrab=output_idx=1:offset_x=100:offset_y=50:video_size=800x600:framerate=60:draw_mouse=0'
  );

  const windowArgs = buildFfmpegArgs({
    outFile: 'win.mp4',
    fps: 30,
    encoder: 'libx264',
    captureMode: 'window',
    windowTitle: 'Visual Studio Code',
    drawMouse: false,
  });
  assert.ok(windowArgs.includes('gdigrab'));
  assert.ok(windowArgs.includes('title=Visual Studio Code'));
  const vfIdx = windowArgs.indexOf('-vf');
  assert.equal(windowArgs[vfIdx + 1], 'pad=ceil(iw/2)*2:ceil(ih/2)*2,showinfo,format=yuv420p');

  assert.throws(
    () => buildFfmpegArgs({ outFile: 'x.mp4', fps: 60, encoder: 'libx264', captureMode: 'region' }),
    /region/
  );
  assert.throws(
    () =>
      buildFfmpegArgs({
        outFile: 'x.mp4',
        fps: 60,
        encoder: 'libx264',
        captureMode: 'window',
        windowTitle: '   ',
      }),
    /windowTitle/
  );
});

test('T15.1: parseWindowsJson handles BOM, single object, negative coords, and filters minimized/empty windows', () => {
  const single = parseWindowsJson(
    '\uFEFF{"Hwnd":"0x123","Title":"Notepad","ProcessName":"notepad","Pid":42,"X":-1920,"Y":40,"Width":800,"Height":600,"IsMinimized":false}'
  );
  assert.equal(single.length, 1);
  assert.equal(single[0].x, -1920);
  assert.equal(single[0].width, 800);

  const array = parseWindowsJson(
    JSON.stringify([
      { hwnd: '0x1', title: 'Valid Window', processName: 'app', pid: 10, x: 10, y: 20, width: 1000, height: 700, isMinimized: false },
      { hwnd: '0x2', title: '', processName: 'hidden', pid: 11, x: 0, y: 0, width: 500, height: 500, isMinimized: false },
      { hwnd: '0x3', title: 'Minimized', processName: 'min', pid: 12, x: 0, y: 0, width: 500, height: 500, isMinimized: true },
      { hwnd: '0x4', title: 'Zero', processName: 'zero', pid: 13, x: 0, y: 0, width: 0, height: 200, isMinimized: false },
    ])
  );
  assert.equal(array.length, 1);
  assert.equal(array[0].hwnd, '0x1');
  assert.throws(() => parseWindowsJson('{bad json'), /窗口枚举 JSON 无效/);
});

test('T15.1: resolveSessionCaptureGeometry aligns multi-monitor region and window hook bounds cleanly', () => {
  const leftDisplay: DisplayDescriptor = {
    index: 1,
    deviceName: '\\\\.\\DISPLAY2',
    isPrimary: false,
    x: -1920,
    y: 0,
    width: 1920,
    height: 1080,
  };

  const regionResolved = resolveSessionCaptureGeometry(leftDisplay, {
    captureMode: 'region',
    region: { x: 100, y: 200, width: 641, height: 481 },
  });
  assert.equal(regionResolved.captureSource, '自选区域');
  assert.deepEqual(regionResolved.alignedRegion, { x: 100, y: 200, width: 640, height: 480 });
  assert.deepEqual(regionResolved.hookBounds, { x: -1820, y: 200, w: 640, h: 480 });
  assert.ok(regionResolved.normalizedArea !== null);
  assert.ok(Math.abs(regionResolved.normalizedArea.width - 640 / 1920) < 1e-6);

  const windowResolved = resolveSessionCaptureGeometry(leftDisplay, {
    captureMode: 'window',
    windowTitle: 'DogSC Editor',
    windowBounds: { x: -1700, y: 120, width: 1280, height: 720 },
  });
  assert.equal(windowResolved.captureSource, '单个窗口');
  assert.equal(windowResolved.windowTitle, 'DogSC Editor');
  assert.deepEqual(windowResolved.hookBounds, { x: -1700, y: 120, w: 1280, h: 720 });
});
