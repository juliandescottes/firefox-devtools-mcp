/**
 * DOM interactions: evaluate, element lookup, input actions (Pure BiDi)
 */

import type { FirefoxCore } from './core.js';

// Element reference returned by BiDi script.evaluate
interface ElementReference {
  sharedId: string;
  handle?: string;
}

export class DomInteractions {
  constructor(
    private core: FirefoxCore,
    private resolveUid?: (uid: string) => Promise<ElementReference>
  ) {}

  /**
   * Evaluate JavaScript using BiDi script.evaluate
   */
  async evaluate(script: string): Promise<unknown> {
    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    const result = await this.core.sendBiDiCommand('script.evaluate', {
      expression: script,
      target: { context: contextId },
      awaitPromise: false,
    });

    if (result.type === 'exception') {
      throw new Error(`Script error: ${result.exceptionDetails?.text || 'Unknown error'}`);
    }

    return this.extractValue(result);
  }

  /**
   * Get page HTML content
   */
  async getContent(): Promise<string> {
    const html = await this.evaluate('document.documentElement.outerHTML');
    return String(html);
  }

  /**
   * Click element by CSS selector
   */
  async clickBySelector(selector: string): Promise<void> {
    const elementRef = await this.findElementBySelector(selector);
    await this.clickElement(elementRef);
  }

  /**
   * Hover over element by CSS selector
   */
  async hoverBySelector(selector: string): Promise<void> {
    const elementRef = await this.findElementBySelector(selector);
    await this.hoverElement(elementRef);
  }

  /**
   * Fill input field by CSS selector
   */
  async fillBySelector(selector: string, text: string): Promise<void> {
    const elementRef = await this.findElementBySelector(selector);
    await this.fillElement(elementRef, text);
  }

  /**
   * Drag & drop using JS events fallback (DataTransfer).
   */
  async dragAndDropBySelectors(sourceSelector: string, targetSelector: string): Promise<void> {
    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    await this.core.sendBiDiCommand('script.evaluate', {
      expression: `
        (function(srcSel, tgtSel) {
          const src = document.querySelector(srcSel);
          const tgt = document.querySelector(tgtSel);
          if (!src || !tgt) {
            throw new Error('dragAndDrop: element not found');
          }

          function dispatch(type, target, dataTransfer) {
            const evt = new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer: dataTransfer
            });
            return target.dispatchEvent(evt);
          }

          const dt = typeof DataTransfer !== 'undefined' ? new DataTransfer() : undefined;
          dispatch('dragstart', src, dt);
          dispatch('dragenter', tgt, dt);
          dispatch('dragover', tgt, dt);
          dispatch('drop', tgt, dt);
          dispatch('dragend', src, dt);
        })("${sourceSelector}", "${targetSelector}")
      `,
      target: { context: contextId },
      awaitPromise: false,
    });
  }

  /**
   * File upload: unhide if needed, then send local path
   */
  async uploadFileBySelector(selector: string, filePath: string): Promise<void> {
    const elementRef = await this.findElementBySelector(selector);
    await this.uploadFile(elementRef, filePath);
  }

  // ============================================================================
  // UID-based input methods
  // ============================================================================

  /**
   * Click element by UID
   */
  async clickByUid(uid: string, dblClick = false): Promise<void> {
    if (!this.resolveUid) {
      throw new Error('clickByUid: resolveUid callback not set. Ensure snapshot is initialized.');
    }
    const elementRef = await this.resolveUid(uid);
    await this.clickElement(elementRef, dblClick);
    await this.waitForEventsAfterAction();
  }

  /**
   * Hover over element by UID
   */
  async hoverByUid(uid: string): Promise<void> {
    if (!this.resolveUid) {
      throw new Error('hoverByUid: resolveUid callback not set. Ensure snapshot is initialized.');
    }
    const elementRef = await this.resolveUid(uid);
    await this.hoverElement(elementRef);
    await this.waitForEventsAfterAction();
  }

  /**
   * Fill input field by UID
   */
  async fillByUid(uid: string, value: string): Promise<void> {
    if (!this.resolveUid) {
      throw new Error('fillByUid: resolveUid callback not set. Ensure snapshot is initialized.');
    }
    const elementRef = await this.resolveUid(uid);
    await this.fillElement(elementRef, value);
    await this.waitForEventsAfterAction();
  }

  /**
   * Drag & drop by UIDs
   */
  async dragByUidToUid(fromUid: string, toUid: string): Promise<void> {
    if (!this.resolveUid) {
      throw new Error(
        'dragByUidToUid: resolveUid callback not set. Ensure snapshot is initialized.'
      );
    }

    const fromEl = await this.resolveUid(fromUid);
    const toEl = await this.resolveUid(toUid);

    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    // Use JS drag events with element references
    await this.core.sendBiDiCommand('script.callFunction', {
      functionDeclaration: `
        function(srcEl, tgtEl) {
          if (!srcEl || !tgtEl) {
            throw new Error('dragAndDrop: element not found');
          }

          function dispatch(type, target, dataTransfer) {
            const evt = new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              dataTransfer: dataTransfer
            });
            return target.dispatchEvent(evt);
          }

          const dt = typeof DataTransfer !== 'undefined' ? new DataTransfer() : undefined;
          dispatch('dragstart', srcEl, dt);
          dispatch('dragenter', tgtEl, dt);
          dispatch('dragover', tgtEl, dt);
          dispatch('drop', tgtEl, dt);
          dispatch('dragend', srcEl, dt);
        }
      `,
      arguments: [
        { sharedId: fromEl.sharedId },
        { sharedId: toEl.sharedId },
      ],
      target: { context: contextId },
      awaitPromise: false,
    });

    await this.waitForEventsAfterAction();
  }

  /**
   * Fill multiple form fields by UIDs
   */
  async fillFormByUid(elements: Array<{ uid: string; value: string }>): Promise<void> {
    if (!this.resolveUid) {
      throw new Error(
        'fillFormByUid: resolveUid callback not set. Ensure snapshot is initialized.'
      );
    }

    for (const { uid, value } of elements) {
      await this.fillByUid(uid, value);
    }
  }

  /**
   * Upload file by UID
   */
  async uploadFileByUid(uid: string, filePath: string): Promise<void> {
    if (!this.resolveUid) {
      throw new Error(
        'uploadFileByUid: resolveUid callback not set. Ensure snapshot is initialized.'
      );
    }

    const elementRef = await this.resolveUid(uid);
    await this.uploadFile(elementRef, filePath);
    await this.waitForEventsAfterAction();
  }

  // ============================================================================
  // Private helper methods
  // ============================================================================

  /**
   * Find element by CSS selector with retry
   */
  private async findElementBySelector(selector: string, timeout = 5000): Promise<ElementReference> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    while (Date.now() - startTime < timeout) {
      try {
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
      } catch (error) {
        lastError = error as Error;
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    throw new Error(`Timeout waiting for element: ${selector}. ${lastError?.message || ''}`);
  }

  /**
   * Click element using BiDi input.performActions
   */
  private async clickElement(elementRef: ElementReference, doubleClick = false): Promise<void> {
    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    const actions = doubleClick
      ? [
          { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: elementRef.sharedId } } },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
          { type: 'pause', duration: 100 },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ]
      : [
          { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: elementRef.sharedId } } },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ];

    await this.core.sendBiDiCommand('input.performActions', {
      context: contextId,
      actions: [{
        type: 'pointer',
        id: 'mouse',
        actions,
      }],
    });
  }

  /**
   * Hover element using BiDi input.performActions
   */
  private async hoverElement(elementRef: ElementReference): Promise<void> {
    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    await this.core.sendBiDiCommand('input.performActions', {
      context: contextId,
      actions: [{
        type: 'pointer',
        id: 'mouse',
        actions: [
          { type: 'pointerMove', x: 0, y: 0, origin: { type: 'element', element: { sharedId: elementRef.sharedId } } },
        ],
      }],
    });
  }

  /**
   * Fill element using BiDi input.performActions (keyboard)
   */
  private async fillElement(elementRef: ElementReference, text: string): Promise<void> {
    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    // First click to focus
    await this.clickElement(elementRef);

    // Clear existing text (Ctrl+A, Delete)
    await this.core.sendBiDiCommand('input.performActions', {
      context: contextId,
      actions: [{
        type: 'key',
        id: 'keyboard',
        actions: [
          { type: 'keyDown', value: '\uE009' }, // Ctrl
          { type: 'keyDown', value: 'a' },
          { type: 'keyUp', value: 'a' },
          { type: 'keyUp', value: '\uE009' },
          { type: 'keyDown', value: '\uE017' }, // Delete
          { type: 'keyUp', value: '\uE017' },
        ],
      }],
    });

    // Type new text
    const keyActions: any[] = [];
    for (const char of text) {
      keyActions.push({ type: 'keyDown', value: char });
      keyActions.push({ type: 'keyUp', value: char });
    }

    await this.core.sendBiDiCommand('input.performActions', {
      context: contextId,
      actions: [{
        type: 'key',
        id: 'keyboard',
        actions: keyActions,
      }],
    });
  }

  /**
   * Upload file to file input element
   */
  private async uploadFile(elementRef: ElementReference, filePath: string): Promise<void> {
    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    // Unhide element if needed
    await this.core.sendBiDiCommand('script.callFunction', {
      functionDeclaration: `
        function(element) {
          if (!element) {
            throw new Error('uploadFile: element not found');
          }
          if (element.tagName !== 'INPUT' || element.type !== 'file') {
            throw new Error('uploadFile: element must be <input type=file>');
          }
          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            element.style.display = 'block';
            element.style.visibility = 'visible';
            element.style.opacity = '1';
            element.style.position = 'fixed';
            element.style.left = '0px';
            element.style.top = '0px';
            element.style.zIndex = '2147483647';
          }
        }
      `,
      arguments: [{ sharedId: elementRef.sharedId }],
      target: { context: contextId },
      awaitPromise: false,
    });

    // Set file path using input.performActions
    const keyActions: any[] = [];
    for (const char of filePath) {
      keyActions.push({ type: 'keyDown', value: char });
      keyActions.push({ type: 'keyUp', value: char });
    }

    // Click element first to focus
    await this.clickElement(elementRef);

    await this.core.sendBiDiCommand('input.performActions', {
      context: contextId,
      actions: [{
        type: 'key',
        id: 'keyboard',
        actions: keyActions,
      }],
    });
  }

  /**
   * Wait for events to propagate after user action
   */
  private async waitForEventsAfterAction(): Promise<void> {
    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      return;
    }

    // Wait for requestAnimationFrame
    await this.core.sendBiDiCommand('script.evaluate', {
      expression: 'new Promise(r => requestAnimationFrame(() => r()))',
      target: { context: contextId },
      awaitPromise: true,
    });

    // Small additional delay
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /**
   * Extract value from BiDi script result
   */
  /**
   * Extract value from BiDi script result
   * Recursively deserializes BiDi's object/array format
   */
  private extractValue(result: any): unknown {
    // BiDi wraps the actual result in { type: 'success', result: {...} }
    // Extract the inner result first
    const actualResult = result.type === 'success' ? result.result : result;

    if (actualResult.type === 'undefined') {
      return undefined;
    }
    if (actualResult.type === 'null') {
      return null;
    }
    if (actualResult.type === 'string' || actualResult.type === 'number' || actualResult.type === 'boolean') {
      return actualResult.value;
    }
    if (actualResult.type === 'object') {
      // BiDi serializes objects as: { type: 'object', value: [[key, {type, value}], ...] }
      const obj: any = {};
      if (Array.isArray(actualResult.value)) {
        for (const [key, val] of actualResult.value) {
          obj[key] = this.extractValue(val);
        }
      }
      return obj;
    }
    if (actualResult.type === 'array') {
      // BiDi serializes arrays as: { type: 'array', value: [{type, value}, ...] }
      if (Array.isArray(actualResult.value)) {
        return actualResult.value.map((item: any) => this.extractValue(item));
      }
      return [];
    }
    return actualResult.value;
  }

  // ============================================================================
  // Screenshot
  // ============================================================================

  /**
   * Take screenshot of the entire page
   * @returns PNG as base64 string
   */
  async takeScreenshotPage(): Promise<string> {
    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    const result = await this.core.sendBiDiCommand('browsingContext.captureScreenshot', {
      context: contextId,
    });

    return result.data;
  }

  /**
   * Take screenshot of element by UID
   * Scrolls element into view, captures full page, then crops to element bounds
   * @param uid Element UID from snapshot
   * @returns PNG as base64 string
   */
  async takeScreenshotByUid(uid: string): Promise<string> {
    if (!this.resolveUid) {
      throw new Error(
        'takeScreenshotByUid: resolveUid callback not set. Ensure snapshot is initialized.'
      );
    }

    const contextId = this.core.getCurrentContextId();
    if (!contextId) {
      throw new Error('No active context');
    }

    const elementRef = await this.resolveUid(uid);

    // Scroll element into view
    await this.core.sendBiDiCommand('script.callFunction', {
      functionDeclaration: `
        function(element) {
          element.scrollIntoView({block: 'center', inline: 'center'});
        }
      `,
      arguments: [{ sharedId: elementRef.sharedId }],
      target: { context: contextId },
      awaitPromise: false,
    });

    // Wait for scroll to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get element bounds
    const boundsResult = await this.core.sendBiDiCommand('script.callFunction', {
      functionDeclaration: `
        function(element) {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          };
        }
      `,
      arguments: [{ sharedId: elementRef.sharedId }],
      target: { context: contextId },
      awaitPromise: false,
    });

    const bounds = this.extractValue(boundsResult);

    // Take full page screenshot
    const screenshot = await this.takeScreenshotPage();

    // Note: BiDi doesn't have built-in cropping, so we return full screenshot
    // The consumer can crop if needed, or we can implement cropping using a library
    // For now, return full screenshot (limitation of pure BiDi)
    return screenshot;
  }
}
