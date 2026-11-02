// Test for: F:\dogsc-win\src\capture\MouseHook.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMouseHookCommand,
  getDefaultMouseHookScriptPath,
  startMouseHook,
} from '../../src/capture/MouseHook.ts';

test('T10.2: buildMouseHookCommand constructs safe command without Bypass', () => {
  const cmdDefault = buildMouseHookCommand();
  assert.equal(cmdDefault.command, 'powershell.exe');
  assert.ok(cmdDefault.args.includes('-NoProfile'));
  assert.ok(cmdDefault.args.includes('-File'));
  assert.equal(cmdDefault.args[cmdDefault.args.indexOf('-File') + 1], getDefaultMouseHookScriptPath());

  // Strict check per CONTRACTS §5: NO Bypass or -ExecutionPolicy in arguments
  for (const arg of cmdDefault.args) {
    assert.ok(!arg.toLowerCase().includes('bypass'), `Argument must not contain bypass: ${arg}`);
    assert.ok(!arg.toLowerCase().includes('executionpolicy'), `Argument must not alter execution policy: ${arg}`);
  }

  // Custom script path
  const custom = buildMouseHookCommand('C:\\custom\\hook.ps1');
  assert.equal(custom.command, 'powershell.exe');
  assert.equal(custom.args[custom.args.indexOf('-File') + 1], 'C:\\custom\\hook.ps1');
});

test(
  'T10.2: E2E startMouseHook starts real PowerShell hook, receives header, and stops cleanly',
  { skip: !process.env.DOGSC_E2E },
  async () => {
    const hook = startMouseHook();
    let headerReceived = false;

    try {
      for await (const line of hook.lines) {
        const parsed = JSON.parse(line);
        if (parsed.hdr === 1) {
          assert.equal(parsed.hdr, 1);
          assert.ok(typeof parsed.originUnixMs === 'number' && parsed.originUnixMs > 0);
          assert.ok(parsed.screen && parsed.screen.w > 0 && parsed.screen.h > 0);
          headerReceived = true;
          break;
        }
      }
    } finally {
      await hook.stop();
    }

    assert.ok(headerReceived, 'Header line was successfully received from mouse hook');
    assert.ok(hook.process.exitCode !== null || hook.process.killed, 'Mouse hook process exited');
  }
);
