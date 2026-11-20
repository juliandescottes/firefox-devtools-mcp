import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  evaluatePrivilegedScriptTool,
  handleEvaluatePrivilegedScript,
} from '../../../src/tools/privileged-context.js';

// Mock the index module (used by handler tests)
const mockGetFirefox = vi.hoisted(() => vi.fn());

const raceAgainstDialogOpened = vi.fn().mockImplementation((fn: () => any) => fn());
const getCurrentDialog = vi.fn().mockReturnValue(undefined);

vi.mock('../../../src/index.js', () => ({
  getFirefox: () => mockGetFirefox(),
}));

describe('Privileged Context Tool Definitions', () => {
  describe('evaluatePrivilegedScriptTool', () => {
    it('should have correct name', () => {
      expect(evaluatePrivilegedScriptTool.name).toBe('evaluate_privileged_script');
    });

    it('should require function parameter', () => {
      expect(evaluatePrivilegedScriptTool.inputSchema.required).toContain('function');
    });

    it('should require context parameter', () => {
      const { properties, required } = evaluatePrivilegedScriptTool.inputSchema;
      expect(properties?.context).toBeDefined();
      expect(properties?.context.type).toBe('string');
      expect(required).toContain('context');
    });

    it('should have optional saveTo parameter of type boolean|string', () => {
      const { properties, required } = evaluatePrivilegedScriptTool.inputSchema;
      expect(properties?.saveTo).toBeDefined();
      expect(properties?.saveTo.type).toEqual(['boolean', 'string']);
      expect(required).not.toContain('saveTo');
    });

    it('should have optional numeric preview parameter', () => {
      const { properties, required } = evaluatePrivilegedScriptTool.inputSchema;
      expect(properties?.preview).toBeDefined();
      expect(properties?.preview.type).toBe('number');
      expect(required).not.toContain('preview');
    });
  });
});

describe('Privileged Context Tool Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleEvaluatePrivilegedScript', () => {
    it('should return error when function parameter is missing', async () => {
      mockGetFirefox.mockResolvedValue({ getCurrentDialog, raceAgainstDialogOpened });

      // @ts-expect-error invalid arguments
      const result = await handleEvaluatePrivilegedScript({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('function parameter is required');
    });

    it('should reject plain expressions (not function strings)', async () => {
      mockGetFirefox.mockResolvedValue({ getCurrentDialog, raceAgainstDialogOpened });

      // @ts-expect-error invalid arguments
      const result = await handleEvaluatePrivilegedScript({ function: 'document.title' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid function format');
    });

    it('should return error when context parameter is missing', async () => {
      // @ts-expect-error invalid arguments
      const result = await handleEvaluatePrivilegedScript({ function: '() => 1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('context parameter is required');
    });
  });
});
