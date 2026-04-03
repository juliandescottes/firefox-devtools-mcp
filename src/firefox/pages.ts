/**
 * Page/Tab/Window management (Pure BiDi)
 */

import type { FirefoxCore } from './core.js';
import { log } from '../utils/logger.js';

export class PageManagement {
  constructor(
    private core: FirefoxCore,
    private getCurrentContextId: () => string | null,
    private setCurrentContextId: (id: string) => void
  ) {}

  /**
   * Navigate to URL
   */
  async navigate(url: string): Promise<void> {
    const contextId = this.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    await this.core.sendBiDiCommand('browsingContext.navigate', {
      context: contextId,
      url,
      wait: 'complete',
    });

    log(`Navigated to: ${url}`);
  }

  /**
   * Navigate back in history
   */
  async navigateBack(): Promise<void> {
    const contextId = this.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    await this.core.sendBiDiCommand('browsingContext.traverseHistory', {
      context: contextId,
      delta: -1,
    });
  }

  /**
   * Navigate forward in history
   */
  async navigateForward(): Promise<void> {
    const contextId = this.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    await this.core.sendBiDiCommand('browsingContext.traverseHistory', {
      context: contextId,
      delta: 1,
    });
  }

  /**
   * Set viewport size
   */
  async setViewportSize(width: number, height: number): Promise<void> {
    const contextId = this.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    await this.core.sendBiDiCommand('browsingContext.setViewport', {
      context: contextId,
      viewport: { width, height },
    });
  }

  /**
   * Accept dialog (alert/confirm/prompt)
   * @param promptText - Optional text to enter in prompt dialog
   */
  async acceptDialog(promptText?: string): Promise<void> {
    try {
      const contextId = this.getCurrentContextId();
      if (!contextId) {
        throw new Error('No active context');
      }

      await this.core.sendBiDiCommand('browsingContext.handleUserPrompt', {
        context: contextId,
        accept: true,
        userText: promptText,
      });
    } catch (error) {
      throw new Error(
        `Failed to accept dialog: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Dismiss dialog (alert/confirm/prompt)
   */
  async dismissDialog(): Promise<void> {
    try {
      const contextId = this.getCurrentContextId();
      if (!contextId) {
        throw new Error('No active context');
      }

      await this.core.sendBiDiCommand('browsingContext.handleUserPrompt', {
        context: contextId,
        accept: false,
      });
    } catch (error) {
      throw new Error(
        `Failed to dismiss dialog: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private cachedTabs: Array<{ actor: string; title: string; url: string }> = [];
  private cachedSelectedIdx: number = 0;

  /**
   * Get all tabs (window handles)
   */
  getTabs(): Array<{ actor: string; title: string; url: string }> {
    return this.cachedTabs;
  }

  /**
   * Get selected tab index
   */
  getSelectedTabIdx(): number {
    return this.cachedSelectedIdx;
  }

  /**
   * Refresh tabs metadata - fetches all browsing contexts and their URLs/titles
   */
  async refreshTabs(): Promise<void> {
    try {
      const result = await this.core.sendBiDiCommand('browsingContext.getTree', {});
      const contexts = result.contexts || [];

      const currentContextId = this.getCurrentContextId();

      this.cachedTabs = [];
      this.cachedSelectedIdx = 0;

      for (let i = 0; i < contexts.length; i++) {
        const context = contexts[i];

        this.cachedTabs.push({
          actor: context.context,
          title: context.title || 'Untitled',
          url: context.url || 'about:blank',
        });

        // Track which tab is selected
        if (context.context === currentContextId) {
          this.cachedSelectedIdx = i;
        }
      }
    } catch (error) {
      log(`Error refreshing tabs: ${error instanceof Error ? error.message : String(error)}`);
      // Fallback to single tab
      const currentId = this.getCurrentContextId();
      this.cachedTabs = [
        {
          actor: currentId || '',
          title: 'Current Tab',
          url: '',
        },
      ];
      this.cachedSelectedIdx = 0;
    }
  }

  /**
   * Select tab by index
   */
  async selectTab(index: number): Promise<void> {
    const result = await this.core.sendBiDiCommand('browsingContext.getTree', {});
    const contexts = result.contexts || [];

    if (index >= 0 && index < contexts.length) {
      const context = contexts[index];
      this.setCurrentContextId(context.context);
      this.cachedSelectedIdx = index;

      // Optionally activate the context (bring to front)
      try {
        await this.core.sendBiDiCommand('browsingContext.activate', {
          context: context.context,
        });
      } catch (error) {
        // activate may not be supported in all Firefox versions
      }
    }
  }

  /**
   * Create new page (tab)
   */
  async createNewPage(url: string): Promise<number> {
    const result = await this.core.sendBiDiCommand('browsingContext.create', {
      type: 'tab',
    });

    const newContextId = result.context;
    this.setCurrentContextId(newContextId);

    // Navigate to URL
    await this.core.sendBiDiCommand('browsingContext.navigate', {
      context: newContextId,
      url,
      wait: 'complete',
    });

    // Get updated context list to determine index
    const treeResult = await this.core.sendBiDiCommand('browsingContext.getTree', {});
    const contexts = treeResult.contexts || [];

    const newIdx = contexts.findIndex((ctx: any) => ctx.context === newContextId);
    this.cachedSelectedIdx = newIdx >= 0 ? newIdx : contexts.length - 1;

    return this.cachedSelectedIdx;
  }

  /**
   * Close tab by index
   */
  async closeTab(index: number): Promise<void> {
    const result = await this.core.sendBiDiCommand('browsingContext.getTree', {});
    const contexts = result.contexts || [];

    if (index >= 0 && index < contexts.length) {
      const contextToClose = contexts[index];

      await this.core.sendBiDiCommand('browsingContext.close', {
        context: contextToClose.context,
      });

      // Get remaining contexts
      const remaining = await this.core.sendBiDiCommand('browsingContext.getTree', {});
      const remainingContexts = remaining.contexts || [];

      if (remainingContexts.length > 0) {
        this.setCurrentContextId(remainingContexts[0].context);
        this.cachedSelectedIdx = 0;
      }
    }
  }
}
