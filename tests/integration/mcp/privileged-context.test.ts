/**
 * Integration tests for the privileged context tools, called through the MCP server
 */

import { expect, assert } from 'vitest';
import { fixtureUrl } from '../../helpers/firefox.js';
import { mcpTest } from '../../helpers/mcp.js';

mcpTest.override('mcpServerArgs', [
  '--tools',
  'pages',
  'script',
  'privileged',
  '--env',
  'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1',
]);

mcpTest.describe('select_privileged_context (MCP)', () => {
  mcpTest('new_page opens and selects a content tab afterwards', async ({ mcp }) => {
    expect((await mcp.callTool('navigate_page', { url: fixtureUrl('simple.html') })).isError).toBe(
      false
    );

    const contexts = await mcp.callTool('list_privileged_contexts');
    const chromeContextId = /(\S+): chrome:\/\/browser\/content\/browser\.xhtml/.exec(
      contexts.text
    )?.[1];
    assert(chromeContextId, 'browser.xhtml is listed as a privileged context');

    const selected = await mcp.callTool('select_privileged_context', {
      contextId: chromeContextId,
    });
    expect(selected.isError).toBe(false);

    const url = fixtureUrl('form.html');
    const newPage = await mcp.callTool('new_page', { url });
    expect(newPage.isError).toBe(false);

    const result = await mcp.callTool('evaluate_script', { function: '() => location.href' });
    expect(result.isError).toBe(false);
    expect(result.text).toContain(url);
  });
});
