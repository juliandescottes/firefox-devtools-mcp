/**
 * Unit tests for DomInteractions.takeScreenshotPage
 */

import { describe, it, expect, vi } from 'vitest';
import { DomInteractions } from '../../src/firefox/dom.js';

function createDriver() {
  return {
    takeScreenshot: vi.fn().mockResolvedValue('viewport-png'),
    takeFullPageScreenshot: vi.fn().mockResolvedValue('full-page-png'),
  };
}

describe('DomInteractions.takeScreenshotPage', () => {
  it('should capture the viewport by default', async () => {
    const driver = createDriver();
    const dom = new DomInteractions(driver as never);

    expect(await dom.takeScreenshotPage()).toBe('viewport-png');
    expect(driver.takeFullPageScreenshot).not.toHaveBeenCalled();
  });

  it('should use the Firefox full page endpoint when fullPage is set', async () => {
    const driver = createDriver();
    const dom = new DomInteractions(driver as never);

    expect(await dom.takeScreenshotPage(true)).toBe('full-page-png');
    expect(driver.takeScreenshot).not.toHaveBeenCalled();
  });
});
