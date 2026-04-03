/**
 * UID Resolver
 * Handles UID validation, resolution to selectors/elements, and element caching
 */

import { logDebug } from '../../utils/logger.js';
import type { UidEntry, ElementCacheEntry } from './types.js';
import type { FirefoxCore } from '../core.js';

// Element reference returned by BiDi script.evaluate
export interface ElementReference {
  sharedId: string;
  handle?: string;
}

/**
 * UID Resolver class
 * Separated from SnapshotManager for better modularity
 */
export class UidResolver {
  private uidToEntry = new Map<string, UidEntry>();
  private elementCache = new Map<string, ElementCacheEntry>();
  private currentSnapshotId = 0;

  constructor(private core: FirefoxCore) {}

  /**
   * Update current snapshot ID
   */
  setSnapshotId(snapshotId: number): void {
    this.currentSnapshotId = snapshotId;
  }

  /**
   * Get current snapshot ID
   */
  getSnapshotId(): number {
    return this.currentSnapshotId;
  }

  /**
   * Store UID mappings from snapshot result
   */
  storeUidMappings(uidMap: UidEntry[]): void {
    this.uidToEntry.clear();
    for (const entry of uidMap) {
      this.uidToEntry.set(entry.uid, entry);
    }
  }

  /**
   * Clear all UID mappings and cache
   */
  clear(): void {
    this.uidToEntry.clear();
    this.elementCache.clear();
    logDebug('Snapshot UIDs cleared');
  }

  /**
   * Validate UID (staleness check)
   */
  validateUid(uid: string): void {
    const parts = uid.split('_');
    if (parts.length < 2 || !parts[0]) {
      throw new Error(`Invalid UID format: ${uid}`);
    }

    const uidSnapshotId = parseInt(parts[0], 10);
    if (isNaN(uidSnapshotId)) {
      throw new Error(`Invalid UID format: ${uid}`);
    }

    if (uidSnapshotId !== this.currentSnapshotId) {
      throw new Error(
        `This uid is from a stale snapshot (snapshot ${uidSnapshotId}, current ${this.currentSnapshotId}). Take a fresh snapshot.`
      );
    }
  }

  /**
   * Resolve UID to CSS selector (with staleness check)
   */
  resolveUidToSelector(uid: string): string {
    this.validateUid(uid);

    const entry = this.uidToEntry.get(uid);
    if (!entry) {
      throw new Error(`UID not found: ${uid}. Take a fresh snapshot first.`);
    }

    return entry.css;
  }

  /**
   * Resolve UID to ElementReference (with staleness check and caching)
   * Tries CSS first, falls back to XPath
   */
  async resolveUidToElement(uid: string): Promise<ElementReference> {
    this.validateUid(uid);

    const entry = this.uidToEntry.get(uid);
    if (!entry) {
      throw new Error(`UID not found: ${uid}. Take a fresh snapshot first.`);
    }

    // Check cache
    const cached = this.elementCache.get(uid);
    if (cached?.cachedElement) {
      try {
        // Validate element is still alive by trying to access it
        await this.validateElementReference(cached.cachedElement);
        logDebug(`Using cached element for UID: ${uid}`);
        return cached.cachedElement;
      } catch (e) {
        // Element is stale, re-find it
        logDebug(`Cached element stale for UID: ${uid}, re-finding...`);
      }
    }

    // Try CSS selector first
    try {
      const element = await this.findElementByCSS(entry.css);

      // Update cache
      this.elementCache.set(uid, {
        selector: entry.css,
        ...(entry.xpath && { xpath: entry.xpath }),
        cachedElement: element,
        snapshotId: this.currentSnapshotId,
        timestamp: Date.now(),
      });

      logDebug(`Found element by CSS for UID: ${uid}`);
      return element;
    } catch (cssError) {
      logDebug(`CSS selector failed for UID: ${uid}, trying XPath fallback...`);

      // Fallback to XPath if available
      const xpathSelector = entry.xpath;
      if (xpathSelector) {
        try {
          const element = await this.findElementByXPath(xpathSelector);

          // Update cache
          this.elementCache.set(uid, {
            selector: entry.css,
            ...(xpathSelector && { xpath: xpathSelector }),
            cachedElement: element,
            snapshotId: this.currentSnapshotId,
            timestamp: Date.now(),
          });

          logDebug(`Found element by XPath for UID: ${uid}`);
          return element;
        } catch (xpathError) {
          throw new Error(
            `Element not found for UID: ${uid}. The element may have changed. Take a fresh snapshot.`
          );
        }
      }

      throw new Error(
        `Element not found for UID: ${uid}. The element may have changed. Take a fresh snapshot.`
      );
    }
  }

  /**
   * Find element by CSS selector using BiDi browsingContext.locateNodes
   */
  private async findElementByCSS(selector: string): Promise<ElementReference> {
    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    const result = await this.core.sendBiDiCommand('browsingContext.locateNodes', {
      context: contextId,
      locator: {
        type: 'css',
        value: selector,
      },
      maxNodeCount: 1,
    });

    // Result format: { nodes: [NodeRemoteValue, ...] }
    if (result.nodes && result.nodes.length > 0) {
      const node = result.nodes[0];
      if (node.sharedId) {
        return { sharedId: node.sharedId, handle: node.handle };
      }
    }

    throw new Error(`Element not found: ${selector}`);
  }

  /**
   * Find element by XPath using BiDi browsingContext.locateNodes
   */
  private async findElementByXPath(xpath: string): Promise<ElementReference> {
    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    const result = await this.core.sendBiDiCommand('browsingContext.locateNodes', {
      context: contextId,
      locator: {
        type: 'xpath',
        value: xpath,
      },
      maxNodeCount: 1,
    });

    // Result format: { nodes: [NodeRemoteValue, ...] }
    if (result.nodes && result.nodes.length > 0) {
      const node = result.nodes[0];
      if (node.sharedId) {
        return { sharedId: node.sharedId, handle: node.handle };
      }
    }

    throw new Error(`Element not found: ${xpath}`);
  }

  /**
   * Validate element reference is still alive
   */
  private async validateElementReference(elementRef: ElementReference): Promise<void> {
    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    // Try to access the element's tagName to verify it still exists
    const result = await this.core.sendBiDiCommand('script.callFunction', {
      functionDeclaration: 'function(el) { return el ? el.tagName : null; }',
      arguments: [{ sharedId: elementRef.sharedId }],
      target: { context: contextId },
      awaitPromise: false,
    });

    // BiDi wraps result in { type: 'success', result: {...} }
    const actualResult = result.type === 'success' ? result.result : result;

    if (actualResult.type === 'null' || actualResult.type === 'undefined') {
      throw new Error('Element reference is stale');
    }
  }
}
