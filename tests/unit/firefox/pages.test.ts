/**
 * Unit tests for PageManagement and isCommonScheme
 *
 * Navigation uses BiDi browsingContext.navigate for all URLs.
 * Common schemes (http/https/data/blob/file) use wait:"interactive".
 * Uncommon schemes (moz-extension:, about:, etc.) use wait:"none"
 */

import { describe, it, expect, vi } from 'vitest';
import { ReadinessState } from '@/firefox/bidi.js';
import {
  isCommonScheme,
  isReadinessState,
  PageManagement,
  READINESS_STATES,
} from '@/firefox/pages.js';

const HTTPS_URL = 'https://example.com/test.html';
const HTTP_URL = 'http://example.com/test.html';
const FILE_URL = 'file:///some/path/test.html';
const MOZ_EXT_URL = 'moz-extension://a1b2c3d4-e5f6-7890-abcd-ef1234567890/popup.html';
const BLOB_URL = 'blob:https://example.org/40a5fb5a-d56d-4a33-b4e2-0acf6a8e5f64';
const DATA_URL = 'data:text/plain;base64,SGVsbG8sIFdvcmxkIQ==';

describe('isCommonScheme', () => {
  it('returns true for common URL schemes', () => {
    expect(isCommonScheme(HTTPS_URL)).toBe(true);
    expect(isCommonScheme(HTTP_URL)).toBe(true);
    expect(isCommonScheme(FILE_URL)).toBe(true);
    expect(isCommonScheme(DATA_URL)).toBe(true);
    expect(isCommonScheme(BLOB_URL)).toBe(true);
  });

  it('returns false for moz-extension:// URLs', () => {
    expect(isCommonScheme(MOZ_EXT_URL)).toBe(false);
  });

  it('returns false for about: URLs', () => {
    expect(isCommonScheme('about:blank')).toBe(false);
  });

  it('returns false for malformed URLs', () => {
    expect(isCommonScheme('not-a-url')).toBe(false);
  });
});

describe('isReadinessState', () => {
  it('accepts the three BiDi readiness states', () => {
    expect(READINESS_STATES).toEqual(['none', 'interactive', 'complete']);
    for (const state of READINESS_STATES) {
      expect(isReadinessState(state)).toBe(true);
    }
  });

  it('rejects anything else, including the DOM event name "load"', () => {
    expect(isReadinessState('load')).toBe(false);
    expect(isReadinessState('COMPLETE')).toBe(false);
    expect(isReadinessState(undefined)).toBe(false);
    expect(isReadinessState(true)).toBe(false);
  });
});

// -- PageManagement -----------------------------------------------------------

describe('PageManagement', () => {
  async function createMocks() {
    const sendBiDiCommand = vi.fn(async (method: string) =>
      method === 'browsingContext.getTree' ? { contexts: [{ context: 'ctx-1' }] } : {}
    );

    const pages = new PageManagement({ sendCommand: sendBiDiCommand } as any);
    await pages.selectInitialContext();
    return { pages, sendBiDiCommand };
  }

  describe('navigate', () => {
    it('uses BiDi with wait:interactive for common URL schemes', async () => {
      const { pages, sendBiDiCommand } = await createMocks();

      await pages.navigate(HTTPS_URL);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: HTTPS_URL,
        wait: 'interactive',
      });

      await pages.navigate(HTTP_URL);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: HTTP_URL,
        wait: 'interactive',
      });

      await pages.navigate(DATA_URL);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: DATA_URL,
        wait: 'interactive',
      });

      await pages.navigate(FILE_URL);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: FILE_URL,
        wait: 'interactive',
      });

      await pages.navigate(BLOB_URL);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: BLOB_URL,
        wait: 'interactive',
      });
    });

    it('uses BiDi with wait:none for uncommon URL schemes', async () => {
      const { pages, sendBiDiCommand } = await createMocks();

      await pages.navigate(MOZ_EXT_URL);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: MOZ_EXT_URL,
        wait: 'none',
      });

      await pages.navigate('about:blank');
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: 'about:blank',
        wait: 'none',
      });

      await pages.navigate('not-a-url');
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: 'not-a-url',
        wait: 'none',
      });
    });

    it('honours an explicit wait for common schemes', async () => {
      const { pages, sendBiDiCommand } = await createMocks();

      await pages.navigate(HTTPS_URL, ReadinessState.Complete);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: HTTPS_URL,
        wait: 'complete',
      });
    });

    it('honours an explicit wait for uncommon schemes rather than downgrading it', async () => {
      const { pages, sendBiDiCommand } = await createMocks();

      await pages.navigate(MOZ_EXT_URL, ReadinessState.Complete);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: MOZ_EXT_URL,
        wait: 'complete',
      });

      await pages.navigate('about:blank', ReadinessState.Interactive);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: 'about:blank',
        wait: 'interactive',
      });
    });

    it('allows an explicit wait to opt out of waiting on a common scheme', async () => {
      const { pages, sendBiDiCommand } = await createMocks();

      await pages.navigate(HTTPS_URL, ReadinessState.None);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: HTTPS_URL,
        wait: 'none',
      });
    });

    it('keeps the scheme-based default when no wait is given', async () => {
      const { pages, sendBiDiCommand } = await createMocks();

      await pages.navigate(HTTPS_URL, undefined);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.navigate', {
        context: 'ctx-1',
        url: HTTPS_URL,
        wait: 'interactive',
      });
    });
  });

  describe('tabs', () => {
    const TREE = [
      { context: 'tab-3', url: 'https://example.com/c' },
      { context: 'tab-1', url: 'https://example.com/a' },
      { context: 'tab-2', url: '' },
    ];

    async function createTabMocks(titles: Record<string, string>) {
      const sendBiDiCommand = vi.fn(async (method: string, params: any) => {
        if (method === 'browsingContext.getTree') {
          return { contexts: TREE };
        }
        if (method === 'browsingContext.activate') {
          return {};
        }
        const title = titles[params.target.context];
        if (title === undefined) {
          throw new Error('no such frame');
        }
        return { type: 'success', result: { type: 'string', value: title } };
      });
      const pages = new PageManagement({ sendCommand: sendBiDiCommand } as any);
      await pages.refreshTabs();
      await pages.selectTab(2);
      sendBiDiCommand.mockClear();
      return { pages, sendBiDiCommand };
    }

    it('refreshTabs reads tabs from the BiDi tree', async () => {
      const { pages, sendBiDiCommand } = await createTabMocks({ 'tab-1': 'A', 'tab-2': '' });

      await pages.refreshTabs();

      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.getTree', { maxDepth: 0 });
      expect(pages.getTabs()).toEqual([
        { actor: 'tab-3', title: '(unknown)', url: 'https://example.com/c' },
        { actor: 'tab-1', title: 'A', url: 'https://example.com/a' },
        { actor: 'tab-2', title: 'Untitled', url: 'about:blank' },
      ]);
      expect(pages.getSelectedTabIdx()).toBe(2);
    });

    it('refreshTabs falls back to the current tab when the tree cannot be read', async () => {
      const { pages, sendBiDiCommand } = await createTabMocks({});
      sendBiDiCommand.mockRejectedValueOnce(new Error('unsupported operation'));

      await pages.refreshTabs();

      expect(pages.getTabs()).toEqual([{ actor: 'tab-2', title: 'Current Tab', url: '' }]);
      expect(pages.getSelectedTabIdx()).toBe(0);
    });
  });

  describe('ensureCurrentContext', () => {
    it('opens a new tab when all tabs have been closed', async () => {
      let tree = [{ context: 'tab-1', url: 'https://example.com/a' }];
      const sendBiDiCommand = vi.fn(async (method: string) => {
        if (method === 'browsingContext.getTree') {
          return { contexts: tree };
        }
        if (method === 'browsingContext.create') {
          tree = [{ context: 'new-tab', url: 'about:blank' }];
          return { context: 'new-tab' };
        }
        return { type: 'success', result: { type: 'string', value: '' } };
      });
      const pages = new PageManagement({ sendCommand: sendBiDiCommand } as any);
      await pages.selectInitialContext();
      tree = [];
      sendBiDiCommand.mockClear();

      const connected = await pages.ensureCurrentContext();

      expect(connected).toBe(true);
      expect(sendBiDiCommand).toHaveBeenCalledWith('browsingContext.create', { type: 'tab' });
      expect(sendBiDiCommand).not.toHaveBeenCalledWith(
        'browsingContext.activate',
        expect.anything()
      );
      expect(pages.getCurrentContextId()).toBe('new-tab');
      expect(pages.getTabs().map((tab) => tab.actor)).toEqual(['new-tab']);
      expect(pages.getSelectedTabIdx()).toBe(0);
    });
  });
});
