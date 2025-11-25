/**
 * Task 10.3: Safe Interrupt Mechanism Tests
 *
 * TDD Tests - Verify safe shutdown implementation
 *
 * Requirements: 8.6
 * - Register SIGINT (Ctrl+C) signal handler
 * - Save current progress when interrupt signal received
 * - Complete current batch before exiting
 * - Display progress saved confirmation message
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Shutdown Handler', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Signal Registration', () => {
    it('should register SIGINT handler', async () => {
      const processSpy = vi.spyOn(process, 'on');
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      handler.register();

      expect(processSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });

    it('should register SIGTERM handler', async () => {
      const processSpy = vi.spyOn(process, 'on');
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      handler.register();

      expect(processSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });

    it('should unregister handlers on cleanup', async () => {
      const processOffSpy = vi.spyOn(process, 'off');
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      handler.register();
      handler.unregister();

      expect(processOffSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(processOffSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });
  });

  describe('Shutdown State', () => {
    it('should set shutting down flag when signal received', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      expect(handler.isShuttingDown()).toBe(false);

      handler.initiateShutdown();

      expect(handler.isShuttingDown()).toBe(true);
    });

    it('should not allow multiple shutdowns', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      let shutdownCount = 0;

      handler.onShutdown(() => {
        shutdownCount++;
        return Promise.resolve();
      });

      await handler.initiateShutdown();
      await handler.initiateShutdown();

      expect(shutdownCount).toBe(1);
    });
  });

  describe('Progress Saving', () => {
    it('should call progress save callback on shutdown', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      let saveCalled = false;

      handler.onSaveProgress(async () => {
        saveCalled = true;
      });

      await handler.initiateShutdown();

      expect(saveCalled).toBe(true);
    });

    it('should wait for progress save to complete', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      let saveCompleted = false;

      handler.onSaveProgress(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        saveCompleted = true;
      });

      await handler.initiateShutdown();

      expect(saveCompleted).toBe(true);
    });

    it('should handle progress save errors gracefully', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      handler.onSaveProgress(async () => {
        throw new Error('Save failed');
      });

      // Should not throw
      await expect(handler.initiateShutdown()).resolves.not.toThrow();

      // Should log error
      expect(consoleSpy).toHaveBeenCalled();
    });
  });

  describe('Batch Completion', () => {
    it('should wait for current batch to complete', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      let batchCompleted = false;

      handler.onBatchComplete(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        batchCompleted = true;
      });

      await handler.initiateShutdown();

      expect(batchCompleted).toBe(true);
    });

    it('should execute batch completion before progress save', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      const executionOrder: string[] = [];

      handler.onBatchComplete(async () => {
        executionOrder.push('batch');
      });

      handler.onSaveProgress(async () => {
        executionOrder.push('save');
      });

      await handler.initiateShutdown();

      expect(executionOrder).toEqual(['batch', 'save']);
    });

    it('should support setting batch in progress', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();

      handler.setBatchInProgress(true);
      expect(handler.isBatchInProgress()).toBe(true);

      handler.setBatchInProgress(false);
      expect(handler.isBatchInProgress()).toBe(false);
    });
  });

  describe('Confirmation Messages', () => {
    it('should display shutting down message', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      const messages: string[] = [];

      handler.onMessage((msg) => messages.push(msg));
      await handler.initiateShutdown();

      expect(messages.some((m) => m.toLowerCase().includes('shutdown'))).toBe(true);
    });

    it('should display progress saved confirmation', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      const messages: string[] = [];

      handler.onSaveProgress(async () => {});
      handler.onMessage((msg) => messages.push(msg));
      await handler.initiateShutdown();

      expect(messages.some((m) => m.toLowerCase().includes('progress') && m.toLowerCase().includes('saved'))).toBe(true);
    });

    it('should display completion message', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();
      const messages: string[] = [];

      handler.onMessage((msg) => messages.push(msg));
      await handler.initiateShutdown();

      expect(messages.some((m) => m.toLowerCase().includes('complete') || m.toLowerCase().includes('exit'))).toBe(true);
    });
  });

  describe('Timeout Handling', () => {
    it('should force exit after timeout', async () => {
      vi.useFakeTimers();
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler({ forceExitTimeout: 5000 });
      let forceExitCalled = false;

      handler.onForceExit(() => {
        forceExitCalled = true;
      });

      // Start shutdown but don't complete callbacks
      handler.onBatchComplete(async () => {
        await new Promise(() => {}); // Never resolves
      });

      // Start shutdown without awaiting (won't complete)
      handler.initiateShutdown();

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(6000);

      expect(forceExitCalled).toBe(true);

      vi.useRealTimers();
    });

    it('should clear timeout on successful shutdown', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler({ forceExitTimeout: 5000 });
      let forceExitCalled = false;

      handler.onForceExit(() => {
        forceExitCalled = true;
      });

      await handler.initiateShutdown();

      // Wait a bit to ensure no force exit
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(forceExitCalled).toBe(false);
    });
  });

  describe('Integration with Migration', () => {
    it('should provide a way to check shutdown during migration loop', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();

      // Simulate migration loop checking for shutdown
      let iterations = 0;
      const maxIterations = 100;

      while (iterations < maxIterations && !handler.isShuttingDown()) {
        iterations++;
        if (iterations === 50) {
          handler.initiateShutdown();
        }
      }

      expect(iterations).toBe(50);
    });

    it('should provide promise for shutdown completion', async () => {
      const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');

      const handler = new ShutdownHandler();

      const shutdownPromise = handler.getShutdownPromise();
      expect(shutdownPromise).toBeInstanceOf(Promise);

      handler.initiateShutdown();

      // Should resolve after shutdown completes
      await expect(shutdownPromise).resolves.toBeUndefined();
    });
  });
});

describe('Graceful Shutdown Integration', () => {
  it('should coordinate between progress display and shutdown', async () => {
    const { ShutdownHandler } = await import('../../src/cli/shutdown-handler.js');
    const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

    const handler = new ShutdownHandler();
    const display = new ProgressDisplay();
    const outputs: string[] = [];

    display.onOutput((line) => outputs.push(line));

    handler.onMessage((msg) => {
      display.showMessage(msg);
    });

    await handler.initiateShutdown();

    expect(outputs.length).toBeGreaterThan(0);
  });
});
