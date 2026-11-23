/**
 * web/studio/aiPanel.ts
 *
 * macOS DogSC `AgentChat` + `AgentBridge` Windows UI counterpart:
 * - Natural-language AI editing chat with quick prompt chips, structured step links & change diffs
 * - Per-turn `撤销此轮` snapshot revert + `Ctrl+Z` compatibility
 * - Collapsible Windows DPAPI API key setup & local AI CLI discovery (`codex`, `claude`, `gemini`, `kimi`)
 * - Local Agent Bridge status & 1-click copy instructions (`Bearer <32-hex>`)
 */

import type { RecorderProject } from '../../src/core/ProjectMediaModel.ts';

export type AiProviderKind = 'local' | 'openai' | 'gemini' | 'cli';
export type AiCliToolId = 'codex' | 'claude' | 'gemini' | 'kimi';

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

export interface AiStatusPayload {
  ok: boolean;
  bridgeToken: string;
  port: number;
  settings: AiSettingsPublic;
  clis: DiscoveredAiCli[];
  instructions: string;
}

export interface AiEditStep {
  title: string;
  detail: string;
  timeSeconds?: number;
}

export interface AiChangeSummary {
  label: string;
  value: string;
}

export interface AiChatTurnEntry {
  turnId: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  steps?: AiEditStep[];
  changes?: AiChangeSummary[];
  canRevert?: boolean;
  reverted?: boolean;
}

export interface LibraryPanelHost {
  getSessionId(): string | null;
  getProject(): RecorderProject | null;
  getRawDuration(): number;
  getCurrentTime(): number;
  getOutputDuration(): number;
  seekTo(timeSeconds: number): void;
  persistProject(): Promise<boolean>;
  applyExternalProject(rawProject: unknown, pushUndo?: boolean): void;
  mutateProject(next: RecorderProject, opts?: { immediate?: boolean }): void;
  reloadRecording(): Promise<void>;
  refreshViews(): void;
}

function escapeHtml(text: string): string {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const whole = Math.floor(r);
  const tenth = Math.round((r - whole) * 10);
  if (tenth > 0 && tenth < 10) {
    return `${m}:${String(whole).padStart(2, '0')}.${tenth}`;
  }
  return `${m}:${String(Math.round(r)).padStart(2, '0')}`;
}

function providerLabel(settings: AiSettingsPublic | null): string {
  if (!settings) return '本地规则引擎';
  switch (settings.provider) {
    case 'openai':
      return `OpenAI · ${settings.model}`;
    case 'gemini':
      return `Gemini · ${settings.model}`;
    case 'cli':
      return settings.cliTool ? `CLI · ${settings.cliTool}` : '本地 AI CLI';
    default:
      return '本地规则引擎';
  }
}

const QUICK_PROMPTS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: '16:9 + 浅色窗口 + 圆角32', prompt: '把比例改成 16:9，加上浅色窗口，圆角调到 32' },
  { label: '当前位置加 2× 缩放', prompt: '在当前时间添加 2 倍缩放' },
  { label: '极光背景 + 重点字幕', prompt: '换成极光流体星云背景，并从当前位置加字幕“核心功能演示”' },
  { label: '清理字幕并设 4K60', prompt: '清理字幕并设置 4K 60fps 导出' },
];

export class AiAssistantPanel {
  private container: HTMLElement | null = null;
  private host: LibraryPanelHost | null = null;
  private status: AiStatusPayload | null = null;
  private history: AiChatTurnEntry[] = [];
  private loadedSessionId: string | null = null;
  private setupOpen = false;
  private busy = false;
  private noticeText: string | null = null;
  private noticeError = false;
  private draftPrompt = '';
  private selectedSetupProvider: AiProviderKind | null = null;

  mountOrSync(container: HTMLElement, host: LibraryPanelHost): void {
    this.container = container;
    this.host = host;

    const sessionId = host.getSessionId();
    if (!this.status) {
      void this.fetchStatus();
    }
    if (sessionId !== this.loadedSessionId) {
      this.loadedSessionId = sessionId;
      this.history = [];
      this.noticeText = null;
      if (sessionId) {
        void this.fetchHistory(sessionId);
      }
    }

    // Preserve active textarea typing if already mounted inside the same container
    const existingInput = container.querySelector('#ai-prompt-input') as HTMLTextAreaElement | null;
    if (existingInput) {
      this.draftPrompt = existingInput.value;
      if (document.activeElement === existingInput) {
        return;
      }
    }

    this.render();
  }

  focusPrompt(): void {
    const input = this.container?.querySelector('#ai-prompt-input') as HTMLTextAreaElement | null;
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  async fetchStatus(): Promise<void> {
    try {
      const res = await fetch('/api/ai/status', { cache: 'no-store' });
      if (!res.ok) return;
      this.status = (await res.json()) as AiStatusPayload;
      this.selectedSetupProvider = this.status.settings.provider;
      this.render();
    } catch {
      // Ignore transient load error
    }
  }

  async fetchHistory(sessionId: string): Promise<void> {
    try {
      const res = await fetch(`/api/recordings/${encodeURIComponent(sessionId)}/ai/history`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { history?: AiChatTurnEntry[] };
      if (this.loadedSessionId !== sessionId) return;
      this.history = Array.isArray(data.history) ? data.history : [];
      this.render();
    } catch {
      // Ignore transient history error
    }
  }

  private render(): void {
    if (!this.container || !this.host) return;
    const sessionId = this.host.getSessionId();
    const settings = this.status?.settings ?? null;
    const effectiveProvider: AiProviderKind =
      this.selectedSetupProvider ?? settings?.provider ?? 'local';
    const port = this.status?.port ?? 0;
    const tokenHint = this.status?.bridgeToken
      ? `${this.status.bridgeToken.slice(0, 6)}••••${this.status.bridgeToken.slice(-4)}`
      : '等待就绪';

    const clis = this.status?.clis ?? [];
    const cliMarkup = clis
      .map(
        (c) =>
          `<span class="ai-cli-pill ${c.installed ? 'installed' : ''}" title="${escapeHtml(
            c.path ?? '未在 PATH 中检测到'
          )}"><span class="ai-dot"></span>${escapeHtml(c.label)}</span>`
      )
      .join('');

    const setupHtml = this.setupOpen
      ? `
      <form class="ai-setup-card" autocomplete="off" onsubmit="return false;">
        <div class="insp-row">
          <label class="insp-label" for="ai-provider-select">推理引擎</label>
          <select id="ai-provider-select" name="aiProvider" class="chrome-select ai-select">
            <option value="local" ${effectiveProvider === 'local' ? 'selected' : ''}>本地离线规则引擎</option>
            <option value="openai" ${effectiveProvider === 'openai' ? 'selected' : ''}>OpenAI 兼容接口</option>
            <option value="gemini" ${effectiveProvider === 'gemini' ? 'selected' : ''}>Google Gemini API</option>
            <option value="cli" ${effectiveProvider === 'cli' ? 'selected' : ''}>本机 AI CLI 桥接</option>
          </select>
        </div>

        ${
          effectiveProvider === 'openai' || effectiveProvider === 'gemini'
            ? `
        <div class="ai-field-col">
          <label class="ai-field-label" for="ai-base-url">API Base URL</label>
          <input id="ai-base-url" name="aiBaseUrl" class="ai-input" type="text" autocomplete="off" value="${escapeHtml(
            settings?.baseUrl ??
              (effectiveProvider === 'gemini'
                ? 'https://generativelanguage.googleapis.com/v1beta'
                : 'https://api.openai.com/v1')
          )}" />
        </div>
        <div class="ai-field-col">
          <label class="ai-field-label" for="ai-model-name">模型名称</label>
          <input id="ai-model-name" name="aiModel" class="ai-input" type="text" autocomplete="off" value="${escapeHtml(
            settings?.model ?? (effectiveProvider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini')
          )}" />
        </div>
        <div class="ai-field-col">
          <label class="ai-field-label" for="ai-api-key">API Key（Windows DPAPI 加密）</label>
          <input id="ai-api-key" name="aiApiKey" class="ai-input" type="password" autocomplete="new-password" placeholder="${escapeHtml(
            settings?.hasApiKey
              ? `已保存 (${settings.maskedKeyHint ?? '••••'})，留空不变`
              : '输入密钥，DPAPI 用户态加密存储'
          )}" />
        </div>
        `
            : ''
        }

        ${
          effectiveProvider === 'cli'
            ? `
        <div class="ai-field-col">
          <label class="ai-field-label" for="ai-cli-select">选择本机 CLI 代理</label>
          <select id="ai-cli-select" name="aiCliTool" class="chrome-select ai-select">
            <option value="">自动（Agent Bridge 被动接管）</option>
            ${clis
              .map(
                (c) =>
                  `<option value="${c.id}" ${settings?.cliTool === c.id ? 'selected' : ''}>${escapeHtml(
                    c.label + (c.installed ? '（已检测到）' : '（未检测到）')
                  )}</option>`
              )
              .join('')}
          </select>
        </div>
        `
            : ''
        }

        <div class="ai-setup-actions">
          <button type="button" id="ai-save-settings-btn" class="chrome-btn subtle-well">保存配置</button>
          ${
            settings?.hasApiKey
              ? `<button type="button" id="ai-clear-key-btn" class="chrome-btn">清除密钥</button>`
              : ''
          }
        </div>

        <div class="ai-bridge-box">
          <div class="ai-bridge-head">
            <span>本地 Agent Bridge</span>
            <span class="ai-token-code">127.0.0.1:${port}</span>
          </div>
          <div class="ai-bridge-meta">Token: <code>${escapeHtml(tokenHint)}</code></div>
          ${cliMarkup ? `<div class="ai-cli-row">${cliMarkup}</div>` : ''}
          <button type="button" id="ai-copy-bridge-btn" class="chrome-btn subtle-well" style="width:100%">复制外部 Agent 接入指令</button>
        </div>
      </form>`
      : '';

    const streamHtml =
      this.history.length === 0
        ? `
      <div class="ai-welcome-card">
        <div class="ai-welcome-title">AI 智能剪辑助手</div>
        <p class="ai-welcome-desc">用自然语言调整画幅比例、圆角、外框、缩放关键帧、双语字幕、动效贴纸与导出规格。所有修改均经校验并支持单轮一键回撤。</p>
        <div class="ai-welcome-sec">密钥采用 Windows DPAPI 用户态加密保存于本机。</div>
      </div>`
        : this.history
            .map((entry) => {
              if (entry.role === 'user') {
                return `<div class="ai-msg ai-msg-user"><div class="ai-msg-text">${escapeHtml(
                  entry.text
                )}</div></div>`;
              }
              const stepsHtml =
                entry.steps && entry.steps.length > 0
                  ? `<div class="ai-steps-list">${entry.steps
                      .map((st) => {
                        const clk =
                          typeof st.timeSeconds === 'number'
                            ? `<button class="ai-step-time" data-seek-sec="${st.timeSeconds.toFixed(
                                3
                              )}" title="跳转至此时间点">${formatClock(st.timeSeconds)}</button>`
                            : '';
                        return `<div class="ai-step-item">${clk}<span class="ai-step-title">${escapeHtml(
                          st.title
                        )}</span><span class="ai-step-detail">${escapeHtml(st.detail)}</span></div>`;
                      })
                      .join('')}</div>`
                  : '';

              const changesHtml =
                entry.changes && entry.changes.length > 0
                  ? `<div class="ai-changes-row">${entry.changes
                      .map(
                        (ch) =>
                          `<span class="ai-change-chip"><strong>${escapeHtml(
                            ch.label
                          )}</strong> ${escapeHtml(ch.value)}</span>`
                      )
                      .join('')}</div>`
                  : '';

              const footerHtml = entry.reverted
                ? `<div class="ai-turn-footer"><span class="ai-reverted-pill">已撤销此轮修改</span></div>`
                : entry.canRevert
                  ? `<div class="ai-turn-footer"><button class="chrome-btn ai-revert-btn" data-revert-turn="${escapeHtml(
                      entry.turnId
                    )}" ${this.busy ? 'disabled' : ''}>撤销此轮</button></div>`
                  : '';

              return `
                <div class="ai-msg ai-msg-assistant ${entry.reverted ? 'is-reverted' : ''}">
                  <div class="ai-msg-text">${escapeHtml(entry.text)}</div>
                  ${stepsHtml}
                  ${changesHtml}
                  ${footerHtml}
                </div>`;
            })
            .join('');

    const chipsHtml = QUICK_PROMPTS.map(
      (q) =>
        `<button class="ai-chip-btn" data-ai-prompt="${escapeHtml(q.prompt)}" ${
          !sessionId || this.busy ? 'disabled' : ''
        }>${escapeHtml(q.label)}</button>`
    ).join('');

    this.container.innerHTML = `
      <div class="ai-panel-root">
        <div class="ai-status-bar">
          <div class="ai-status-badges">
            <span class="ai-provider-badge">${escapeHtml(providerLabel(settings))}</span>
            <span class="ai-bridge-badge" title="本地 Agent Bridge 服务端口">Bridge :${port || '—'}</span>
          </div>
          <button id="ai-toggle-setup" class="chrome-btn ${this.setupOpen ? 'active' : ''}" aria-expanded="${
            this.setupOpen ? 'true' : 'false'
          }">配置</button>
        </div>

        ${
          this.noticeText
            ? `<div class="ai-notice-banner ${this.noticeError ? 'is-err' : ''}">${escapeHtml(
                this.noticeText
              )}</div>`
            : ''
        }

        ${setupHtml}

        <div class="ai-chat-stream" id="ai-chat-stream">
          ${streamHtml}
        </div>

        <div class="ai-chips-bar">
          ${chipsHtml}
        </div>

        <div class="ai-composer">
          <textarea id="ai-prompt-input" class="ai-composer-input" rows="2" placeholder="${
            sessionId
              ? '描述剪辑指令，如：把比例改成16:9，在2s加字幕“核心演示”…'
              : '请先选择或新建一段录制…'
          }" ${!sessionId || this.busy ? 'disabled' : ''}>${escapeHtml(this.draftPrompt)}</textarea>
          <div class="ai-composer-actions">
            <span class="ai-composer-hint">Enter 发送 · Ctrl+K 聚焦</span>
            <button id="ai-send-btn" class="primary-export-btn ai-send-btn" ${
              !sessionId || this.busy ? 'disabled' : ''
            }>${this.busy ? '执行中…' : '发送'}</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    const stream = this.container.querySelector('#ai-chat-stream') as HTMLElement | null;
    if (stream) {
      stream.scrollTop = stream.scrollHeight;
    }
  }

  private bindEvents(): void {
    if (!this.container) return;

    this.container.querySelector('#ai-toggle-setup')?.addEventListener('click', () => {
      this.setupOpen = !this.setupOpen;
      this.render();
    });

    const providerSel = this.container.querySelector('#ai-provider-select') as HTMLSelectElement | null;
    providerSel?.addEventListener('change', () => {
      this.selectedSetupProvider = providerSel.value as AiProviderKind;
      this.render();
    });

    this.container.querySelector('#ai-save-settings-btn')?.addEventListener('click', () => {
      void this.handleSaveSettings();
    });

    this.container.querySelector('#ai-clear-key-btn')?.addEventListener('click', () => {
      void this.handleClearKey();
    });

    this.container.querySelector('#ai-copy-bridge-btn')?.addEventListener('click', () => {
      void this.handleCopyBridgeInstructions();
    });

    this.container.querySelectorAll('.ai-chip-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-ai-prompt');
        if (p) void this.sendPrompt(p);
      });
    });

    this.container.querySelectorAll('.ai-step-time').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sec = Number(btn.getAttribute('data-seek-sec'));
        if (Number.isFinite(sec)) {
          this.host?.seekTo(sec);
        }
      });
    });

    this.container.querySelectorAll('.ai-revert-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const turnId = btn.getAttribute('data-revert-turn');
        if (turnId) void this.revertTurn(turnId);
      });
    });

    const input = this.container.querySelector('#ai-prompt-input') as HTMLTextAreaElement | null;
    input?.addEventListener('input', () => {
      this.draftPrompt = input.value;
    });
    input?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        void this.sendPrompt(input.value);
      }
    });

    this.container.querySelector('#ai-send-btn')?.addEventListener('click', () => {
      const val = input?.value ?? this.draftPrompt;
      void this.sendPrompt(val);
    });
  }

  private async handleSaveSettings(): Promise<void> {
    if (!this.container) return;
    const provider =
      ((this.container.querySelector('#ai-provider-select') as HTMLSelectElement | null)?.value as AiProviderKind) ??
      'local';
    const baseUrl =
      (this.container.querySelector('#ai-base-url') as HTMLInputElement | null)?.value?.trim() ?? undefined;
    const model =
      (this.container.querySelector('#ai-model-name') as HTMLInputElement | null)?.value?.trim() ?? undefined;
    const apiKey =
      (this.container.querySelector('#ai-api-key') as HTMLInputElement | null)?.value ?? '';
    const cliVal =
      (this.container.querySelector('#ai-cli-select') as HTMLSelectElement | null)?.value ?? undefined;

    try {
      const res = await fetch('/api/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          baseUrl,
          model,
          cliTool: cliVal === undefined ? undefined : cliVal ? (cliVal as AiCliToolId) : null,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      if (this.status) {
        this.status.settings = data.settings;
        this.status.clis = data.clis ?? this.status.clis;
      }
      this.selectedSetupProvider = data.settings.provider;
      this.noticeText = 'AI 配置已安全保存（API Key 经 DPAPI 加密）。';
      this.noticeError = false;
      this.render();
    } catch (err: any) {
      this.noticeText = `保存失败: ${err?.message ?? err}`;
      this.noticeError = true;
      this.render();
    }
  }

  private async handleClearKey(): Promise<void> {
    try {
      const res = await fetch('/api/ai/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearApiKey: true }),
      });
      const data = await res.json();
      if (this.status && data.settings) {
        this.status.settings = data.settings;
      }
      this.noticeText = '已清除本地加密保存的 API Key。';
      this.noticeError = false;
      this.render();
    } catch (err: any) {
      this.noticeText = `清除失败: ${err?.message ?? err}`;
      this.noticeError = true;
      this.render();
    }
  }

  private async handleCopyBridgeInstructions(): Promise<void> {
    if (!this.status?.instructions) return;
    try {
      await navigator.clipboard.writeText(this.status.instructions);
      this.noticeText = '已复制本地 Agent Bridge 接入说明与 Bearer Token。';
      this.noticeError = false;
      this.render();
    } catch {
      this.noticeText = `Port ${this.status.port} · Token: ${this.status.bridgeToken}`;
      this.noticeError = false;
      this.render();
    }
  }

  async sendPrompt(rawPrompt: string): Promise<void> {
    if (!this.host || this.busy) return;
    const sessionId = this.host.getSessionId();
    const prompt = rawPrompt.trim();
    if (!sessionId || !prompt) return;

    this.busy = true;
    this.noticeText = null;
    this.draftPrompt = '';
    this.render();

    try {
      await this.host.persistProject();
      const res = await fetch(`/api/recordings/${encodeURIComponent(sessionId)}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          currentTime: this.host.getCurrentTime(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      if (Array.isArray(data.history)) {
        this.history = data.history;
      }
      if (data.project) {
        this.host.applyExternalProject(data.project, true);
      }
    } catch (err: any) {
      this.draftPrompt = prompt;
      this.noticeText = `执行失败: ${err?.message ?? err}`;
      this.noticeError = true;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async revertTurn(turnId: string): Promise<void> {
    if (!this.host || this.busy) return;
    const sessionId = this.host.getSessionId();
    if (!sessionId) return;

    this.busy = true;
    this.noticeText = null;
    this.render();

    try {
      const res = await fetch(`/api/recordings/${encodeURIComponent(sessionId)}/ai/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      if (Array.isArray(data.history)) {
        this.history = data.history;
      }
      if (data.project) {
        this.host.applyExternalProject(data.project, false);
      }
      this.noticeText = '已精确回撤该轮 AI 修改。';
      this.noticeError = false;
    } catch (err: any) {
      this.noticeText = `回撤失败: ${err?.message ?? err}`;
      this.noticeError = true;
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

