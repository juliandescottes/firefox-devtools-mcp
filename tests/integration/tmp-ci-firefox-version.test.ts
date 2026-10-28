// Temporary: checks that CI launches the Firefox installed by setup-firefox. Remove before landing.

import { describe, expect, it } from 'vitest';
import { closeFirefox, createTestFirefox } from '../helpers/firefox.js';
import { startMcpServer } from '../helpers/mcp.js';

const MIN_MAJOR = 159;

describe('CI Firefox version (temporary)', () => {
  it('createTestFirefox launches the installed Firefox', async () => {
    const firefox = await createTestFirefox();
    try {
      const version = firefox.getFirefoxVersion();
      console.log(
        `createTestFirefox: Firefox ${version}, FIREFOX_PATH=${process.env.FIREFOX_PATH}`
      );
      expect(Number.parseInt(version ?? '0', 10)).toBeLessThan(MIN_MAJOR);
    } finally {
      await closeFirefox(firefox);
    }
  }, 60000);

  it('the MCP server launches the installed Firefox', async () => {
    const server = await startMcpServer(['--tools', 'script']);
    try {
      const result = await server.callTool('evaluate_script', {
        function: '() => navigator.userAgent',
      });
      console.log(`MCP server: ${result.text}`);
      const major = Number(/Firefox\/(\d+)/.exec(result.text)?.[1] ?? 0);
      expect(major).toBeLessThan(MIN_MAJOR);
    } finally {
      await server.close();
    }
  }, 60000);
});
