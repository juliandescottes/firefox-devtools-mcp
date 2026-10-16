/**
 * Integration tests for the tools of a session restricted to a container,
 * called through the MCP server
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
  '--pref',
  'remote.experimental.dynamicstart.force-container=true',
  '--pref',
  'remote.experimental.dynamicstart.container-isolation-enabled=true',
]);

mcpTest.describe('Restricted session (MCP)', () => {
  let toolsBeforeConnection: string[] = [];
  let supported = false;

  mcpTest.beforeAll(async ({ mcp }) => {
    toolsBeforeConnection = await mcp.listTools();

    const info = await mcp.callTool('get_firefox_info');
    const version = /Firefox version: (\d+)/.exec(info.text)?.[1];
    supported = version !== undefined && compareVersions(version, '160.0') >= 0;
  }, 60000);

  mcpTest.beforeEach(({ skip }) => {
    if (!supported) {
      console.warn('Skipping restricted session tests: requires Firefox 160 or later');
      skip();
    }
  });

  mcpTest('hides unsupported tools once connected', async ({ mcp }) => {
    await waitFor(() => mcp.toolListChanges() > 0);

    const tools = await mcp.listTools();
    expect(toolsBeforeConnection).toContain('print_page');
    expect(tools).not.toContain('print_page');
    expect(tools).toContain('get_firefox_info');
  });

  mcpTest('rejects calls to unsupported tools', async ({ mcp }) => {
    const result = await mcp.callTool('print_page');

    expect(result).toEqual({
      isError: true,
      text:
        'Error: Not available when connected to an existing Firefox: print_page is not supported ' +
        'in a session restricted to a container.',
    });
  });
});
