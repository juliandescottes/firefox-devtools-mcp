/**
 * Unit tests for DomInteractions.waitFor error handling
 */

import { describe, it, expect, vi } from 'vitest';
import type { BrowsingContext } from 'webdriver-bidi-protocol';
import { DomInteractions } from '../../../src/firefox/dom.js';
import type { BiDiFacade } from '../../../src/firefox/bidi.js';

const CONTEXT = 'context-1' as BrowsingContext.BrowsingContext;

function createDom(callFunction: () => Promise<unknown>) {
  const bidi = { callFunction: vi.fn(callFunction) } as unknown as BiDiFacade;
  return new DomInteractions(bidi);
}

describe('DomInteractions.waitFor', () => {
  it('should report the error of the last try instead of a timeout', async () => {
    const dom = createDom(async () => {
      throw new Error('Script evaluation failed: TypeError: el is null');
    });

    await expect(dom.waitFor(CONTEXT, { text: 'Ready', timeout: 0 })).rejects.toThrow(
      'TypeError: el is null'
    );
  });

  it('should keep waiting when an earlier try fails', async () => {
    const callFunction = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Script evaluation failed: no such frame'))
      .mockResolvedValue(true);
    const dom = createDom(callFunction);

    await expect(dom.waitFor(CONTEXT, { text: 'Ready', timeout: 5000 })).resolves.toBeTypeOf(
      'number'
    );
    expect(callFunction).toHaveBeenCalledTimes(2);
  });
});
