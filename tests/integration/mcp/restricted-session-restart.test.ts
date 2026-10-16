/**
 * Integration tests for the tools of a session restricted to a container, after
 * a restart without the restriction, called through the MCP server
 */

import { expect } from 'vitest';
import { compareVersions } from '@/utils/version.js';
import { waitFor } from '../../helpers/firefox.js';
import { mcpTest } from '../../helpers/mcp.js';

// Hidden Firefox test prefs which restrict the session to a dedicated container.
mcpTest.override('mcpServerArgs', [
  '--tools',
  'print',
  'management',
  'launch',
  '--pref',
  'remote.experimental.dynamicstart.force-container=true',
  '--pref',
  'remote.experimental.dynamicstart.container-isolation-enabled=true',
]);

mcpTest.describe('Restricted session restart (MCP)', () => {
  let supported = false;

  mcpTest.beforeAll(async ({ mcp }) => {
    const info = await mcp.callTool('get_firefox_info');
    const version = /Firefox version: (\d+)/.exec(info.text)?.[1];
    if (version === undefined) {
      throw new Error(`Unknown Firefox version in: ${info.text}`);
    }
    supported = compareVersions(version, '160.0') >= 0;
  }, 60000);

  mcpTest.beforeEach(({ skip }) => {
    if (!supported) {
      console.warn('Skipping restricted session restart tests: requires Firefox 160 or later');
      skip();
    }
  });

  mcpTest(
    'allows unsupported tools again after a restart without the restriction',
    async ({ mcp }) => {
      await waitFor(() => mcp.toolListChanges() > 0);
      expect(await mcp.listTools()).not.toContain('print_page');

      await mcp.callTool('restart_firefox', {
        prefs: {
          'remote.experimental.dynamicstart.force-container': false,
          'remote.experimental.dynamicstart.container-isolation-enabled': false,
        },
      });
      const result = await mcp.callTool('print_page');

      expect(result.isError).toBe(false);
      await waitFor(() => mcp.toolListChanges() > 1);
      expect(await mcp.listTools()).toContain('print_page');
    }
  );
});
