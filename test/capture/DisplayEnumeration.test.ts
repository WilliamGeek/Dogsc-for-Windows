// Test for: F:\dogsc-win\src\capture\DisplayEnumeration.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDisplaysJson } from '../../src/capture/DisplayEnumeration.ts';
import { parsePointerJsonl } from '../../src/capture/PointerJsonl.ts';

test('T12.5: parses mixed-DPI screens, negative coordinates and primary-first ordering', () => {
  const stdout = JSON.stringify([
    {
      DeviceName: '\\\\.\\DISPLAY2',
      Primary: false,
      Bounds: { X: -1920, Y: 0, Width: 1920, Height: 1080 },
    },
    {
      DeviceName: '\\\\.\\DISPLAY1',
      Primary: true,
      Bounds: { X: 0, Y: 0, Width: 2560, Height: 1440 },
    },
    {
      DeviceName: '\\\\.\\DISPLAY3',
      Primary: false,
      Bounds: { X: 2560, Y: 0, Width: 3840, Height: 2160 },
    },
  ]);

  const displays = parseDisplaysJson(stdout);
  assert.equal(displays.length, 3);
  assert.equal(displays[0].index, 0);
  assert.equal(displays[0].isPrimary, true);
  assert.equal(displays[0].width, 2560);
  assert.equal(displays[0].height, 1440);

  assert.equal(displays[1].index, 1);
  assert.equal(displays[1].x, -1920);
  assert.equal(displays[1].width, 1920);
  assert.equal(displays[1].height, 1080);

  assert.equal(displays[2].index, 2);
  assert.equal(displays[2].width, 3840);
  assert.equal(displays[2].height, 2160);
});

test('T12.5: accepts a single PowerShell object and preserves explicit indexes', () => {
  const single = parseDisplaysJson(
    JSON.stringify({
      DeviceName: '\\\\.\\DISPLAY1',
      Primary: true,
      Bounds: { X: 0, Y: 0, Width: 3840, Height: 2160 },
    })
  );
  assert.equal(single.length, 1);
  assert.equal(single[0].index, 0);
  assert.equal(single[0].width, 3840);

  const explicit = parseDisplaysJson(
    JSON.stringify([
      { index: 1, deviceName: 'left', isPrimary: false, x: -1920, y: 0, width: 1920, height: 1080 },
      { index: 0, deviceName: 'primary', isPrimary: true, x: 0, y: 0, width: 2560, height: 1440 },
    ])
  );
  assert.equal(explicit[0].isPrimary, true);
  assert.equal(explicit[0].index, 0);
  assert.equal(explicit[1].index, 1);
  assert.equal(explicit[1].x, -1920);
});

test('T12.5: negative screen coordinates normalize a left-side click correctly', () => {
  const header = JSON.stringify({
    hdr: 1,
    originUnixMs: 1000,
    screen: { x: -1920, y: 0, w: 1920, h: 1080 },
  });
  const event = JSON.stringify({ t: 1.0, x: -1820, y: 100, k: 'leftClick' });
  const parsed = parsePointerJsonl(`${header}\n${event}\n`);

  assert.equal(parsed.events.length, 1);
  assert.ok(Math.abs(parsed.events[0].location.x - 100 / 1920) < 1e-12);
  assert.ok(Math.abs(parsed.events[0].location.y - 100 / 1080) < 1e-12);
});

test('T12.5: rejects malformed display JSON and ignores invalid bounds', () => {
  assert.throws(() => parseDisplaysJson('{not json}'), /JSON/);

  const invalid = parseDisplaysJson(
    JSON.stringify([
      { DeviceName: 'bad', Primary: true, Bounds: { X: 0, Y: 0, Width: 0, Height: 1080 } },
      { DeviceName: 'good', Primary: false, Bounds: { X: 0, Y: 0, Width: 1920, Height: 1080 } },
    ])
  );
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].index, 0);
  assert.equal(invalid[0].width, 1920);
});
