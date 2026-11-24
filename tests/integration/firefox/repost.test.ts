/**
 * Integration tests for reloading a page loaded with POST data.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestFirefox, closeFirefox, waitFor } from '../../helpers/firefox.js';
import { ReadinessState } from '@/firefox/bidi.js';
import type { FirefoxClient } from '@/firefox/index.js';

describe('Repost Integration Tests', () => {
  let firefox: FirefoxClient;
  let server: Server;
  let origin: string;
  let postCount = 0;

  const waitForResult = (expected: string) =>
    waitFor(async () => {
      const text = await firefox
        .evaluate('document.getElementById("result")?.textContent')
        .catch(() => null);
      return text === expected;
    });

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === 'POST') {
        postCount++;
        req.resume();
        req.on('end', () => {
          res
            .writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
            .end(`<p id="result">${postCount}</p>`);
        });
        return;
      }
      res
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end('<form method="post" action="/result"><input name="a" value="1"></form>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    firefox = await createTestFirefox();
  });

  afterAll(async () => {
    await closeFirefox(firefox);
    await new Promise((resolve) => server?.close(resolve));
  });

  it('should resend POST data on reload without blocking the tab', async () => {
    await firefox.navigate(`${origin}/form`, ReadinessState.Complete);

    await firefox.evaluate('setTimeout(() => document.forms[0].submit(), 0)');
    await waitForResult('1');

    await firefox.evaluate('setTimeout(() => location.reload(), 0)');
    await waitForResult('2');
    expect(postCount).toBe(2);
  }, 15000);
});
