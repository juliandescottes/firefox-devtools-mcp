/**
 * JavaScript evaluation tool (currently disabled - see docs/future-features.md)
 */

import { successResponse, errorResponse } from '../utils/response-helpers.js';
import type { McpToolResponse } from '../types/common.js';

export const evaluateScriptTool = {
  name: 'evaluate_script',
  description: 'Execute JS function in page. Prefer UID tools for interactions.',
  inputSchema: {
    type: 'object',
    properties: {
      function: {
        type: 'string',
        description: 'JS function string, e.g. () => document.title',
      },
      args: {
        type: 'array',
        description: 'UIDs to pass as function arguments',
        items: {
          type: 'object',
          properties: {
            uid: {
              type: 'string',
              description: 'Element UID from snapshot',
            },
          },
          required: ['uid'],
        },
      },
      timeout: {
        type: 'number',
        description: 'Timeout in ms (default: 5000)',
      },
    },
    required: ['function'],
  },
};

// Constants
const MAX_FUNCTION_SIZE = 16 * 1024; // 16 KB
const DEFAULT_TIMEOUT = 5000; // 5 seconds

/**
 * Validate function string format
 */
function validateFunction(fnString: string): void {
  if (!fnString || typeof fnString !== 'string') {
    throw new Error('function parameter is required and must be a string');
  }

  if (fnString.length > MAX_FUNCTION_SIZE) {
    throw new Error(
      `Function too large (${fnString.length} bytes, max ${MAX_FUNCTION_SIZE} bytes). ` +
        'This tool is not designed for massive scripts.'
    );
  }

  // Check if it looks like a function or arrow function
  const trimmed = fnString.trim();
  const isFunctionLike =
    trimmed.startsWith('function') ||
    trimmed.startsWith('async function') ||
    trimmed.startsWith('(') ||
    trimmed.startsWith('async (');

  if (!isFunctionLike) {
    throw new Error(
      `Invalid function format. Expected a function or arrow function, got: "${trimmed.substring(0, 50)}...".\n\n` +
        'Valid examples:\n' +
        '  () => document.title\n' +
        '  async () => { return await fetch("/api") }\n' +
        '  (el) => el.innerText\n' +
        '  function() { return window.location.href }'
    );
  }
}

export async function handleEvaluateScript(args: unknown): Promise<McpToolResponse> {
  try {
    const {
      function: fnString,
      args: fnArgs,
      timeout,
    } = args as {
      function: string;
      args?: Array<{ uid: string }>;
      timeout?: number;
    };

    // Validate function
    validateFunction(fnString);

    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    const contextId = firefox.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    const scriptTimeout = timeout ?? DEFAULT_TIMEOUT;

    // Prepare arguments: resolve UIDs to ElementReferences if provided
    const resolvedArgs: Array<{ sharedId: string }> = [];
    if (fnArgs && fnArgs.length > 0) {
      for (const arg of fnArgs) {
        try {
          const elementRef = await firefox.resolveUidToElement(arg.uid);
          resolvedArgs.push({ sharedId: elementRef.sharedId });
        } catch (error) {
          const errorMsg = (error as Error).message;

          // Provide friendly error for stale UIDs
          if (
            errorMsg.includes('stale') ||
            errorMsg.includes('Snapshot') ||
            errorMsg.includes('UID')
          ) {
            throw new Error(
              `UID "${arg.uid}" is invalid or from an old snapshot.\n\n` +
                'The page may have changed since the snapshot was taken.\n' +
                'Please call take_snapshot to get fresh UIDs and try again.'
            );
          }

          throw new Error(`Failed to resolve UID "${arg.uid}": ${errorMsg}`);
        }
      }
    }

    // Execute using BiDi script.callFunction with timeout handling
    const executionPromise = firefox.sendBiDiCommand('script.callFunction', {
      functionDeclaration: fnString,
      arguments: resolvedArgs,
      target: { context: contextId },
      awaitPromise: true,
    });

    // Apply timeout using Promise.race
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Script execution timeout')), scriptTimeout);
    });

    const bidiResult = (await Promise.race([executionPromise, timeoutPromise])) as any;

    // Check for exceptions
    if (bidiResult.type === 'exception') {
      throw new Error(`Script error: ${bidiResult.exceptionDetails?.text || 'Unknown error'}`);
    }

    // Extract value from BiDi result (recursive deserialization)
    const extractValue = (bidiRes: any): any => {
      // BiDi wraps the actual result in { type: 'success', result: {...} }
      const actualResult = bidiRes.type === 'success' ? bidiRes.result : bidiRes;

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

    const result = extractValue(bidiResult);

    // Format output
    let output = 'Script ran on page and returned:\n';
    output += '```json\n';
    output += JSON.stringify(result, null, 2);
    output += '\n```';

    return successResponse(output);
  } catch (error) {
    const errorMsg = (error as Error).message;

    // Enhance timeout errors
    if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
      const timeoutValue = (args as { timeout?: number })?.timeout ?? DEFAULT_TIMEOUT;
      return errorResponse(
        new Error(
          `Script execution timed out (exceeded ${timeoutValue}ms).\n\n` +
            'The function may contain an infinite loop or be waiting for a slow operation.\n' +
            'Try simplifying the script or increasing the timeout parameter.'
        )
      );
    }

    return errorResponse(error as Error);
  }
}
