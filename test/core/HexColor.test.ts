import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeHexColor, parseHexColor, hexColorString, hexColorComponents,
  hexColorFromJSON, hexColorToJSON, HexColorDefaultBackground,
} from '../../src/core/HexColor.ts';

test('strict parsing', () => {
  assert.equal(parseHexColor('  #2d3342 ')?.rgb24, 0x2d3342);
  assert.equal(parseHexColor('FFFFFF')?.rgb24, 0xffffff);
  assert.equal(parseHexColor('#FFF'), null);
  assert.equal(parseHexColor('#GG0000'), null);
  assert.equal(parseHexColor('##FFFFFF'), null);
});

test('string, components and JSON round trip', () => {
  assert.equal(hexColorString(makeHexColor(0x0a0b0c)), '#0A0B0C');
  assert.deepEqual(hexColorComponents(makeHexColor(0xff0000)), { red: 1, green: 0, blue: 0 });
  assert.equal(hexColorToJSON(HexColorDefaultBackground), '#2D3342');
  assert.equal(hexColorFromJSON('#2D3342').rgb24, 0x2d3342);
  assert.throws(() => hexColorFromJSON(123));
  assert.throws(() => makeHexColor(0x1000000));
});
