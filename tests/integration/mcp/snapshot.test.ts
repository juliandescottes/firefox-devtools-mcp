/**
 * Integration tests for the snapshot module, called through the MCP server
 */

import { expect } from 'vitest';
import { mcpTest } from '../../helpers/mcp.js';

mcpTest.override('mcpServerArgs', ['--tools', 'pages', 'snapshot']);

mcpTest.describe('wait_for (MCP)', () => {
  mcpTest.beforeEach(async ({ mcp }) => {
    await mcp.callTool('navigate_page', { url: 'data:text/html,<p>Ready</p>' });
  });

  mcpTest('reports how long it waited', async ({ mcp }) => {
    const result = await mcp.callTool('wait_for', { text: 'Ready' });

    expect(result.isError).toBe(false);
    expect(result.text).toMatch(/"Ready" appeared after \d+ ms/);
  });

  mcpTest('asks for text or a selector when given neither', async ({ mcp }) => {
    const result = await mcp.callTool('wait_for', {});

    expect(result.isError).toBe(true);
    expect(result.text).toContain('text or selector parameter is required');
  });

  mcpTest('refuses text and a selector together', async ({ mcp }) => {
    const result = await mcp.callTool('wait_for', { text: 'Ready', selector: 'p' });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('either text or selector, not both');
  });

  mcpTest('refuses an empty text or selector', async ({ mcp }) => {
    const text = await mcp.callTool('wait_for', { text: '' });
    const selector = await mcp.callTool('wait_for', { selector: '' });

    expect(text.isError).toBe(true);
    expect(text.text).toContain('text parameter must be a non-empty string');
    expect(selector.isError).toBe(true);
    expect(selector.text).toContain('selector parameter must be a non-empty string');
  });
});
