/**
 * src/server/AiSecrets.ts
 *
 * Manages Windows-native AI provider configuration & encrypted secret storage:
 * - Uses PowerShell .NET DPAPI (`ProtectedData.Protect` / `CurrentUser` scope, zero `-ExecutionPolicy Bypass`)
 *   as Windows' direct security counterpart to macOS Keychain.
 * - Stores non-sensitive settings + Base64 ciphertext in `%LOCALAPPDATA%\DogSC\ai-settings.json`.
 * - Discovers locally installed AI CLI tools (`codex`, `claude`, `gemini`, `kimi`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import * as os from 'node:os';
import { dirname, join } from 'node:path';

export type AiProviderKind = 'local' | 'openai' | 'gemini' | 'cli';
export type AiCliToolId = 'codex' | 'claude' | 'gemini' | 'kimi';

export interface AiSettingsStored {
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
  cliTool: AiCliToolId | null;
  encryptedApiKey: string | null;
  updatedAt: string;
}

export interface AiSettingsPublic {
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
  cliTool: AiCliToolId | null;
  hasApiKey: boolean;
  maskedKeyHint: string | null;
  updatedAt: string;
}

export interface DiscoveredAiCli {
  id: AiCliToolId;
  label: string;
  installed: boolean;
  path: string | null;
}

export interface SecretCryptoAdapter {
  protect(plainText: string): string;
  unprotect(protectedText: string): string;
}

export interface AiSettingsStoreOptions {
  settingsFilePath?: string;
  crypto?: SecretCryptoAdapter;
}

const DEFAULT_STORED_SETTINGS: AiSettingsStored = {
  provider: 'local',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  cliTool: null,
  encryptedApiKey: null,
  updatedAt: '',
};

export function resolveDefaultAiSettingsPath(): string {
  const localAppData = process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local');
  return join(localAppData, 'DogSC', 'ai-settings.json');
}

/**
 * Encrypts a secret for the current Windows user via .NET DPAPI (`CurrentUser` scope)
 * piped through stdin (never leaking keys in command-line arguments or using `-ExecutionPolicy Bypass`).
 */
export function protectSecretWin(plainText: string): string {
  if (!plainText) return '';
  if (process.platform !== 'win32') {
    return 'plain-b64:' + Buffer.from(plainText, 'utf8').toString('base64');
  }
  const psScript = [
    'Add-Type -AssemblyName System.Security',
    '[Console]::InputEncoding = [Text.Encoding]::UTF8',
    '$raw = [Console]::In.ReadToEnd()',
    '$bytes = [Text.Encoding]::UTF8.GetBytes($raw)',
    '$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Convert]::ToBase64String($enc)',
  ].join('; ');

  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
    input: plainText,
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
  });
  return 'dpapi:' + out.trim();
}

export function unprotectSecretWin(protectedPayload: string): string {
  if (!protectedPayload) return '';
  if (protectedPayload.startsWith('plain-b64:')) {
    return Buffer.from(protectedPayload.slice('plain-b64:'.length), 'base64').toString('utf8');
  }
  const b64 = protectedPayload.startsWith('dpapi:')
    ? protectedPayload.slice('dpapi:'.length)
    : protectedPayload;
  if (process.platform !== 'win32') {
    throw new Error('DPAPI secret decryption requires Windows');
  }

  const psScript = [
    'Add-Type -AssemblyName System.Security',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$b64 = [Console]::In.ReadToEnd().Trim()',
    '$enc = [Convert]::FromBase64String($b64)',
    '$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))',
  ].join('; ');

  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
    input: b64,
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
  });
  return out;
}

const DEFAULT_CRYPTO: SecretCryptoAdapter = {
  protect: protectSecretWin,
  unprotect: unprotectSecretWin,
};

function maskSecretHint(secret: string | null): string | null {
  if (!secret) return null;
  if (secret.length <= 6) return '••••••';
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

export function loadStoredAiSettings(options: AiSettingsStoreOptions = {}): AiSettingsStored {
  const filePath = options.settingsFilePath ?? resolveDefaultAiSettingsPath();
  if (!existsSync(filePath)) {
    return { ...DEFAULT_STORED_SETTINGS };
  }
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<AiSettingsStored>;
    const provider: AiProviderKind =
      raw.provider === 'openai' ||
      raw.provider === 'gemini' ||
      raw.provider === 'cli' ||
      raw.provider === 'local'
        ? raw.provider
        : 'local';
    const cliTool: AiCliToolId | null =
      raw.cliTool === 'codex' ||
      raw.cliTool === 'claude' ||
      raw.cliTool === 'gemini' ||
      raw.cliTool === 'kimi'
        ? raw.cliTool
        : null;
    return {
      provider,
      baseUrl:
        typeof raw.baseUrl === 'string' && raw.baseUrl.trim()
          ? raw.baseUrl.trim()
          : DEFAULT_STORED_SETTINGS.baseUrl,
      model:
        typeof raw.model === 'string' && raw.model.trim()
          ? raw.model.trim()
          : DEFAULT_STORED_SETTINGS.model,
      cliTool,
      encryptedApiKey: typeof raw.encryptedApiKey === 'string' ? raw.encryptedApiKey : null,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    };
  } catch {
    return { ...DEFAULT_STORED_SETTINGS };
  }
}

export function getPublicAiSettings(options: AiSettingsStoreOptions = {}): AiSettingsPublic {
  const stored = loadStoredAiSettings(options);
  const resolved = getResolvedAiApiKey(options);
  return {
    provider: stored.provider,
    baseUrl: stored.baseUrl,
    model: stored.model,
    cliTool: stored.cliTool,
    hasApiKey: Boolean(stored.encryptedApiKey),
    maskedKeyHint: maskSecretHint(resolved),
    updatedAt: stored.updatedAt,
  };
}

export function getResolvedAiApiKey(options: AiSettingsStoreOptions = {}): string | null {
  const stored = loadStoredAiSettings(options);
  if (!stored.encryptedApiKey) return null;
  const crypto = options.crypto ?? DEFAULT_CRYPTO;
  try {
    const plain = crypto.unprotect(stored.encryptedApiKey);
    return plain.length > 0 ? plain : null;
  } catch {
    return null;
  }
}

export function saveAiSettings(
  patch: {
    provider?: AiProviderKind;
    baseUrl?: string;
    model?: string;
    cliTool?: AiCliToolId | null;
    apiKey?: string | null;
    clearApiKey?: boolean;
  },
  options: AiSettingsStoreOptions = {}
): AiSettingsPublic {
  const current = loadStoredAiSettings(options);
  const crypto = options.crypto ?? DEFAULT_CRYPTO;
  const filePath = options.settingsFilePath ?? resolveDefaultAiSettingsPath();

  let encryptedApiKey = current.encryptedApiKey;
  if (patch.clearApiKey) {
    encryptedApiKey = null;
  } else if (typeof patch.apiKey === 'string' && patch.apiKey.trim().length > 0) {
    encryptedApiKey = crypto.protect(patch.apiKey.trim());
  }

  const nextProvider: AiProviderKind =
    patch.provider === 'openai' ||
    patch.provider === 'gemini' ||
    patch.provider === 'cli' ||
    patch.provider === 'local'
      ? patch.provider
      : current.provider;

  const defaultBaseUrl =
    nextProvider === 'gemini'
      ? 'https://generativelanguage.googleapis.com/v1beta'
      : 'https://api.openai.com/v1';

  const nextStored: AiSettingsStored = {
    provider: nextProvider,
    baseUrl:
      typeof patch.baseUrl === 'string' && patch.baseUrl.trim()
        ? patch.baseUrl.trim().replace(/\/+$/, '')
        : patch.provider && patch.provider !== current.provider && !patch.baseUrl
          ? defaultBaseUrl
          : current.baseUrl,
    model:
      typeof patch.model === 'string' && patch.model.trim()
        ? patch.model.trim()
        : patch.provider === 'gemini' && current.model === 'gpt-4o-mini'
          ? 'gemini-2.5-flash'
          : current.model,
    cliTool: patch.cliTool !== undefined ? patch.cliTool : current.cliTool,
    encryptedApiKey,
    updatedAt: new Date().toISOString(),
  };

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(nextStored, null, 2), 'utf8');
  return getPublicAiSettings(options);
}

const CLI_DEFS: ReadonlyArray<{ id: AiCliToolId; label: string }> = [
  { id: 'codex', label: 'Codex CLI' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'gemini', label: 'Gemini CLI' },
  { id: 'kimi', label: 'Kimi CLI' },
];

export function discoverInstalledAiClis(): DiscoveredAiCli[] {
  const npmBin = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '';
  const localProg = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : '';

  return CLI_DEFS.map(({ id, label }) => {
    let foundPath: string | null = null;
    if (npmBin) {
      for (const suffix of ['.cmd', '.exe', '']) {
        const candidate = join(npmBin, `${id}${suffix}`);
        if (existsSync(candidate)) {
          foundPath = candidate;
          break;
        }
      }
    }
    if (!foundPath && localProg) {
      const candidate = join(localProg, id, `${id}.exe`);
      if (existsSync(candidate)) foundPath = candidate;
    }
    if (!foundPath && process.platform === 'win32') {
      const probe = spawnSync('where.exe', [id], {
        encoding: 'utf8',
        timeout: 1500,
        windowsHide: true,
      });
      if (probe.status === 0 && probe.stdout) {
        const firstLine = probe.stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
        if (firstLine && existsSync(firstLine.trim())) {
          foundPath = firstLine.trim();
        }
      }
    }
    return { id, label, installed: Boolean(foundPath), path: foundPath };
  });
}
