/**
 * web/studio/libraryShell.ts
 *
 * macOS DogSC collapsible Left Library Drawer:
 * - Four tabs: `ai` (AI 助手), `assets` (素材库), `subtitles` (字幕), `motion` (动效)
 * - Coordinates expand/collapse state with `#workspace-mid` and top chrome toggle `#btn-toggle-library`
 */

import { AiAssistantPanel, type LibraryPanelHost } from './aiPanel.ts';
import { AssetsLibraryPanel } from './assetsPanel.ts';
import { SubtitlesLibraryPanel } from './subtitlesPanel.ts';
import { MotionLibraryPanel } from './motionPanel.ts';

export type StudioLibraryTab = 'ai' | 'assets' | 'subtitles' | 'motion';
export type LibrarySubPanelRenderer = (container: HTMLElement, host: LibraryPanelHost) => void;

export class StudioLibraryShell {
  private activeTab: StudioLibraryTab = 'ai';
  private isOpen = true;
  private readonly aiPanel = new AiAssistantPanel();
  private readonly assetsPanel = new AssetsLibraryPanel();
  private readonly subtitlesPanel = new SubtitlesLibraryPanel();
  private readonly motionPanel = new MotionLibraryPanel();
  private customRenderers: Partial<Record<'assets' | 'subtitles' | 'motion', LibrarySubPanelRenderer>> = {};
  private lastHost: LibraryPanelHost | null = null;
  private boundChrome = false;

  registerPanelRenderer(
    tab: 'assets' | 'subtitles' | 'motion',
    renderer: LibrarySubPanelRenderer
  ): void {
    this.customRenderers[tab] = renderer;
    if (this.lastHost && this.activeTab === tab && this.isOpen) {
      this.render(this.lastHost);
    }
  }

  getActiveTab(): StudioLibraryTab {
    return this.activeTab;
  }

  isLibraryOpen(): boolean {
    return this.isOpen;
  }

  setLibraryOpen(open: boolean, host?: LibraryPanelHost): void {
    this.isOpen = open;
    this.syncShellClasses();
    const target = host ?? this.lastHost;
    if (this.isOpen && target) {
      this.render(target);
    }
  }

  toggleOpen(host?: LibraryPanelHost): void {
    this.setLibraryOpen(!this.isOpen, host);
  }

  setActiveTab(tab: StudioLibraryTab, host?: LibraryPanelHost): void {
    this.activeTab = tab;
    if (!this.isOpen) {
      this.isOpen = true;
    }
    this.syncShellClasses();
    const target = host ?? this.lastHost;
    if (target) {
      this.render(target);
    }
  }

  focusAiComposer(host?: LibraryPanelHost): void {
    this.setActiveTab('ai', host);
    window.setTimeout(() => this.aiPanel.focusPrompt(), 20);
  }

  private bindChromeOnce(): void {
    if (this.boundChrome) return;
    this.boundChrome = true;

    document.getElementById('btn-toggle-library')?.addEventListener('click', () => {
      this.toggleOpen();
    });

    document.getElementById('btn-collapse-library')?.addEventListener('click', () => {
      this.setLibraryOpen(false);
    });

    document.querySelectorAll('#studio-library-tabs .lib-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-lib-tab') as StudioLibraryTab | null;
        if (tab) this.setActiveTab(tab);
      });
    });
  }

  private syncShellClasses(): void {
    const mid = document.getElementById('workspace-mid');
    mid?.classList.toggle('library-collapsed', !this.isOpen);

    const toggleBtn = document.getElementById('btn-toggle-library');
    toggleBtn?.classList.toggle('active', this.isOpen);

    document.querySelectorAll('#studio-library-tabs .lib-tab-btn').forEach((btn) => {
      const isMatch = btn.getAttribute('data-lib-tab') === this.activeTab;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });
  }

  render(host: LibraryPanelHost): void {
    this.lastHost = host;
    this.bindChromeOnce();
    this.syncShellClasses();

    if (!this.isOpen) return;
    const body = document.getElementById('studio-library-body');
    if (!body) return;

    if (this.activeTab === 'ai') {
      this.aiPanel.mountOrSync(body, host);
      return;
    }

    if (this.activeTab === 'assets') {
      this.assetsPanel.mountOrSync(body, host);
      return;
    }

    if (this.activeTab === 'subtitles') {
      this.subtitlesPanel.mountOrSync(body, host);
      return;
    }

    if (this.activeTab === 'motion') {
      this.motionPanel.mountOrSync(body, host);
      return;
    }

    const custom = this.customRenderers[this.activeTab];
    if (custom) {
      custom(body, host);
      return;
    }

    const emptyCopy: Record<'assets' | 'subtitles' | 'motion', { title: string; desc: string }> = {
      assets: {
        title: '媒体素材库与内置音效',
        desc: '正在准备素材库模块（T18.3）：导入背景图片/视频、外部音频与合成转场音效将在此显示。',
      },
      subtitles: {
        title: '双语字幕与静音删减',
        desc: '可通过上方「AI 助手」直接用自然语言添加/清洗字幕；可视化字幕与停顿检测面板将在 T18.4 接入。',
      },
      motion: {
        title: 'HTML/SVG 动效贴纸模板',
        desc: '可通过「AI 助手」添加动效卡片；完整模板库与交互微调面板将在 T18.5 接入。',
      },
    };

    const meta = emptyCopy[this.activeTab];
    body.innerHTML = `
      <div class="lib-placeholder-card">
        <div class="lib-placeholder-title">${meta.title}</div>
        <p class="lib-placeholder-desc">${meta.desc}</p>
      </div>
    `;
  }
}
