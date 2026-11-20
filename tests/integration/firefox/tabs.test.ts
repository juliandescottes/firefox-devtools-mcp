/**
 * Integration tests for tab management
 * Tests with real Firefox browser in headless mode
 */

import { describe, it, expect, assert, beforeAll, afterAll } from 'vitest';
import {
  createTestFirefox,
  closeFirefox,
  waitForElementInSnapshot,
  findNodesInSnapshot,
  waitForPageLoad,
  fixtureUrl,
} from '../../helpers/firefox.js';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CreateType, ReadinessState } from '@/firefox/bidi.js';
import type { FirefoxClient } from '@/firefox/index.js';
import type { SnapshotNode } from '@/firefox/snapshot/types.js';

describe('Tab Management Integration Tests', () => {
  let firefox: FirefoxClient;

  beforeAll(async () => {
    firefox = await createTestFirefox();
  });

  afterAll(async () => {
    await closeFirefox(firefox);
  });

  it('should list tabs', async () => {
    const fixturePath = fixtureUrl('simple.html');
    await firefox.navigate(fixturePath);

    await firefox.refreshTabs();
    const tabs = firefox.getTabs();

    expect(tabs).toBeDefined();
    expect(Array.isArray(tabs)).toBe(true);
    expect(tabs.length).toBeGreaterThan(0);
    expect(tabs[firefox.getSelectedTabIdx()!]).toMatchObject({
      title: 'Simple Test Page',
      url: fixturePath,
    });
  }, 15000);

  it('should create new tab', async () => {
    await firefox.refreshTabs();
    const initialTabs = firefox.getTabs();
    const initialTabCount = initialTabs.length;

    const fixturePath = fixtureUrl('simple.html');
    const newTabIndex = await firefox.createNewPage(fixturePath);

    await firefox.refreshTabs();
    const updatedTabs = firefox.getTabs();

    expect(updatedTabs.length).toBe(initialTabCount + 1);
    expect(typeof newTabIndex).toBe('number');
    expect(newTabIndex).toBeGreaterThanOrEqual(0);
    expect(updatedTabs[newTabIndex]?.url).toBe(fixturePath);
    expect(firefox.getSelectedTabIdx()).toBe(newTabIndex);
  }, 15000);

  it('should switch between tabs', async () => {
    await firefox.refreshTabs();

    // Create second tab
    const fixturePath = fixtureUrl('form.html');
    const newTabIndex = await firefox.createNewPage(fixturePath);

    await firefox.refreshTabs();

    // Switch to new tab
    await firefox.selectTab(newTabIndex);

    const selectedIdx = firefox.getSelectedTabIdx();
    expect(selectedIdx).toBe(newTabIndex);

    // Switch back to first tab
    await firefox.selectTab(0);

    const newSelectedIdx = firefox.getSelectedTabIdx();
    expect(newSelectedIdx).toBe(0);
  }, 20000);

  it('should close tab', async () => {
    await firefox.refreshTabs();
    const initialTabs = firefox.getTabs();

    if (initialTabs.length < 2) {
      // Create additional tab if needed
      const fixturePath = fixtureUrl('simple.html');
      await firefox.createNewPage(fixturePath);
      await firefox.refreshTabs();
    }

    const tabsBeforeClose = firefox.getTabs();
    const tabCountBeforeClose = tabsBeforeClose.length;

    // Close the last tab (not the current one)
    const lastTabIndex = tabCountBeforeClose - 1;
    await firefox.closeTab(lastTabIndex);

    await firefox.refreshTabs();
    const tabsAfterClose = firefox.getTabs();

    expect(tabsAfterClose.length).toBe(tabCountBeforeClose - 1);
  }, 20000);

  it('should have snapshot isolation between tabs', async () => {
    // Create two tabs with different pages
    const simplePath = fixtureUrl('simple.html');
    const formPath = fixtureUrl('form.html');

    await firefox.navigate(simplePath);
    await waitForPageLoad();
    const tab1Index = firefox.getSelectedTabIdx();

    const tab2Index = await firefox.createNewPage(formPath);
    await firefox.selectTab(tab2Index);
    await waitForPageLoad();

    // Wait for form elements to appear in tab 2
    const emailElement = await waitForElementInSnapshot(
      firefox,
      (node) => node.id === 'email',
      10000
    );

    expect(emailElement).toBeDefined();

    // Take snapshot in tab 2 (form page)
    const snapshot2 = await firefox.takeSnapshot();
    const formElements = findNodesInSnapshot(snapshot2.json.root, (node) => node.id === 'email');

    expect(formElements.length).toBeGreaterThan(0);

    // Switch to tab 1 (simple page)
    await firefox.selectTab(tab1Index!);
    await waitForPageLoad();

    // Wait for button to appear in tab 1
    const clickBtnElement = await waitForElementInSnapshot(
      firefox,
      (node) => node.id === 'clickBtn',
      10000
    );

    expect(clickBtnElement).toBeDefined();

    // Take snapshot in tab 1
    const snapshot1 = await firefox.takeSnapshot();
    const simpleElements = findNodesInSnapshot(
      snapshot1.json.root,
      (node) => node.id === 'clickBtn'
    );

    expect(simpleElements.length).toBeGreaterThan(0);

    // Each tab has its own registry, so the two snapshots must not share UIDs
    const uids = (root: SnapshotNode) => findNodesInSnapshot(root, () => true).map((n) => n.uid);
    const uids1 = new Set(uids(snapshot1.json.root));
    expect(uids(snapshot2.json.root).some((uid) => uids1.has(uid))).toBe(false);
  }, 30000);

  it('should get selected tab index', async () => {
    await firefox.refreshTabs();
    const selectedIdx = firefox.getSelectedTabIdx();

    expect(typeof selectedIdx).toBe('number');
    expect(selectedIdx).toBeGreaterThanOrEqual(0);
  }, 10000);
});

describe('Tab titles with a busy tab', () => {
  let firefox: FirefoxClient;

  beforeAll(async () => {
    firefox = await createTestFirefox();
  });

  afterAll(async () => {
    await closeFirefox(firefox);
  });

  it('should not wait for the title of a tab whose content process is busy', async () => {
    const fixturePath = fixtureUrl('simple.html');
    await firefox.navigate(fixturePath);

    const busyUrl = 'data:text/html,<title>Busy</title>';
    await firefox.createNewPage(busyUrl);
    // Not awaited: the title read below queues behind this loop in the content process
    void firefox
      .sendBiDiCommand('script.evaluate', {
        expression: 'const end = Date.now() + 5000; while (Date.now() < end) {}',
        awaitPromise: false,
        target: { context: firefox.getCurrentContextId()! },
      })
      .catch(() => {});

    const start = Date.now();
    await firefox.refreshTabs();
    const elapsed = Date.now() - start;

    expect(firefox.getTabs()).toEqual([
      { actor: expect.any(String), title: 'Simple Test Page', url: fixturePath },
      { actor: expect.any(String), title: '(unknown)', url: busyUrl },
    ]);
    expect(elapsed).toBeLessThan(3000);
  }, 20000);
});

describe('Tab selection and recovery', () => {
  let firefox: FirefoxClient;

  beforeAll(async () => {
    firefox = await createTestFirefox();
  });

  afterAll(async () => {
    await closeFirefox(firefox);
  });

  async function openTabs(count: number): Promise<string[]> {
    await firefox.refreshTabs();
    for (const tab of firefox.getTabs().slice(1).reverse()) {
      await firefox.closeTab(firefox.getTabs().indexOf(tab));
    }
    await firefox.selectTab(0);
    await firefox.navigate(fixtureUrl('simple.html'));
    for (let i = 1; i < count; i++) {
      await firefox.createNewPage(fixtureUrl('simple.html'));
    }
    await firefox.refreshTabs();
    return firefox.getTabs().map((tab) => tab.actor);
  }

  async function visibility(context: string): Promise<unknown> {
    return await firefox.getBidi().evaluate(context, 'document.visibilityState');
  }

  it('should show the selected tab', async () => {
    const [first, second] = await openTabs(2);
    expect(await visibility(second)).toBe('visible');

    await firefox.selectTab(0);

    expect(firefox.getCurrentContextId()).toBe(first);
    expect(await visibility(first)).toBe('visible');
    expect(await visibility(second)).toBe('hidden');
  }, 20000);

  it('should keep the selection when closing another tab', async () => {
    const [, second, third] = await openTabs(3);
    await firefox.selectTab(1);

    await firefox.closeTab(2);

    expect(firefox.getCurrentContextId()).toBe(second);
    expect(firefox.getSelectedTabIdx()).toBe(1);
    await firefox.refreshTabs();
    expect(firefox.getTabs().map((tab) => tab.actor)).not.toContain(third);
  }, 20000);

  it('should select the first tab when closing the selected tab', async () => {
    const [first, second] = await openTabs(2);

    await firefox.closeTab(1);

    expect(firefox.getCurrentContextId()).toBe(first);
    expect(firefox.getSelectedTabIdx()).toBe(0);
    expect(await visibility(first)).toBe('visible');
    await firefox.refreshTabs();
    expect(firefox.getTabs().map((tab) => tab.actor)).not.toContain(second);
  }, 20000);

  it('should switch to the first tab when the selected tab was closed elsewhere', async () => {
    const [first, second] = await openTabs(2);
    await firefox.sendBiDiCommand('browsingContext.close', { context: second });

    expect(await firefox.ensureConnected()).toBe(true);

    expect(firefox.getCurrentContextId()).toBe(first);
  }, 20000);

  it('should report the fallback tab as selected after recovery', async () => {
    const [first, , third] = await openTabs(3);
    await firefox.sendBiDiCommand('browsingContext.close', { context: third });

    expect(await firefox.ensureConnected()).toBe(true);

    expect(firefox.getCurrentContextId()).toBe(first);
    expect(firefox.getSelectedTabIdx()).toBe(0);
  }, 20000);

  it('should report the first tab as selected when the selected tab was closed elsewhere', async () => {
    const [, second] = await openTabs(2);
    await firefox.sendBiDiCommand('browsingContext.close', { context: second });

    await firefox.refreshTabs();

    expect(firefox.getSelectedTabIdx()).toBe(0);
  }, 20000);

  it('should keep the selected tab when it is still open', async () => {
    const [, second] = await openTabs(2);

    expect(await firefox.ensureConnected()).toBe(true);

    expect(firefox.getCurrentContextId()).toBe(second);
  }, 20000);
});

describe('Closing tabs with a privileged context selected', () => {
  let firefox: FirefoxClient;

  beforeAll(async () => {
    firefox = await createTestFirefox({ env: { MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } });
  });

  afterAll(async () => {
    await closeFirefox(firefox);
  });

  it('should keep the privileged context selected when closing a tab', async () => {
    await firefox.createNewPage(fixtureUrl('simple.html'));
    await firefox.refreshTabs();
    const { contexts } = await firefox.sendBiDiCommand('browsingContext.getTree', {
      'moz:scope': 'chrome',
      maxDepth: 0,
    });
    const chromeContext = contexts[0].context;
    await firefox.selectPrivilegedContext(chromeContext);

    await firefox.closeTab(firefox.getTabs().length - 1);

    expect(firefox.getCurrentContextId()).toBe(chromeContext);
    expect(firefox.getSelectedTabIdx()).toBeNull();
  }, 20000);

  it('should not select a content tab as a privileged context', async () => {
    await firefox.refreshTabs();
    await firefox.selectTab(0);
    const tab = firefox.getCurrentContextId();
    assert(tab, 'a tab is selected');

    await expect(firefox.selectPrivilegedContext(tab)).rejects.toThrow(
      'is not a privileged context'
    );

    expect(firefox.getSelectedTabIdx()).toBe(0);
  }, 20000);

  it('should not report a selected tab while a privileged context is selected', async () => {
    const { contexts } = await firefox.sendBiDiCommand('browsingContext.getTree', {
      'moz:scope': 'chrome',
      maxDepth: 0,
    });
    await firefox.selectPrivilegedContext(contexts[0].context);

    expect(firefox.getSelectedTabIdx()).toBeNull();
    await firefox.refreshTabs();
    expect(firefox.getSelectedTabIdx()).toBeNull();

    await firefox.selectTab(0);
    expect(firefox.getSelectedTabIdx()).toBe(0);
  }, 20000);

  it('should switch to the first tab when the privileged context was closed', async () => {
    const chromeContexts = async (): Promise<string[]> => {
      const { contexts } = await firefox.sendBiDiCommand('browsingContext.getTree', {
        'moz:scope': 'chrome',
        maxDepth: 0,
      });
      return contexts.map(({ context }) => context);
    };
    const before = await chromeContexts();
    const { context: tab } = await firefox.sendBiDiCommand('browsingContext.create', {
      type: CreateType.Window,
    });
    const window = (await chromeContexts()).find((context) => !before.includes(context));
    assert(window, 'the new window has a chrome context');
    await firefox.selectPrivilegedContext(window);
    await firefox.sendBiDiCommand('browsingContext.close', { context: tab });

    expect(await firefox.ensureConnected()).toBe(true);

    expect(firefox.getSelectedTabIdx()).toBe(0);
    expect(firefox.getCurrentContextId()).toBe(firefox.getTabs()[0]?.actor);
  }, 20000);
});

describe('Connection checks', () => {
  it('should report a closed Firefox as not connected', async () => {
    const firefox = await createTestFirefox();
    await firefox.close();

    expect(await firefox.ensureConnected()).toBe(false);
  }, 30000);

  it('should report a crashed Firefox as not connected', async () => {
    const firefox = await createTestFirefox();
    try {
      const pid = firefox.getCapabilities().get('moz:processID') as number;
      process.kill(pid, 'SIGKILL');

      expect(await firefox.ensureConnected()).toBe(false);
    } finally {
      await closeFirefox(firefox);
    }
  }, 60000);
});

describe('New tab readiness', () => {
  let firefox: FirefoxClient;
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/slow.png') {
        setTimeout(() => res.writeHead(200, { 'Content-Type': 'image/png' }).end(), 1000);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<img src="/slow.png">');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    firefox = await createTestFirefox();
  });

  afterAll(async () => {
    await closeFirefox(firefox);
    await new Promise((resolve) => server?.close(resolve));
  });

  it('should wait for the requested readiness state', async () => {
    await firefox.createNewPage(`${origin}/`, ReadinessState.Complete);

    expect(await firefox.evaluate('document.readyState')).toBe('complete');
  }, 20000);
});
