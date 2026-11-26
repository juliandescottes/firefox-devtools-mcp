/**
 * Page/Tab/Window management
 */

import { randomUUID } from 'node:crypto';
import type { BrowsingContext, Script } from 'webdriver-bidi-protocol';
import { CreateType, ReadinessState, type BiDiFacade } from './bidi.js';
import { log, logDebug } from '../utils/logger.js';
import { BiDiTimeoutError } from '../utils/errors.js';

const COMMON_URL_SCHEMES = ['http:', 'https:', 'data:', 'blob:', 'file:'];
const PAGES_SANDBOX = 'page-management';
// script.evaluate cannot answer while the content process is busy, so a hung tab must not block the whole tab list
const TITLE_TIMEOUT_MS = 1000;
// Set in the sandbox before a history traversal, to detect when another document is active
const HISTORY_MARKER = '__mcpHistoryMarker';
// Set by a popstate listener in the sandbox, to detect same-document traversals
const HISTORY_POPSTATE = '__mcpHistoryPopstate';
// A hung page must not block navigating away from it
const HISTORY_EVALUATE_TIMEOUT_MS = 1000;
const HISTORY_WAIT_TIMEOUT_MS = 10000;
const HISTORY_POLL_INTERVAL_MS = 50;
// Bug 1901211: setViewport never resolves when the page is zoomed
const VIEWPORT_TIMEOUT_MS = 5000;

/**
 * Check if a URL uses a common scheme that supports load events.
 * Non-common schemes = moz-extension:, about:, ...
 */
export function isCommonScheme(url: string): boolean {
  try {
    return COMMON_URL_SCHEMES.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * WebDriver BiDi browsingContext.ReadinessState.
 * - "none": return as soon as navigation starts
 * - "interactive": wait for DOMContentLoaded
 * - "complete": wait for the load event, including subresources
 */
export const READINESS_STATES = [...Object.values(ReadinessState)];

export function isReadinessState(value: unknown): value is BrowsingContext.ReadinessState {
  return READINESS_STATES.includes(value as BrowsingContext.ReadinessState);
}

export class PageManagement {
  private currentContextId: string | null = null;
  // Privileged (chrome) contexts are not listed in the content tree
  private currentContextPrivileged = false;
  private resizedContexts = new Set<string>();

  constructor(private bidi: BiDiFacade) {}

  /**
   * Get the browsing context that page tools operate on
   */
  getCurrentContextId(): string | null {
    return this.currentContextId;
  }

  /**
   * Make a privileged (chrome) context the current context
   */
  async selectPrivilegedContext(contextId: string): Promise<void> {
    await this.assertPrivilegedContext(contextId);
    this.#select(contextId, true);
    this.cachedSelectedIdx = null;
  }

  #select(contextId: string, privileged = false): void {
    this.currentContextId = contextId;
    this.currentContextPrivileged = privileged;
  }

  /**
   * Navigate to URL using BiDi
   *
   * @param url - Target URL
   * @param waitOverride - Explicit readiness state to wait for. When omitted,
   *   common schemes wait for "interactive" and uncommon schemes do not wait.
   */
  async navigate(url: string, waitOverride?: BrowsingContext.ReadinessState): Promise<void> {
    const contextId = this.getCurrentContextId();
    if (!contextId) {
      throw new Error(`Cannot navigate: no browsing context ID`);
    }

    // Default wait time is "interactive" (DOMContentLoaded).
    // All uncommon schemes use wait time "none".
    // An explicit override is honoured for every scheme: silently downgrading it
    // would discard what the caller asked for with no way to tell.
    const wait =
      waitOverride ?? (isCommonScheme(url) ? ReadinessState.Interactive : ReadinessState.None);

    // Navigate using direct BiDi
    await this.bidi.sendCommand('browsingContext.navigate', {
      context: contextId,
      url,
      wait,
    });

    logDebug(`BiDi navigate (wait:${wait}) to: ${url}`);
    log(`Navigated to: ${url}`);
  }

  /**
   * Navigate back in history
   */
  async navigateBack(): Promise<void> {
    await this.#traverseHistory(-1);
  }

  /**
   * Navigate forward in history
   */
  async navigateForward(): Promise<void> {
    await this.#traverseHistory(1);
  }

  /**
   * Set viewport size
   */
  async setViewportSize(width: number, height: number): Promise<void> {
    const contextId = this.getCurrentContextId();
    if (!contextId) {
      throw new Error(`Cannot set viewport: no browsing context ID`);
    }

    this.resizedContexts.add(contextId);
    await this.setViewport(contextId, { width, height });
  }

  /**
   * Remove the viewport overrides set by setViewportSize. Firefox keeps them
   * after the session ends, so a Firefox that outlives the session would stay
   * at the fixed size.
   */
  async resetViewports(): Promise<void> {
    const contexts = [...this.resizedContexts];
    this.resizedContexts.clear();
    await Promise.all(
      contexts.map(async (contextId) => {
        try {
          await this.setViewport(contextId, null);
        } catch (error) {
          // Closed tabs lose their override anyway
          logDebug(
            `Failed to reset viewport of ${contextId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })
    );
  }

  private async setViewport(
    contextId: string,
    viewport: BrowsingContext.SetViewportParameters['viewport']
  ): Promise<void> {
    try {
      await this.bidi.sendCommand(
        'browsingContext.setViewport',
        { context: contextId, viewport },
        { timeout: VIEWPORT_TIMEOUT_MS }
      );
    } catch (error) {
      if (error instanceof BiDiTimeoutError) {
        throw new Error(
          `Firefox did not confirm the new viewport size within ${VIEWPORT_TIMEOUT_MS}ms. ` +
            'The viewport was probably resized, but Firefox cannot confirm it when the page is zoomed.'
        );
      }
      throw error;
    }
  }

  /**
   * Accept dialog (alert/confirm/prompt)
   * @param promptText - Optional text to enter in prompt dialog
   */
  async acceptDialog(promptText?: string): Promise<void> {
    const contextId = this.getCurrentContextId();
    if (!contextId) {
      throw new Error(`Cannot accept dialog: no browsing context ID`);
    }

    // Listen before accepting, the page can be destroyed before the command returns.
    const pageClosed = this.#closesBlockedByBeforeUnload.has(contextId)
      ? await this.#waitForContextDestroyed(contextId)
      : null;

    try {
      await this.bidi.sendCommand('browsingContext.handleUserPrompt', {
        context: contextId,
        accept: true,
        userText: promptText,
      });
    } catch (error) {
      await pageClosed?.stop();
      throw new Error(
        `Failed to accept dialog: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (pageClosed) {
      await pageClosed.destroyed;
      await pageClosed.stop();
      await this.ensureCurrentContext();
      await this.refreshTabs();
    }
  }

  /**
   * Dismiss dialog (alert/confirm/prompt)
   */
  async dismissDialog(): Promise<void> {
    const contextId = this.getCurrentContextId();
    if (!contextId) {
      throw new Error(`Cannot dismiss dialog: no browsing context ID`);
    }

    try {
      await this.bidi.sendCommand('browsingContext.handleUserPrompt', {
        context: contextId,
        accept: false,
      });
    } catch (error) {
      throw new Error(
        `Failed to dismiss dialog: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Pages whose close_page call is blocked by a beforeunload prompt
  #closesBlockedByBeforeUnload = new Set<string>();
  private cachedTabs: Array<{ actor: string; title: string; url: string }> = [];
  // null when a privileged context is selected
  private cachedSelectedIdx: number | null = 0;

  /**
   * Get all tabs (window handles)
   */
  getTabs(): Array<{ actor: string; title: string; url: string }> {
    return this.cachedTabs;
  }

  /**
   * Get selected tab index
   */
  getSelectedTabIdx(): number | null {
    return this.cachedSelectedIdx;
  }

  /**
   * Refresh tabs metadata - fetches all top-level browsing contexts and their URLs/titles
   */
  async refreshTabs(): Promise<void> {
    try {
      const { contexts } = await this.bidi.sendCommand('browsingContext.getTree', { maxDepth: 0 });

      this.cachedTabs = await Promise.all(
        contexts.map(async ({ context, url }) => ({
          actor: context,
          title: await this.getTitle(context),
          url: url || 'about:blank',
        }))
      );
      const currentId = this.getCurrentContextId();
      this.cachedSelectedIdx = this.currentContextPrivileged
        ? null
        : Math.max(
            0,
            this.cachedTabs.findIndex((tab) => tab.actor === currentId)
          );
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
      this.cachedSelectedIdx = this.currentContextPrivileged ? null : 0;
    }
  }

  private async getTitle(context: string): Promise<string> {
    try {
      const result = await this.bidi.sendCommand(
        'script.evaluate',
        {
          expression: 'document.title',
          awaitPromise: false,
          target: { context, sandbox: PAGES_SANDBOX },
        },
        { timeout: TITLE_TIMEOUT_MS }
      );
      if (result.type === 'success' && result.result.type === 'string') {
        return result.result.value || 'Untitled';
      }
      return 'Untitled';
    } catch (error) {
      logDebug(
        `Failed to fetch title of tab ${context}: ${error instanceof Error ? error.message : String(error)}`
      );
      return '(unknown)';
    }
  }

  /**
   * Select tab by index
   */
  async selectTab(index: number): Promise<void> {
    const context = this.cachedTabs[index]?.actor;
    if (context) {
      await this.bidi.sendCommand('browsingContext.activate', { context });
      this.#select(context);
      this.cachedSelectedIdx = index;
    }
  }

  /**
   * Create new page (tab)
   */
  async createNewPage(url: string, waitOverride?: BrowsingContext.ReadinessState): Promise<number> {
    const { context } = await this.bidi.sendCommand('browsingContext.create', {
      type: CreateType.Tab,
    });
    this.#select(context);
    await this.navigate(url, waitOverride);
    await this.refreshTabs();
    return this.cachedSelectedIdx!;
  }

  /**
   * Close tab by index
   */
  async closeTab(index: number): Promise<void> {
    const context = this.cachedTabs[index]?.actor;
    if (context) {
      let promptOpened = false;
      // The close is no longer blocked once its prompt closes, also when a
      // user handled the prompt in Firefox.
      const onPromptClosed = (closed: BrowsingContext.UserPromptClosedParameters) => {
        if (closed.context === context && (closed.type as string) === 'beforeunload') {
          this.bidi.off('browsingContext.userPromptClosed', onPromptClosed);
          this.#closesBlockedByBeforeUnload.delete(context);
        }
      };
      // Only a beforeunload prompt blocks the close. The page can open other
      // prompts once the beforeunload prompt is dismissed, before the close returns.
      const onPromptOpened = (prompt: BrowsingContext.UserPromptOpenedParameters) => {
        if (prompt.context === context && (prompt.type as string) === 'beforeunload') {
          this.bidi.off('browsingContext.userPromptOpened', onPromptOpened);
          promptOpened = true;
          this.#closesBlockedByBeforeUnload.add(context);
          this.bidi.on('browsingContext.userPromptClosed', onPromptClosed);
        }
      };
      this.bidi.on('browsingContext.userPromptOpened', onPromptOpened);
      try {
        await this.bidi.sendCommand('browsingContext.close', { context, promptUnload: true });
      } finally {
        this.bidi.off('browsingContext.userPromptOpened', onPromptOpened);
      }
      // If a beforeunload prompt opened, close_page already returned, and this
      // runs only after the prompt was handled. acceptDialog() has updated the
      // tabs, and after dismissDialog() the page is still open.
      if (!promptOpened) {
        await this.ensureCurrentContext();
        await this.refreshTabs();
      }
    }
  }

  /**
   * Start listening for the destruction of a context. Call it before the
   * action that destroys the context. stop() removes the listener and the
   * event subscription.
   */
  async #waitForContextDestroyed(
    context: string
  ): Promise<{ destroyed: Promise<void>; stop: () => Promise<void> }> {
    const subscription = await this.bidi.subscribe('browsingContext.contextDestroyed');

    let onDestroyed!: (info: BrowsingContext.Info) => void;
    const destroyed = new Promise<void>((resolve) => {
      onDestroyed = (info) => {
        if (info.context === context) {
          resolve();
        }
      };
    });
    this.bidi.on('browsingContext.contextDestroyed', onDestroyed);

    return {
      destroyed,
      stop: async () => {
        this.bidi.off('browsingContext.contextDestroyed', onDestroyed);
        await this.bidi.sendCommand('session.unsubscribe', { subscriptions: [subscription] });
      },
    };
  }

  /**
   * Select the tab the user sees: the visible tab of the active window, or
   * the first tab when none is visible. Opens a tab when there is none.
   */
  async selectInitialContext(): Promise<void> {
    const { contexts } = await this.bidi.sendCommand('browsingContext.getTree', { maxDepth: 0 });
    let candidates = contexts;
    try {
      const { clientWindows } = await this.bidi.sendCommand('browser.getClientWindows');
      const active = clientWindows.find((window) => window.active)?.clientWindow;
      const inActiveWindow = contexts.filter(({ clientWindow }) => clientWindow === active);
      if (inActiveWindow.length) {
        candidates = inActiveWindow;
      }
    } catch (error) {
      logDebug('Failed to get the active window', error);
    }

    const visibilities = await Promise.all(
      candidates.map(({ context }) =>
        this.#evaluateWithTimeout(
          { context, sandbox: PAGES_SANDBOX },
          "document.visibilityState === 'visible'"
        )
      )
    );
    const context =
      candidates[visibilities.indexOf(true)]?.context ??
      candidates[0]?.context ??
      (await this.bidi.sendCommand('browsingContext.create', { type: CreateType.Tab })).context;
    this.#select(context);
    logDebug(`Browsing context ID: ${context}`);
  }

  /**
   * Ensure the current browsing context still exists. If it is gone, select
   * the first tab, or open a new one when no tab is left. Returns false when
   * Firefox does not respond.
   */
  async ensureCurrentContext(): Promise<boolean> {
    try {
      const currentId = this.getCurrentContextId();
      let contexts: BrowsingContext.InfoList | undefined;
      let available: string[];
      if (this.currentContextPrivileged) {
        available = await this.#getPrivilegedContextIds();
      } else {
        ({ contexts } = await this.bidi.sendCommand('browsingContext.getTree', { maxDepth: 0 }));
        available = contexts.map(({ context }) => context);
      }
      if (currentId && available.includes(currentId)) {
        return true;
      }

      contexts ??= (await this.bidi.sendCommand('browsingContext.getTree', { maxDepth: 0 }))
        .contexts;

      logDebug('Previously selected tab is no longer available');
      let next = contexts[0]?.context;
      if (next) {
        logDebug('Switching to the first tab');
        await this.bidi.sendCommand('browsingContext.activate', { context: next });
      } else {
        logDebug('All tabs have been closed, switching to a new tab');
        next = (await this.bidi.sendCommand('browsingContext.create', { type: CreateType.Tab }))
          .context;
      }
      this.#select(next);
      await this.refreshTabs();
      return true;
    } catch (error) {
      logDebug('Connection check failed: Firefox is not responsive', error);
      return false;
    }
  }

  /**
   * Throw unless the id is a privileged context. Only top-level entries of the
   * chrome-scoped tree are privileged; their children are content tabs.
   */
  async assertPrivilegedContext(contextId: string): Promise<void> {
    if (!(await this.#getPrivilegedContextIds()).includes(contextId)) {
      throw new Error(
        `${contextId} is not a privileged context. Use list_privileged_contexts to see valid ids.`
      );
    }
  }

  async #getPrivilegedContextIds(): Promise<string[]> {
    const { contexts } = await this.bidi.sendCommand('browsingContext.getTree', {
      maxDepth: 0,
      'moz:scope': 'chrome',
    });
    return contexts.map(({ context }) => context);
  }

  async #traverseHistory(delta: number): Promise<void> {
    const contextId = this.getCurrentContextId();
    if (!contextId) {
      throw new Error(`Cannot navigate: no browsing context ID`);
    }

    const target = { context: contextId, sandbox: PAGES_SANDBOX };
    const token = randomUUID();
    const tokenString = JSON.stringify(token);

    // Tag the current document with a unique token, and set the same token in a
    // popstate listener. After the traversal, a missing marker means another
    // document is active.
    const markerSet = await this.#evaluateWithTimeout(
      target,
      `window.${HISTORY_MARKER} = ${tokenString};
      window.addEventListener('popstate', () => { window.${HISTORY_POPSTATE} = ${tokenString}; }, { once: true });
      true`
    );

    try {
      await this.bidi.sendCommand('browsingContext.traverseHistory', {
        context: contextId,
        delta,
      });
    } catch (error) {
      // Firefox gives up after 1s when the target page is slow to respond, but
      // the traversal still goes on. Keep waiting for it below.
      if (!(error instanceof Error) || !error.message.includes('History was not updated')) {
        throw error;
      }
      logDebug(`Ignoring traverseHistory timeout in ${contextId}: ${error.message}`);
    }

    if (markerSet !== true) {
      return;
    }

    // Note: WebDriverBiDi.traverseHistory does not match WebDriver Classic's
    // wait logic for the Back/Forward commands, and does not expose enough
    // events to emulate it either. See w3c/webdriver-bidi#1019 and
    // w3c/webdriver-bidi#1092.
    const status = `(() => {
      // The marker is still there: the traversal stays in the same document
      // (pushState or fragment entries), and is done when popstate fired.
      if (window.${HISTORY_MARKER} === ${tokenString}) {
        return window.${HISTORY_POPSTATE} === ${tokenString} ? 'done' : 'pending';
      }

      // Another document is active. Error pages never reach "complete": like
      // Classic, they end the wait with an error.
      if (/^about:[^?]*error\\?/.test(document.documentURI)) {
        return 'error';
      }

      // about:blocked (Safe Browsing) never reaches "complete" either: like
      // Classic, it ends the wait normally.
      if (document.documentURI.startsWith('about:blocked?')) {
        return 'done';
      }

      return document.readyState === 'complete' ? 'done' : 'pending';
    })()`;
    const deadline = Date.now() + HISTORY_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const result = await this.#evaluateWithTimeout(target, status);
      if (result === 'error') {
        const uri = await this.#evaluateWithTimeout(target, 'document.documentURI');
        throw new Error(`Reached error page: ${String(uri)}`);
      }
      if (result === 'done') {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, HISTORY_POLL_INTERVAL_MS));
    }

    // Bug 2081596: Tell the agent in the tool response that the traversal could
    // not be confirmed, so it can check the page state itself.
    logDebug(`Timed out waiting for history traversal in ${contextId}`);
  }

  /**
   * Evaluate an expression and return its primitive value, or null when the
   * evaluation fails or does not answer within HISTORY_EVALUATE_TIMEOUT_MS.
   */
  async #evaluateWithTimeout(target: Script.ContextTarget, expression: string): Promise<unknown> {
    try {
      const result = await this.bidi.sendCommand(
        'script.evaluate',
        { expression, awaitPromise: false, target },
        { timeout: HISTORY_EVALUATE_TIMEOUT_MS }
      );
      if (result.type === 'success' && 'value' in result.result) {
        return result.result.value;
      }
      return null;
    } catch {
      return null;
    }
  }
}
