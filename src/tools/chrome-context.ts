/**
 * Chrome context management tools for MCP
 * Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1
 */

import { successResponse, errorResponse } from '../utils/response-helpers.js';
import type { McpToolResponse } from '../types/common.js';

export const listChromeContextsTool = {
  name: 'list_chrome_contexts',
  description:
    'List chrome (privileged) browsing contexts. Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 env var. Use restart_firefox with env parameter to enable.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export const selectChromeContextTool = {
  name: 'select_chrome_context',
  description:
    'Select a chrome browsing context by ID and set Marionette context to chrome. Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 env var.',
  inputSchema: {
    type: 'object',
    properties: {
      contextId: {
        type: 'string',
        description: 'Chrome browsing context ID from list_chrome_contexts',
      },
    },
    required: ['contextId'],
  },
};

export const evaluateChromeScriptTool = {
  name: 'evaluate_chrome_script',
  description:
    'Evaluate JavaScript in the current chrome context. Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 env var. Returns the result of the expression.',
  inputSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'JavaScript expression to evaluate in the chrome context',
      },
    },
    required: ['expression'],
  },
};

function formatContextList(contexts: any[]): string {
  if (contexts.length === 0) {
    return '🔧 No chrome contexts found';
  }

  const lines: string[] = [`🔧 ${contexts.length} chrome contexts`];
  for (const ctx of contexts) {
    const id = ctx.context;
    const url = ctx.url || '(no url)';
    const children = ctx.children ? ` [${ctx.children.length} children]` : '';
    lines.push(`  ${id}: ${url}${children}`);
  }
  return lines.join('\n');
}

export async function handleListChromeContexts(_args: unknown): Promise<McpToolResponse> {
  try {
    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    const result = await firefox.sendBiDiCommand('browsingContext.getTree', {
      'moz:scope': 'chrome',
    });

    const contexts = result.contexts || [];

    return successResponse(formatContextList(contexts));
  } catch (error) {
    if (error instanceof Error && error.message.includes('UnsupportedOperationError')) {
      return errorResponse(
        new Error(
          'Chrome context access not enabled. Set MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 environment variable and restart Firefox.'
        )
      );
    }
    return errorResponse(error as Error);
  }
}

export async function handleSelectChromeContext(args: unknown): Promise<McpToolResponse> {
  try {
    const { contextId } = args as { contextId: string };

    if (!contextId || typeof contextId !== 'string') {
      throw new Error('contextId parameter is required and must be a string');
    }

    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    // Verify chrome context is available
    const chromeContextId = firefox.getChromeContextId();
    if (!chromeContextId) {
      return errorResponse(
        new Error(
          'Chrome context not available. Ensure MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 is set before starting Firefox.'
        )
      );
    }

    // Verify the context exists
    const result = await firefox.sendBiDiCommand('browsingContext.getTree', {
      'moz:scope': 'chrome',
    });

    const contexts = result.contexts || [];
    const contextExists = contexts.some((ctx: any) => ctx.context === contextId);

    if (!contextExists) {
      return errorResponse(
        new Error(`Chrome context ${contextId} not found. Use list_chrome_contexts to see available contexts.`)
      );
    }

    return successResponse(
      `✅ Chrome context verified: ${contextId}\n\nNote: BiDi automatically targets chrome contexts when using chrome context IDs. Use evaluate_chrome_script to execute scripts in this context.`
    );
  } catch (error) {
    return errorResponse(error as Error);
  }
}

export async function handleEvaluateChromeScript(args: unknown): Promise<McpToolResponse> {
  try {
    const { expression } = args as { expression: string };

    if (!expression || typeof expression !== 'string') {
      throw new Error('expression parameter is required and must be a string');
    }

    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    // Get chrome context ID
    const chromeContextId = firefox.getChromeContextId();
    if (!chromeContextId) {
      return errorResponse(
        new Error(
          'Chrome context not available. Ensure MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 is set before starting Firefox.'
        )
      );
    }

    try {
      // Execute script in chrome context using BiDi
      const result = await firefox.sendBiDiCommand('script.evaluate', {
        expression: `(${expression})`,
        target: { context: chromeContextId },
        awaitPromise: false,
      });

      if (result.type === 'exception') {
        throw new Error(`Script error: ${result.exceptionDetails?.text || 'Unknown error'}`);
      }

      // Extract value from BiDi result (recursive deserialization)
      const extractValue = (bidiResult: any): any => {
        // BiDi wraps the actual result in { type: 'success', result: {...} }
        const actualResult = bidiResult.type === 'success' ? bidiResult.result : bidiResult;

        if (actualResult.type === 'undefined') return undefined;
        if (actualResult.type === 'null') return null;
        if (actualResult.type === 'string' || actualResult.type === 'number' || actualResult.type === 'boolean') {
          return actualResult.value;
        }
        if (actualResult.type === 'object') {
          // BiDi serializes objects as: { type: 'object', value: [[key, {type, value}], ...] }
          const obj: any = {};
          if (Array.isArray(actualResult.value)) {
            for (const [key, val] of actualResult.value) {
              obj[key] = extractValue(val);
            }
          }
          return obj;
        }
        if (actualResult.type === 'array') {
          // BiDi serializes arrays as: { type: 'array', value: [{type, value}, ...] }
          if (Array.isArray(actualResult.value)) {
            return actualResult.value.map((item: any) => extractValue(item));
          }
          return [];
        }
        return actualResult.value;
      };

      const value = extractValue(result);
      const resultText =
        typeof value === 'string'
          ? value
          : value === null
            ? 'null'
            : value === undefined
              ? 'undefined'
              : JSON.stringify(value, null, 2);

      return successResponse(`🔧 Result:\n${resultText}`);
    } catch (executeError) {
      return errorResponse(
        new Error(
          `Script execution failed: ${executeError instanceof Error ? executeError.message : String(executeError)}`
        )
      );
    }
  } catch (error) {
    return errorResponse(error as Error);
  }
}
