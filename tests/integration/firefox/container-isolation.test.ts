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
import type { BrowsingContext } from 'webdriver-bidi-protocol';

// Hidden Firefox test prefs: the first one puts all sessions in a dedicated
// container, the second one restricts the session to it.
const FORCE_CONTAINER_PREF = 'remote.experimental.dynamicstart.force-container';
const CONTAINER_ISOLATION_PREF = 'remote.experimental.dynamicstart.container-isolation-enabled';

function isSupported(firefox: FirefoxClient): boolean {
  const version = firefox.getFirefoxVersion();
  return version !== null && compareVersions(version, '160.0') >= 0;
}

describe('Container restricted session', () => {
  let firefox: FirefoxClient;
  let server: Server;
  let origin: string;
  let supported = false;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>container page</p>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    firefox = await createTestFirefox({
      prefs: { [FORCE_CONTAINER_PREF]: true, [CONTAINER_ISOLATION_PREF]: true },
    });
    supported = isSupported(firefox);
    if (!supported) {
      return;
    }

    // The initial tab is outside of the container, so the session cannot use it.
    await firefox.sendBiDiCommand('browsingContext.create', {
      type: 'tab' as BrowsingContext.CreateType,
      userContext: firefox.getRestrictedUserContext()!,
    });
    await firefox.refreshTabs();
    await firefox.selectTab(0);
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
    expect(firefox.getRestrictedUserContext()).toEqual(expect.any(String));
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

  it('sets the download behavior', async () => {
    await expect(firefox.setDownloadBehavior('denied')).resolves.toBeUndefined();
  });

  it('unsubscribes by subscription id', async () => {
    const bidi = firefox.getBidi();
    const subscription = await bidi.subscribe('browsingContext.contextCreated');
    await expect(bidi.unsubscribe(subscription)).resolves.toBeUndefined();
  });

  it('reports unsupported commands clearly', async () => {
    await expect(firefox.printPage()).rejects.toThrow(
      'Not available when connected to an existing Firefox: browsingContext.print is not ' +
        'supported in a session restricted to a container.'
    );
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
    const capabilities = await firefox.getDriver().getCapabilities();
    expect(capabilities.get('moz:userContext')).toEqual(expect.any(String));
    expect(firefox.getRestrictedUserContext()).toBeNull();
  });
});
