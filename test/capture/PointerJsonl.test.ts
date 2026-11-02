// Test for: F:\dogsc-win\src\capture\PointerJsonl.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePointerJsonl } from '../../src/capture/PointerJsonl.ts';

test('T10.1: 正常 3 行事件解析（含 leftClick，坐标归一化正确）', () => {
  const jsonl = [
    '{"hdr":1,"originUnixMs":1762000000000,"screen":{"x":0,"y":0,"w":1920,"h":1080}}',
    '{"t":0.1,"x":960,"y":540,"k":"move"}',
    '{"t":0.5,"x":480,"y":270,"k":"leftClick"}',
    '{"t":1.0,"x":1440,"y":810,"k":"rightClick"}',
  ].join('\n');

  const result = parsePointerJsonl(jsonl);
  assert.equal(result.originUnixMs, 1762000000000);
  assert.deepEqual(result.screen, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(result.events.length, 3);

  // event 1: move at center (0.5, 0.5)
  assert.equal(result.events[0].time, 0.1);
  assert.equal(result.events[0].kind, 'move');
  assert.ok(Math.abs(result.events[0].location.x - 0.5) < 1e-6);
  assert.ok(Math.abs(result.events[0].location.y - 0.5) < 1e-6);

  // event 2: leftClick at (0.25, 0.25)
  assert.equal(result.events[1].time, 0.5);
  assert.equal(result.events[1].kind, 'leftClick');
  assert.ok(Math.abs(result.events[1].location.x - 0.25) < 1e-6);
  assert.ok(Math.abs(result.events[1].location.y - 0.25) < 1e-6);

  // event 3: rightClick at (0.75, 0.75)
  assert.equal(result.events[2].time, 1.0);
  assert.equal(result.events[2].kind, 'rightClick');
  assert.ok(Math.abs(result.events[2].location.x - 0.75) < 1e-6);
  assert.ok(Math.abs(result.events[2].location.y - 0.75) < 1e-6);
});

test('T10.1: 坏行、空行、非 JSON 文本与未知 k 被忽略', () => {
  const jsonl = [
    '{"hdr":1,"originUnixMs":1762000000000,"screen":{"x":0,"y":0,"w":1000,"h":1000}}',
    '',
    '   ',
    'this is not a json line',
    '{"invalid_json": true',
    '{"t":0.1,"x":100,"y":100,"k":"scroll"}', // unknown k: scroll -> ignored
    '{"t":0.2,"x":200,"y":200,"k":"middleClick"}', // unknown k: middleClick -> ignored
    '{"t":0.3,"x":300,"y":300,"k":"move"}', // valid
    'null',
    '12345',
    '{"t":"invalid_time","x":100,"y":100,"k":"move"}', // invalid t
    '{"t":0.4,"x":400,"y":400,"k":"leftClick"}', // valid
  ].join('\n');

  const result = parsePointerJsonl(jsonl);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].kind, 'move');
  assert.equal(result.events[0].time, 0.3);
  assert.equal(result.events[1].kind, 'leftClick');
  assert.equal(result.events[1].time, 0.4);
});

test('T10.1: 坐标越界被夹到 [0, 1]', () => {
  const jsonl = [
    '{"hdr":1,"originUnixMs":1000,"screen":{"x":0,"y":0,"w":1000,"h":1000}}',
    '{"t":0.1,"x":-500,"y":-200,"k":"move"}', // below 0 -> clamps to 0
    '{"t":0.2,"x":1500,"y":3000,"k":"move"}', // above 1000 -> clamps to 1
  ].join('\n');

  const result = parsePointerJsonl(jsonl);
  assert.equal(result.events.length, 2);

  assert.equal(result.events[0].location.x, 0);
  assert.equal(result.events[0].location.y, 0);

  assert.equal(result.events[1].location.x, 1);
  assert.equal(result.events[1].location.y, 1);
});

test('T10.1: 乱序 t 被稳定排序', () => {
  const jsonl = [
    '{"hdr":1,"originUnixMs":1000,"screen":{"x":0,"y":0,"w":1000,"h":1000}}',
    '{"t":2.5,"x":100,"y":100,"k":"move"}',
    '{"t":0.5,"x":200,"y":200,"k":"move"}',
    '{"t":1.2,"x":300,"y":300,"k":"leftClick"}',
    '{"t":0.1,"x":400,"y":400,"k":"move"}',
    '{"t":1.2,"x":350,"y":350,"k":"move"}', // same t -> stable order
  ].join('\n');

  const result = parsePointerJsonl(jsonl);
  assert.equal(result.events.length, 5);
  const times = result.events.map((e) => e.time);
  assert.deepEqual(times, [0.1, 0.5, 1.2, 1.2, 2.5]);

  // Check stability when timestamps are equal: leftClick was first, move second
  assert.equal(result.events[2].kind, 'leftClick');
  assert.equal(result.events[3].kind, 'move');
});

test('T10.1: screen 偏移（x=1920, w=1920, y=0, h=1080）归一化正确', () => {
  // Screen 2 starts at x=1920 with width=1920
  const jsonl = [
    '{"hdr":1,"originUnixMs":1000,"screen":{"x":1920,"y":0,"w":1920,"h":1080}}',
    '{"t":0.1,"x":1920,"y":0,"k":"move"}', // left-top of screen 2 -> (0, 0)
    '{"t":0.2,"x":2880,"y":540,"k":"leftClick"}', // center of screen 2 -> (0.5, 0.5)
    '{"t":0.3,"x":3840,"y":1080,"k":"move"}', // bottom-right of screen 2 -> (1, 1)
  ].join('\n');

  const result = parsePointerJsonl(jsonl);
  assert.equal(result.events.length, 3);

  assert.ok(Math.abs(result.events[0].location.x - 0.0) < 1e-6);
  assert.ok(Math.abs(result.events[0].location.y - 0.0) < 1e-6);

  assert.ok(Math.abs(result.events[1].location.x - 0.5) < 1e-6);
  assert.ok(Math.abs(result.events[1].location.y - 0.5) < 1e-6);

  assert.ok(Math.abs(result.events[2].location.x - 1.0) < 1e-6);
  assert.ok(Math.abs(result.events[2].location.y - 1.0) < 1e-6);
});

test('T10.1: 无表头抛错', () => {
  assert.throws(
    () => parsePointerJsonl(''),
    /pointer\.jsonl 缺少表头/
  );

  assert.throws(
    () => parsePointerJsonl('{"t":0.1,"x":100,"y":100,"k":"move"}'),
    /pointer\.jsonl 缺少表头/
  );

  assert.throws(
    () => parsePointerJsonl('{"hdr":2,"originUnixMs":1000,"screen":{"x":0,"y":0,"w":100,"h":100}}'),
    /pointer\.jsonl 缺少表头/
  );
});
