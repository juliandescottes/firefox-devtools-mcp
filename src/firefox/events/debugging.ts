/**
 * moz:debugging event handling
 */

import type { WebDriver } from 'selenium-webdriver';
import type { PauseInfo } from '../types.js';
import { logDebug } from '../../utils/logger.js';

export class DebuggingEvents {
  private pauseStates: Map<string, PauseInfo> = new Map();
  private pauseWaiters: Map<string, Array<(info: PauseInfo) => void>> = new Map();
  private subscribed = false;

  constructor(private driver: WebDriver) {}

  /**
   * Subscribe to moz:debugging events
   */
  async subscribe(contextId?: string): Promise<void> {
    if (this.subscribed) {
      return;
    }

    const bidi = await this.driver.getBidi();
    try {
      await bidi.subscribe('moz:debugging.paused', contextId ? [contextId] : undefined);
      await bidi.subscribe('moz:debugging.resumed', contextId ? [contextId] : undefined);
    } catch {
      logDebug(
        'Debugging events subscription skipped (may not be available in this Firefox version)'
      );
    }

    const ws: any = bidi.socket;
    ws.on('message', (data: any) => {
      try {
        const payload = JSON.parse(data.toString());

        if (payload?.method === 'moz:debugging.paused') {
          const info = payload.params as PauseInfo;
          this.pauseStates.set(info.context, info);
          logDebug(
            `moz:Debugging paused in context: ${info.context} at ${info.url}:${info.line}:${info.column}`
          );

          const waiters = this.pauseWaiters.get(info.context) ?? [];
          this.pauseWaiters.delete(info.context);
          for (const waiter of waiters) {
            waiter(info);
          }
        }

        if (payload?.method === 'moz:debugging.resumed') {
          this.pauseStates.delete(payload.params.context);
          logDebug(`moz:Debugging resumed in context: ${payload.params.context}`);
        }
      } catch {
        // Ignore event processing failures
      }
    });

    this.subscribed = true;
    logDebug('moz:debugging listener active');
  }

  getPauseState(contextId: string): PauseInfo | null {
    return this.pauseStates.get(contextId) || null;
  }

  waitForPause(contextId: string, timeoutInMs: number = 30000): Promise<PauseInfo> {
    return new Promise((resolve, reject) => {
      const existing = this.pauseStates.get(contextId);
      if (existing) {
        resolve(existing);
        return;
      }

      const timer = setTimeout(() => {
        const waiters = this.pauseWaiters.get(contextId);
        if (waiters) {
          const idx = waiters.indexOf(waiter);
          if (idx !== -1) {
            waiters.splice(idx, 1);
          }
        }
        reject(new Error(`Timed out waiting for pause on context ${contextId}`));
      }, timeoutInMs);

      const waiter = (info: PauseInfo) => {
        clearTimeout(timer);
        resolve(info);
      };

      if (!this.pauseWaiters.has(contextId)) {
        this.pauseWaiters.set(contextId, []);
      }
      this.pauseWaiters.get(contextId)!.push(waiter);
    });
  }
}
