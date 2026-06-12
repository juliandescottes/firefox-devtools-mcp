import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DebuggingEvents } from '../../../src/firefox/events/debugging.js';
import type { PauseInfo } from '../../../src/firefox/types.js';

function makePauseInfo(contextId: string): PauseInfo {
  return {
    context: contextId,
    url: 'https://example.com/script.js',
    line: 10,
    column: 5,
    callFrames: [],
  };
}

function makeMockDriver() {
  const handlers: Record<string, Function[]> = {};
  const mockWs = {
    on: vi.fn((event: string, fn: Function) => {
      (handlers[event] ??= []).push(fn);
    }),
  };
  const mockBidi = {
    subscribe: vi.fn().mockResolvedValue(undefined),
    socket: mockWs,
  };
  return {
    driver: { getBidi: vi.fn().mockResolvedValue(mockBidi) } as any,
    mockBidi,
    mockWs,
    emit: (payload: unknown) =>
      handlers['message']?.forEach(h => h(JSON.stringify(payload))),
  };
}

describe('DebuggingEvents', () => {
  let mock: ReturnType<typeof makeMockDriver>;
  let events: DebuggingEvents;

  beforeEach(() => {
    mock = makeMockDriver();
    events = new DebuggingEvents(mock.driver);
  });

  it('getPauseState returns null before any pause', () => {
    expect(events.getPauseState('ctx-1')).toBeNull();
  });

  it('getPauseState returns pause info after a paused event', async () => {
    await events.subscribe();
    const info = makePauseInfo('ctx-1');
    mock.emit({ method: 'moz:debugging.paused', params: info });
    expect(events.getPauseState('ctx-1')).toEqual(info);
  });

  it('getPauseState returns null after a resumed event', async () => {
    await events.subscribe();
    mock.emit({ method: 'moz:debugging.paused', params: makePauseInfo('ctx-1') });
    mock.emit({ method: 'moz:debugging.resumed', params: { context: 'ctx-1' } });
    expect(events.getPauseState('ctx-1')).toBeNull();
  });

  it('waitForPause resolves immediately if already paused', async () => {
    await events.subscribe();
    mock.emit({ method: 'moz:debugging.paused', params: makePauseInfo('ctx-1') });
    const result = await events.waitForPause('ctx-1');
    expect(result.context).toBe('ctx-1');
  });

  it('waitForPause resolves when a pause event subsequently arrives', async () => {
    await events.subscribe();
    const promise = events.waitForPause('ctx-1');
    mock.emit({ method: 'moz:debugging.paused', params: makePauseInfo('ctx-1') });
    const result = await promise;
    expect(result.context).toBe('ctx-1');
  });

  it('waitForPause rejects after timeout', async () => {
    await events.subscribe();
    await expect(events.waitForPause('ctx-1', 50)).rejects.toThrow(/timed out/i);
  });

  it('two contexts can be paused independently', async () => {
    await events.subscribe();
    mock.emit({ method: 'moz:debugging.paused', params: makePauseInfo('ctx-1') });
    mock.emit({ method: 'moz:debugging.paused', params: makePauseInfo('ctx-2') });
    expect(events.getPauseState('ctx-1')).not.toBeNull();
    expect(events.getPauseState('ctx-2')).not.toBeNull();
    mock.emit({ method: 'moz:debugging.resumed', params: { context: 'ctx-1' } });
    expect(events.getPauseState('ctx-1')).toBeNull();
    expect(events.getPauseState('ctx-2')).not.toBeNull();
  });

  it('subscribe called twice only attaches one WebSocket listener', async () => {
    await events.subscribe();
    await events.subscribe();
    expect(mock.mockWs.on).toHaveBeenCalledTimes(1);
  });

  it('subscribe does not throw when bidi.subscribe rejects', async () => {
    mock.mockBidi.subscribe.mockRejectedValue(new Error('unsupported event'));
    await expect(events.subscribe()).resolves.not.toThrow();
  });
});
