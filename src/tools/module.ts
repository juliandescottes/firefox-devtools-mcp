/**
 * Tool module primitives.
 *
 * Each tool source file declares its own module with `defineModule`, co-locating
 * the module metadata with the tool definitions and handlers it contains. The
 * registry collects these module objects; it does not repeat the tool list.
 */

import type { BrowsingContext } from 'webdriver-bidi-protocol';
import type { FirefoxDevTools } from '../firefox/index.js';
import type { McpToolResponse } from '../types/common.js';
import type { ToolArgsOf } from '../types/tool-args.js';
import { formatPageLine } from '../utils/page-list.js';
import { errorResponse, successResponse } from '../utils/response-helpers.js';

export type JsonSchemaType = 'array' | 'boolean' | 'integer' | 'number' | 'object' | 'string';

export interface JsonSchemaProperty {
  type: JsonSchemaType | readonly JsonSchemaType[];
  description?: string;
  enum?: readonly string[];
  /** Schema of array elements (when type is 'array'). */
  items?: JsonSchemaProperty;
  /** Schema for values of an open-key object (prefs-style maps). */
  additionalProperties?: { oneOf: Array<{ type: JsonSchemaType }> };
  properties?: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
}

export interface InputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  annotations?: { readOnlyHint?: boolean; [key: string]: unknown };
  inputSchema: InputSchema;
}

export type ToolHandler = (input: unknown) => Promise<McpToolResponse>;

/** A handler as returned by `defineToolHandler`, typed by its tool definition. */
export type TypedToolHandler<D extends ToolDefinition> = (
  args?: ToolArgsOf<D>
) => Promise<McpToolResponse>;

export interface ToolOptions {
  /**
   * The tool needs BiDi commands which a session restricted to a container rejects.
   * Set by hand: keep in sync with the commands Firefox allows in such sessions.
   */
  unavailableInRestrictedSession?: boolean;
}

export interface ToolEntry<D extends ToolDefinition = ToolDefinition> extends ToolOptions {
  definition: D;
  handler: ToolHandler;
}

type ConfigHandler = (args: never) => Promise<McpToolResponse>;

/** Definition/handler pairs, with optional tool options, as they are written in a module config. */
type ToolPairs = readonly (
  | readonly [ToolDefinition, ConfigHandler]
  | readonly [ToolDefinition, ConfigHandler, ToolOptions]
)[];

/** The entries a module config's pairs turn into, definition types kept. */
type EntriesOf<T extends ToolPairs> = { -readonly [I in keyof T]: ToolEntry<T[I][0]> };

/**
 * A group of related tools that can be enabled or disabled as a unit.
 * `privileged` modules require the moz build and MOZ_REMOTE_ALLOW_SYSTEM_ACCESS
 * at runtime; `mozOnly` modules only require the moz build. Both are dropped
 * entirely when the server is not allowed to expose them (see buildToolset).
 */
export interface ToolModule<T extends readonly ToolEntry[] = readonly ToolEntry[]> {
  name: string;
  description: string;
  privileged?: boolean;
  mozOnly?: boolean;
  tools: T;
}

export interface ModuleConfig<T extends ToolPairs = ToolPairs> {
  name: string;
  description: string;
  privileged?: boolean;
  mozOnly?: boolean;
  /** Applies unavailableInRestrictedSession to every tool of the module. */
  unavailableInRestrictedSession?: boolean;
  /** Each entry pairs a tool definition with its handler, and optional tool options. */
  tools: T;
}

/** Improve the error message shown when `as const` is missing from a tool definition. */
type RequireConst<D extends ToolDefinition> = string extends D['name']
  ? { 'Add `as const` before `satisfies ToolDefinition` in the tool definition': true }
  : unknown;

/**
 * Wrap a tool handler so thrown errors become MCP error responses.
 *
 * The tool definition is passed as a type argument to derive the argument type
 * of the handler from its input schema.
 */
export function defineToolHandler<D extends ToolDefinition & RequireConst<D>>(
  handler: (args: ToolArgsOf<D>) => Promise<McpToolResponse>,
  blockedByDialog?: boolean
): TypedToolHandler<D>;
export function defineToolHandler(
  handler: (args: unknown) => Promise<McpToolResponse>,
  blockedByDialog = true
): ToolHandler {
  return async (input: unknown): Promise<McpToolResponse> => {
    const args: unknown = input ?? {};
    try {
      if (blockedByDialog) {
        const { getFirefox } = await import('../index.js');
        const firefox = await getFirefox();
        const dialog = firefox.getCurrentDialog();
        if (dialog) {
          return dialogOpenResponse(dialog);
        }
        return await firefox.raceAgainstDialogOpened(() => handler(args), dialogOpenedResponse);
      }
      return await handler(args);
    } catch (error) {
      return errorResponse(error instanceof Error ? error : String(error));
    }
  };
}

function describeDialog(dialog: BrowsingContext.UserPromptOpenedParameters) {
  const defaultValue =
    dialog.defaultValue !== undefined ? ` with default value "${dialog.defaultValue}"` : '';
  return `${dialog.type} "${dialog.message}"${defaultValue}`;
}

/** Reject tool call because a dialog was already open */
export function dialogOpenResponse(dialog: BrowsingContext.UserPromptOpenedParameters) {
  return errorResponse(
    `A dialog is blocking this tool from running: ${describeDialog(dialog)}. Use accept_dialog or dismiss_dialog.`
  );
}

/** Return early from tool call because a dialog was opened while it was running */
function dialogOpenedResponse(dialog: BrowsingContext.UserPromptOpenedParameters) {
  return successResponse(
    `Dialog opened while tool was running: ${describeDialog(dialog)}. Use accept_dialog or dismiss_dialog.`
  );
}

/**
 * Reject a tool call that would close Firefox while any page has a dialog open.
 * Returns null if no dialog is open.
 */
export async function openDialogsResponse(
  firefox: FirefoxDevTools,
  action: string
): Promise<McpToolResponse | null> {
  const dialogs = await firefox.getPagesWithDialogs();
  if (dialogs.length === 0) {
    return null;
  }
  const selectedIdx = firefox.getSelectedTabIdx();
  const lines = dialogs.map(
    ({ idx, dialog, ...page }) =>
      `${formatPageLine(page, idx, selectedIdx)}: ${describeDialog(dialog)}`
  );
  return errorResponse(
    `Cannot ${action} while dialogs are open on these pages:\n${lines.join('\n')}\n` +
      'Use select_page and then accept_dialog or dismiss_dialog on each of them first.'
  );
}

export function defineModule<const T extends ToolPairs>(
  config: ModuleConfig<T>
): ToolModule<EntriesOf<T>> {
  return {
    name: config.name,
    description: config.description,
    ...(config.privileged ? { privileged: true } : {}),
    ...(config.mozOnly ? { mozOnly: true } : {}),
    tools: config.tools.map(([definition, handler, options]) => ({
      definition,
      handler,
      ...(config.unavailableInRestrictedSession || options?.unavailableInRestrictedSession
        ? { unavailableInRestrictedSession: true }
        : {}),
    })) as EntriesOf<T>,
  };
}
