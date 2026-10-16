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
  'network',
  'management',
  'launch',
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
    if (version === undefined) {
      throw new Error(`Unknown Firefox version in: ${info.text}`);
    }
    supported = compareVersions(version, '160.0') >= 0;
  }, 60000);

  mcpTest.beforeEach(({ skip }) => {
    if (!supported) {
      console.warn('Skipping restricted session tests: requires Firefox 160 or later');
      skip();
    }
  });

  mcpTest('hides unsupported tools once connected', async ({ mcp }) => {
    expect(mcp.serverCapabilities()?.tools?.listChanged).toBe(true);
    await waitFor(() => mcp.toolListChanges() > 0);
    expect(mcp.toolListChanges()).toBe(1);

    const tools = await mcp.listTools();
    expect(toolsBeforeConnection).toContain('print_page');
    expect(tools).not.toContain('print_page');
    expect(toolsBeforeConnection).toContain('set_network_cache');
    expect(tools).not.toContain('set_network_cache');
    expect(tools).toContain('list_network_requests');
    expect(tools).toContain('get_firefox_info');
  });

  mcpTest('rejects calls to unsupported tools', async ({ mcp }) => {
    const result = await mcp.callTool('print_page');

    expect(result).toEqual({
      isError: true,
      text: 'Error: print_page is not available in a session restricted to a container.',
    });
  });

  mcpTest('reports the connection error of a failed restart', async ({ mcp }) => {
    await mcp.callTool('restart_firefox', { firefoxPath: '/nonexistent/firefox' });

    const result = await mcp.callTool('print_page');

    expect(result.isError).toBe(true);
    expect(result.text).toContain('binary is not a Firefox executable');
  });
});
