/**
 * Integration tests for select_privileged_context, called through the MCP server
 */

import { expect, assert } from 'vitest';
import { fixtureUrl } from '../../helpers/firefox.js';
import { mcpTest, type McpTestServer } from '../../helpers/mcp.js';

mcpTest.override('mcpServerArgs', [
  '--tools',
  'pages',
  'script',
  'privileged',
  '--env',
  'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1',
]);

mcpTest.describe('select_privileged_context (MCP)', () => {
  mcpTest.beforeEach(async ({ mcp }) => {
    expect((await mcp.callTool('select_page', { pageIdx: 0 })).isError).toBe(false);
    const result = await mcp.callTool('navigate_page', { url: fixtureUrl('simple.html') });
    expect(result.isError).toBe(false);
  });

  mcpTest('runs page tools in the selected privileged context', async ({ mcp }) => {
    const list = await mcp.callTool('list_privileged_contexts');
    const contextId = /^ {2}(\S+): chrome:\/\/browser\//m.exec(list.text)?.[1];
    assert(contextId, 'list contains the browser window');

    const result = await mcp.callTool('select_privileged_context', { contextId });
    expect(result.isError).toBe(false);

    const evaluated = await mcp.callTool('evaluate_script', { function: '() => location.href' });
    expect(evaluated.text).toContain('chrome://browser/content/browser.xhtml');
  });

  mcpTest('lists pages without a selected page', async ({ mcp }) => {
    const list = await mcp.callTool('list_privileged_contexts');
    const contextId = /^ {2}(\S+): chrome:\/\/browser\//m.exec(list.text)?.[1];
    assert(contextId, 'list contains the browser window');
    await mcp.callTool('select_privileged_context', { contextId });

    const pages = await mcp.callTool('list_pages');
    expect(pages.text).toContain('(selected: privileged context)');
    expect(pages.text).not.toMatch(/^>/m);
  });

  mcpTest('keeps the current page when the id is not a privileged context', async ({ mcp }) => {
    const result = await mcp.callTool('select_privileged_context', { contextId: 'unknown' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('unknown is not a privileged context');

    const evaluated = await mcp.callTool('evaluate_script', { function: '() => location.href' });
    expect(evaluated.text).toContain('simple.html');
  });
});

mcpTest.describe('evaluate_privileged_script (MCP)', () => {
  async function browserWindowId(mcp: McpTestServer): Promise<string> {
    const list = await mcp.callTool('list_privileged_contexts');
    const contextId = /^ {2}(\S+): chrome:\/\/browser\//m.exec(list.text)?.[1];
    assert(contextId, 'list contains the browser window');
    return contextId;
  }

  mcpTest('runs the function in the given privileged context', async ({ mcp }) => {
    const context = await browserWindowId(mcp);

    const result = await mcp.callTool('evaluate_privileged_script', {
      function: '() => location.href',
      context,
    });

    expect(result.isError).toBe(false);
    expect(result.text).toContain('chrome://browser/content/browser.xhtml');
  });

  mcpTest('reports exceptions thrown by the function', async ({ mcp }) => {
    const context = await browserWindowId(mcp);

    const result = await mcp.callTool('evaluate_privileged_script', {
      function: '() => { throw new Error("privileged failure"); }',
      context,
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('privileged failure');
  });

  mcpTest('rejects an id that is not a privileged context', async ({ mcp }) => {
    const result = await mcp.callTool('evaluate_privileged_script', {
      function: '() => 1',
      context: 'unknown',
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('unknown is not a privileged context');
  });
});
