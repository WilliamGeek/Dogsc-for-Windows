// Test for: F:\dogsc-win\src\server\AiSecrets.ts, AgentBridge.ts, StudioServer AI routes

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getPublicAiSettings,
  getResolvedAiApiKey,
  protectSecretWin,
  saveAiSettings,
  unprotectSecretWin,
  type SecretCryptoAdapter,
} from '../../src/server/AiSecrets.ts';
import {
  executeAgentTools,
  parseLocalIntentCommands,
} from '../../src/server/AgentBridge.ts';
import { startStudioServer } from '../../src/server/StudioServer.ts';
import { makeRecorderProject, encodeRecorderProject } from '../../src/core/ProjectMediaModel.ts';
import { ProjectValidator } from '../../src/core/ProjectValidator.ts';

test('T18.1: Windows DPAPI secret protection encrypts & decrypts roundtrip without plain leak', () => {
  if (process.platform !== 'win32') return;
  const secret = 'sk-dogsc-test-key-987654';
  const encrypted = protectSecretWin(secret);
  assert.ok(encrypted.startsWith('dpapi:'));
  assert.equal(encrypted.includes(secret), false);
  const decrypted = unprotectSecretWin(encrypted);
  assert.equal(decrypted, secret);
});

test('T18.1: AI settings persist encrypted key and never expose plaintext in public payload', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-ai-sec-'));
  const settingsFilePath = path.join(tmpDir, 'ai-settings.json');
  const fakeCrypto: SecretCryptoAdapter = {
    protect: (s) => `enc:${Buffer.from(s).toString('base64')}`,
    unprotect: (c) => Buffer.from(c.slice(4), 'base64').toString('utf8'),
  };

  try {
    const pub = saveAiSettings(
      {
        provider: 'openai',
        baseUrl: 'https://api.example.com/v1/',
        model: 'gpt-4o',
        apiKey: 'sk-1234567890abcdef',
      },
      { settingsFilePath, crypto: fakeCrypto }
    );
    assert.equal(pub.provider, 'openai');
    assert.equal(pub.baseUrl, 'https://api.example.com/v1');
    assert.equal(pub.hasApiKey, true);
    assert.equal(pub.maskedKeyHint, 'sk-1••••cdef');
    assert.equal((pub as any).encryptedApiKey, undefined);

    const diskRaw = await fs.readFile(settingsFilePath, 'utf8');
    assert.equal(diskRaw.includes('sk-1234567890abcdef'), false);

    const roundtripPub = getPublicAiSettings({ settingsFilePath, crypto: fakeCrypto });
    assert.equal(roundtripPub.hasApiKey, true);
    assert.equal(getResolvedAiApiKey({ settingsFilePath, crypto: fakeCrypto }), 'sk-1234567890abcdef');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

test('T18.1: parseLocalIntentCommands & executeAgentTools mutate project validly with zoom, subtitle, motion, and canvas', () => {
  const project = makeRecorderProject({ title: 'AI Test' });
  const prompt = '把比例改成 16:9，圆角调到 32，加上浅色窗口，在 1.5s 到 3.5s 加字幕“核心亮点”，再在 4s 处加 2 倍缩放';
  const calls = parseLocalIntentCommands(prompt, { currentTime: 0.5, outputDuration: 10 });
  assert.ok(calls.length >= 3);

  const outcome = executeAgentTools(project, calls, { rawSourceDuration: 10 });
  ProjectValidator.validate(outcome.project);

  assert.equal(outcome.project.canvas.aspectRatio, '16:9');
  assert.equal(outcome.project.canvas.cornerRadius, 32);
  assert.equal(outcome.project.canvas.screenFrame, 'windowLight');
  assert.equal(outcome.project.timeline.subtitleCues.length, 1);
  assert.equal(outcome.project.timeline.subtitleCues[0].text, '核心亮点');
  assert.equal(outcome.project.timeline.zoomClips.length, 1);
  assert.equal(outcome.project.timeline.zoomClips[0].scale, 2);
  assert.ok(outcome.changes.some((c) => c.label === '画面'));
  assert.ok(outcome.changes.some((c) => c.label === '字幕'));
});

test('T18.1: StudioServer AI chat, bearer-protected command endpoint, and revert turn work end-to-end', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogsc-ai-srv-'));
  const recDir = path.join(tmpDir, 'recordings');
  const sessDir = path.join(recDir, '20261123-180000');
  await fs.mkdir(path.join(sessDir, 'frames'), { recursive: true });
  await fs.writeFile(
    path.join(sessDir, 'meta.json'),
    JSON.stringify({ id: '20261123-180000', fps: 60, width: 1920, height: 1080, durationSeconds: 8 })
  );
  const initialProject = makeRecorderProject({ title: 'Initial AI Session' });
  await fs.writeFile(path.join(sessDir, 'project.json'), encodeRecorderProject(initialProject));

  const rootDir = path.resolve(import.meta.dirname, '..', '..');
  const handle = await startStudioServer({
    rootDir,
    recordingsDir: recDir,
    aiSettingsFilePath: path.join(tmpDir, 'ai-settings.json'),
    allowShellOpen: false,
  });

  try {
    const statusRes = await fetch(`${handle.url.replace('/web/studio.html', '')}/api/ai/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = (await statusRes.json()) as any;
    assert.ok(typeof statusJson.bridgeToken === 'string' && statusJson.bridgeToken.length === 32);

    const baseUrl = handle.url.replace('/web/studio.html', '');

    // External command without bearer token must reject 401
    const unauth = await fetch(`${baseUrl}/api/recordings/20261123-180000/ai/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '把比例改成 9:16' }),
    });
    assert.equal(unauth.status, 401);

    // Authenticated command applies cleanly
    const authCmd = await fetch(`${baseUrl}/api/recordings/20261123-180000/ai/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${statusJson.bridgeToken}`,
      },
      body: JSON.stringify({ prompt: '把比例改成 16:9，圆角设为 40' }),
    });
    assert.equal(authCmd.status, 200);
    const authData = (await authCmd.json()) as any;
    assert.equal(authData.project.canvas.aspectRatio, '16:9');
    assert.equal(authData.project.canvas.cornerRadius, 40);

    // Studio UI chat applies subtitle + zoom and returns turnId for revert
    const chatRes = await fetch(`${baseUrl}/api/recordings/20261123-180000/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '在 1s 到 3s 加字幕“你好世界”',
        currentTime: 1,
      }),
    });
    assert.equal(chatRes.status, 200);
    const chatData = (await chatRes.json()) as any;
    assert.equal(chatData.project.timeline.subtitleCues.length, 1);
    assert.ok(chatData.turnId);

    // Revert restores exact pre-chat project (no subtitle, keeps 16:9 / 40px)
    const revRes = await fetch(`${baseUrl}/api/recordings/20261123-180000/ai/revert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId: chatData.turnId }),
    });
    assert.equal(revRes.status, 200);
    const revData = (await revRes.json()) as any;
    assert.equal(revData.project.timeline.subtitleCues.length, 0);
    assert.equal(revData.project.canvas.aspectRatio, '16:9');
    assert.equal(revData.project.canvas.cornerRadius, 40);
  } finally {
    await handle.close();
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
