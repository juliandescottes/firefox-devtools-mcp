/**
 * Integration tests for privileged tools when Firefox runs without system access
 */

import { expect } from 'vitest';
import { mcpTest } from '../../helpers/mcp.js';

mcpTest.override('mcpServerArgs', ['--tools', 'privileged']);

mcpTest.describe('privileged tools without system access (MCP)', () => {
  mcpTest(
    'explains how to enable system access',
    async ({ mcp }) => {
      const result = await mcp.callTool('evaluate_privileged_script', {
        function: '() => 1',
        context: 'unknown',
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain('MOZ_REMOTE_ALLOW_SYSTEM_ACCESS');
    },
    10000
  );
});
