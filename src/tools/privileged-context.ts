/**
 * Privileged context management tools for MCP
 * Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1
 */

import { successResponse, errorResponse, previewExcerpt } from '../utils/response-helpers.js';
import { validateFunction } from '../utils/js-validation.js';
import { remoteValueToNative } from '../utils/remote-value.js';
import { saveOutput } from '../utils/save-output.js';
import { defineModule, defineToolHandler, type ToolDefinition } from './module.js';
import type { McpToolResponse } from '../types/common.js';

export const listPrivilegedContextsTool = {
  name: 'list_privileged_contexts',
  description:
    'List privileged (privileged) browsing contexts. Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 env var. Use restart_firefox with env parameter to enable.',
  annotations: {
    readOnlyHint: true,
  },
  inputSchema: {
    type: 'object',
    properties: {},
  },
} as const satisfies ToolDefinition;

export const selectPrivilegedContextTool = {
  name: 'select_privileged_context',
  description:
    'Select a privileged browsing context by ID. Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 env var.',
  annotations: {
    readOnlyHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      contextId: {
        type: 'string',
        description: 'Privileged browsing context ID from list_privileged_contexts',
      },
    },
    required: ['contextId'],
  },
} as const satisfies ToolDefinition;

export const evaluatePrivilegedScriptTool = {
  name: 'evaluate_privileged_script',
  description:
    'Execute JS function in a privileged (chrome) browsing context. Requires MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 env var. Get context ids from list_privileged_contexts.',
  annotations: {
    readOnlyHint: false,
  },
  inputSchema: {
    type: 'object',
    properties: {
      function: {
        type: 'string',
        description: 'JS function string, e.g. () => Services.prefs.getBoolPref("foo")',
      },
      context: {
        type: 'string',
        description: 'Privileged browsing context ID from list_privileged_contexts',
      },
      saveTo: {
        type: ['boolean', 'string'],
        description:
          'Save the result to a file as JSON instead of returning it inline. Pass a file path, an existing directory (generated file inside), or true (generated file under ~/.firefox-mcp/output/). Relative paths resolve against the current working directory.',
      },
      preview: {
        type: 'number',
        description:
          'Number of characters of the saved result to return inline as a preview when saveTo is used. Omit for no preview.',
      },
    },
    required: ['function', 'context'],
  },
} as const satisfies ToolDefinition;

function formatContextList(contexts: any[]): string {
  if (contexts.length === 0) {
    return 'No privileged contexts found';
  }

  const lines: string[] = [`${contexts.length} privileged contexts`];
  for (const ctx of contexts) {
    const id = ctx.context;
    const url = ctx.url || '(no url)';
    const children = ctx.children ? ` [${ctx.children.length} children]` : '';
    lines.push(`  ${id}: ${url}${children}`);
  }
  return lines.join('\n');
}

const SYSTEM_ACCESS_ERROR =
  'Privileged context access not enabled. Set MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 environment variable and restart Firefox.';

async function withSystemAccess<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Error && error.message.includes('unsupported operation')) {
      throw new Error(SYSTEM_ACCESS_ERROR);
    }
    throw error;
  }
}

export const handleListPrivilegedContexts = defineToolHandler<typeof listPrivilegedContextsTool>(
  async (_args): Promise<McpToolResponse> => {
    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    const result = await withSystemAccess(() =>
      firefox.sendBiDiCommand('browsingContext.getTree', {
        'moz:scope': 'chrome',
        maxDepth: 0,
      })
    );

    return successResponse(formatContextList(result.contexts || []));
  },
  false
);

export const handleSelectPrivilegedContext = defineToolHandler<typeof selectPrivilegedContextTool>(
  async (args): Promise<McpToolResponse> => {
    const { contextId } = args;

    if (!contextId || typeof contextId !== 'string') {
      throw new Error('contextId parameter is required and must be a string');
    }

    const { getFirefox } = await import('../index.js');
    const firefox = await getFirefox();

    await withSystemAccess(() => firefox.selectPrivilegedContext(contextId));

    return successResponse(`Switched to privileged context: ${contextId}`);
  },
  false
);

export const handleEvaluatePrivilegedScript = defineToolHandler<
  typeof evaluatePrivilegedScriptTool
>(async (args): Promise<McpToolResponse> => {
  const { function: fnString, context, saveTo, preview } = args;

  validateFunction(fnString);

  if (!context || typeof context !== 'string') {
    throw new Error('context parameter is required and must be a string');
  }

  const { getFirefox } = await import('../index.js');
  const firefox = await getFirefox();

  await withSystemAccess(() => firefox.assertPrivilegedContext(context));

  const result = await firefox.sendBiDiCommand('script.callFunction', {
    functionDeclaration: fnString,
    awaitPromise: true,
    arguments: [],
    target: { context },
  });

  if (result.type === 'success') {
    // JSON.stringify returns undefined for an undefined script result
    const json = JSON.stringify(remoteValueToNative(result.result), null, 2) ?? 'undefined';

    if (saveTo) {
      const saved = await saveOutput(
        json,
        saveTo === true ? undefined : saveTo,
        'evaluate-privileged'
      );
      let output = `Script ran in chrome context. Result saved to: ${saved.path} (${(saved.bytes / 1024).toFixed(1)}KB)`;
      const excerpt = previewExcerpt(json, preview);
      if (excerpt) {
        output += '\nPreview:\n```json\n' + excerpt + '\n```';
      }
      return successResponse(output);
    }

    return successResponse(
      'Script ran in chrome context and returned:\n```json\n' + json + '\n```'
    );
  } else {
    const exceptionDetails = result.exceptionDetails;
    return errorResponse(
      new Error(
        `Script execution failed: ${exceptionDetails.text}\n\n` +
          '```json\n' +
          JSON.stringify(remoteValueToNative(exceptionDetails.exception), null, 2) +
          '\n```'
      )
    );
  }
}, false);

export const module = defineModule({
  name: 'privileged',
  description: 'Access privileged ("chrome") browsing contexts.',
  privileged: true,
  unavailableInRestrictedSession: true,
  tools: [
    [listPrivilegedContextsTool, handleListPrivilegedContexts],
    [selectPrivilegedContextTool, handleSelectPrivilegedContext],
    [evaluatePrivilegedScriptTool, handleEvaluatePrivilegedScript],
  ],
});
