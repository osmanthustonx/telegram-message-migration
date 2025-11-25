/**
 * Task 10.2: Real-time Progress Display Tests
 *
 * TDD Tests - Verify progress display implementation
 *
 * Requirements: 8.3
 * - Display current dialog name and type
 * - Display processed message count and total
 * - Calculate and display estimated remaining time (ETA)
 * - Show FloodWait countdown
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Progress Display Service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  describe('Current Dialog Display', () => {
    it('should display current dialog name', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      const output = display.formatDialogInfo({
        name: 'Test Dialog',
        type: 'private',
        totalMessages: 100,
        processedMessages: 0,
      });

      expect(output).toContain('Test Dialog');
    });

    it('should display current dialog type', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      const output = display.formatDialogInfo({
        name: 'Test Dialog',
        type: 'group',
        totalMessages: 100,
        processedMessages: 0,
      });

      // Dialog type is formatted to human readable (Group instead of group)
      expect(output).toContain('Group');
    });

    it('should format dialog type in readable format', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();

      expect(display.formatDialogType('private')).toBe('Private Chat');
      expect(display.formatDialogType('group')).toBe('Group');
      expect(display.formatDialogType('supergroup')).toBe('Supergroup');
      expect(display.formatDialogType('channel')).toBe('Channel');
      expect(display.formatDialogType('bot')).toBe('Bot');
    });
  });

  describe('Message Progress Display', () => {
    it('should display processed message count and total', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      const output = display.formatMessageProgress(50, 100);

      expect(output).toContain('50');
      expect(output).toContain('100');
    });

    it('should display progress percentage', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      const output = display.formatMessageProgress(50, 100);

      expect(output).toContain('50%');
    });

    it('should handle zero total messages gracefully', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      const output = display.formatMessageProgress(0, 0);

      expect(output).toContain('0%');
    });

    it('should display progress bar', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      // Create display without colors to test pure progress bar
      const display = new ProgressDisplay({ colorEnabled: false });
      const progressBar = display.createProgressBar(50, 100, 20);

      // Progress bar should have filled and empty portions (10 filled, 10 empty for 50%)
      expect(progressBar.length).toBe(20);
      expect(progressBar).toContain('='); // Filled portion
      expect(progressBar).toContain('-'); // Empty portion
    });
  });

  describe('ETA Calculation', () => {
    it('should calculate estimated remaining time', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();

      // Simulate processing 50 messages in 10 seconds (5 msg/sec)
      // Remaining 50 messages should take ~10 seconds
      display.recordProgress(50, 10000);

      const eta = display.calculateETA(50, 100); // 50 remaining

      // ETA should be approximately 10 seconds (10000 ms)
      expect(eta).toBeGreaterThan(8000);
      expect(eta).toBeLessThan(12000);
    });

    it('should format ETA in human readable format', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();

      expect(display.formatETA(5000)).toBe('5s');
      expect(display.formatETA(65000)).toBe('1m 5s');
      expect(display.formatETA(3665000)).toBe('1h 1m 5s');
    });

    it('should return unknown ETA when no progress recorded', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      const eta = display.calculateETA(50, 100);

      expect(eta).toBe(-1); // Unknown ETA
    });

    it('should format unknown ETA as dashes', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      const formatted = display.formatETA(-1);

      expect(formatted).toBe('--:--');
    });
  });

  describe('FloodWait Countdown Display', () => {
    it('should display FloodWait countdown', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      const output = display.formatFloodWait(60);

      // 60 seconds is formatted as "1m 0s"
      expect(output).toContain('1m 0s');
      expect(output.toLowerCase()).toContain('wait');
    });

    it('should format FloodWait time in human readable format', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();

      expect(display.formatWaitTime(30)).toBe('30s');
      expect(display.formatWaitTime(90)).toBe('1m 30s');
      expect(display.formatWaitTime(3700)).toBe('1h 1m 40s');
    });

    it('should update FloodWait countdown', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      const outputs: string[] = [];

      display.onOutput((line) => outputs.push(line));
      display.startFloodWaitCountdown(3);

      // Advance timer 1 second
      vi.advanceTimersByTime(1000);
      expect(outputs.some((o) => o.includes('2'))).toBe(true);

      // Advance timer another second
      vi.advanceTimersByTime(1000);
      expect(outputs.some((o) => o.includes('1'))).toBe(true);
    });

    it('should stop FloodWait countdown when finished', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      let finishCalled = false;

      display.onFloodWaitFinish(() => {
        finishCalled = true;
      });

      display.startFloodWaitCountdown(2);

      // Advance timer past countdown
      vi.advanceTimersByTime(3000);

      expect(finishCalled).toBe(true);
    });
  });

  describe('Overall Progress Display', () => {
    it('should display overall migration progress', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      const output = display.formatOverallProgress({
        totalDialogs: 10,
        completedDialogs: 5,
        totalMessages: 1000,
        migratedMessages: 500,
      });

      expect(output).toContain('5');
      expect(output).toContain('10');
      expect(output).toContain('500');
      expect(output).toContain('1000');
    });

    it('should display elapsed time', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();
      display.setStartTime(Date.now() - 3600000); // 1 hour ago

      const elapsed = display.getElapsedTime();
      const formatted = display.formatElapsedTime(elapsed);

      expect(formatted).toContain('1h');
    });
  });

  describe('Console Output', () => {
    it('should support clearing and rewriting lines', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay();

      // Should return ANSI codes for clearing line
      const clearCode = display.getClearLineCode();
      expect(clearCode).toContain('\r');
    });

    it('should support color output when terminal supports it', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay({ colorEnabled: true });

      const colored = display.colorize('test', 'green');
      // Should contain ANSI color codes
      expect(colored).toContain('\x1b[');
    });

    it('should strip colors when disabled', async () => {
      const { ProgressDisplay } = await import('../../src/cli/progress-display.js');

      const display = new ProgressDisplay({ colorEnabled: false });

      const plain = display.colorize('test', 'green');
      expect(plain).toBe('test');
    });
  });
});
