/**
 * Integration tests for sessions restricted to a container
 * Tests with real Firefox browser in headless mode
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DataType } from '@/firefox/bidi.js';
import { compareVersions } from '@/utils/version.js';
import { createTestFirefox, closeFirefox, waitFor } from '../../helpers/firefox.js';
import type { FirefoxClient } from '@/firefox/index.js';

// Hidden Firefox test prefs: the first one puts all sessions in a dedicated
// container, the second one restricts the session to it.
const FORCE_CONTAINER_PREF = 'remote.experimental.dynamicstart.force-container';
const CONTAINER_ISOLATION_PREF = 'remote.experimental.dynamicstart.container-isolation-enabled';

function isSupported(firefox: FirefoxClient): boolean {
  const version = firefox.getFirefoxVersion();
  if (version === null) {
    throw new Error('Unknown Firefox version');
  }
  return compareVersions(version, '160.0') >= 0;
}

describe('Container restricted session', () => {
  let firefox: FirefoxClient;
  let server: Server;
  let origin: string;
  let supported = false;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/download') {
        res
          .writeHead(200, {
            'Content-Type': 'text/plain',
            'Content-Disposition': 'attachment; filename="container.txt"',
          })
          .end('container download');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>container page</p>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    firefox = await createTestFirefox({
      prefs: { [FORCE_CONTAINER_PREF]: true, [CONTAINER_ISOLATION_PREF]: true },
    });
    supported = isSupported(firefox);
  }, 30000);

  afterAll(async () => {
    await closeFirefox(firefox);
    await new Promise((resolve) => server?.close(resolve));
  });

  beforeEach((ctx) => {
    if (!supported) {
      console.warn('Skipping container restricted session tests: requires Firefox 160 or later');
      ctx.skip();
    }
  });

  it('reports the user context of the session', () => {
    const userContext = firefox.getCapabilities().get('moz:userContext');
    expect(userContext).toEqual(expect.any(String));
    expect(userContext).not.toBe('default');
    expect(firefox.getRestrictedUserContext()).toBe(userContext);
  });

  const userContextOf = async (context: string | null) => {
    const { contexts } = await firefox.sendBiDiCommand('browsingContext.getTree', {});
    return contexts.find((c) => c.context === context)?.userContext;
  };

  it('opens, selects and closes tabs in the user context of the session', async () => {
    const userContext = firefox.getRestrictedUserContext();
    expect(await userContextOf(firefox.getCurrentContextId())).toBe(userContext);

    const index = await firefox.createNewPage(`${origin}/new`);
    const newContext = firefox.getCurrentContextId();
    expect(await userContextOf(newContext)).toBe(userContext);
    expect(firefox.getTabs()).toHaveLength(2);

    await firefox.selectTab(index === 0 ? 1 : 0);
    expect(firefox.getCurrentContextId()).not.toBe(newContext);

    await firefox.closeTab(index);
    await firefox.refreshTabs();
    expect(firefox.getTabs()).toHaveLength(1);
  });

  it('opens a tab in the user context of the session when all its tabs are closed', async () => {
    await firefox.refreshTabs();
    const closedTabs = firefox.getTabs().map((tab) => tab.actor);
    for (let index = closedTabs.length - 1; index >= 0; index--) {
      await firefox.closeTab(index);
    }

    expect(await firefox.ensureConnected()).toBe(true);
    const current = firefox.getCurrentContextId();
    expect(closedTabs).not.toContain(current);
    expect(firefox.getTabs()).toHaveLength(1);
    expect(await userContextOf(current)).toBe(firefox.getRestrictedUserContext());
  });

  it('captures console messages', async () => {
    await firefox.evaluate('console.log("container-message")');
    await waitFor(async () =>
      (await firefox.getConsoleMessages()).some((message) => message.text === 'container-message')
    );
  });

  it('captures network requests and their response bodies', async () => {
    await firefox.startNetworkMonitoring();
    await firefox.navigate(`${origin}/page`);

    let request: any;
    await waitFor(async () => {
      request = (await firefox.getNetworkRequests()).find((r) => r.url === `${origin}/page`);
      return request?.status !== undefined;
    });

    const body = await firefox.getNetworkRequestBody(request.id, DataType.Response);
    expect(body).toMatchObject({ ok: true });
  });

  it('applies the download behavior and reports downloads', async () => {
    await firefox.setDownloadBehavior('denied');
    await firefox.navigate(`${origin}/page`);
    await firefox.evaluate(
      `(() => {
        const link = document.createElement('a');
        link.href = '/download';
        document.body.append(link);
        link.click();
      })()`
    );

    await waitFor(() =>
      firefox
        .getDownloads()
        .some((download) => download.url === `${origin}/download` && download.status === 'canceled')
    );
  });

  it('reports unsupported commands clearly', async () => {
    await expect(firefox.printPage()).rejects.toThrow(
      'browsingContext.print is not available in a session restricted to a container.'
    );
  });

  it('keeps the Firefox error for supported commands without a user context', async () => {
    await expect(
      firefox.sendBiDiCommand('session.subscribe', { events: ['log.entryAdded'] })
    ).rejects.toThrow('Subscribing without "contexts" or "userContexts" is not supported');
  });
});

describe('Container session without isolation', () => {
  let firefox: FirefoxClient;

  beforeAll(async () => {
    firefox = await createTestFirefox({ prefs: { [FORCE_CONTAINER_PREF]: true } });
  }, 30000);

  afterAll(async () => {
    await closeFirefox(firefox);
  });

  it('does not report a restricted user context', async (ctx) => {
    if (!isSupported(firefox)) {
      console.warn('Skipping container session tests: requires Firefox 160 or later');
      ctx.skip();
    }
    const capabilities = firefox.getCapabilities();
    expect(capabilities.get('moz:userContext')).toEqual(expect.any(String));
    expect(firefox.getRestrictedUserContext()).toBeNull();
  });
});
