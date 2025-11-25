/**
 * Task 10.2: Real-time Progress Display
 *
 * Implements progress display functionality for CLI
 *
 * Requirements: 8.3
 * - Display current dialog name and type
 * - Display processed message count and total
 * - Calculate and display estimated remaining time (ETA)
 * - Show FloodWait countdown
 */

import type { DialogType } from '../types/enums.js';

/**
 * Dialog information for display
 */
export interface DialogDisplayInfo {
  name: string;
  type: DialogType | string;
  totalMessages: number;
  processedMessages: number;
}

/**
 * Overall progress information
 */
export interface OverallProgressInfo {
  totalDialogs: number;
  completedDialogs: number;
  totalMessages: number;
  migratedMessages: number;
}

/**
 * Progress display options
 */
export interface ProgressDisplayOptions {
  colorEnabled?: boolean;
}

/**
 * Output callback type
 */
export type OutputCallback = (line: string) => void;

/**
 * FloodWait finish callback type
 */
export type FloodWaitFinishCallback = () => void;

/**
 * ANSI color codes
 */
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
} as const;

type ColorName = keyof typeof COLORS;

/**
 * Progress Display Service
 *
 * Handles formatting and displaying migration progress information
 */
export class ProgressDisplay {
  private colorEnabled: boolean;
  private startTime: number | null = null;
  private progressHistory: Array<{ count: number; time: number }> = [];
  private outputCallbacks: OutputCallback[] = [];
  private floodWaitFinishCallbacks: FloodWaitFinishCallback[] = [];
  private floodWaitInterval: ReturnType<typeof setInterval> | null = null;

  constructor(options: ProgressDisplayOptions = {}) {
    this.colorEnabled = options.colorEnabled ?? true;
  }

  /**
   * Register output callback
   */
  onOutput(callback: OutputCallback): void {
    this.outputCallbacks.push(callback);
  }

  /**
   * Register FloodWait finish callback
   */
  onFloodWaitFinish(callback: FloodWaitFinishCallback): void {
    this.floodWaitFinishCallbacks.push(callback);
  }

  /**
   * Emit output to all registered callbacks
   */
  private emit(line: string): void {
    for (const callback of this.outputCallbacks) {
      callback(line);
    }
  }

  /**
   * Format dialog information for display
   */
  formatDialogInfo(info: DialogDisplayInfo): string {
    const typeFormatted = this.formatDialogType(info.type);
    const progress = this.formatMessageProgress(
      info.processedMessages,
      info.totalMessages
    );

    return `${info.name} (${typeFormatted})\n${progress}`;
  }

  /**
   * Format dialog type to human-readable string
   */
  formatDialogType(type: DialogType | string): string {
    const typeMap: Record<string, string> = {
      private: 'Private Chat',
      group: 'Group',
      supergroup: 'Supergroup',
      channel: 'Channel',
      bot: 'Bot',
    };

    return typeMap[type] || type;
  }

  /**
   * Format message progress with count, total and percentage
   */
  formatMessageProgress(processed: number, total: number): string {
    const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
    return `${processed}/${total} (${percentage}%)`;
  }

  /**
   * Create a visual progress bar
   */
  createProgressBar(
    current: number,
    total: number,
    width: number = 20
  ): string {
    const ratio = total > 0 ? current / total : 0;
    const filled = Math.round(ratio * width);
    const empty = width - filled;

    const filledChar = this.colorEnabled ? this.colorize('=', 'green') : '=';
    const emptyChar = '-';

    return filledChar.repeat(filled) + emptyChar.repeat(empty);
  }

  /**
   * Record progress for ETA calculation
   */
  recordProgress(count: number, elapsedMs: number): void {
    this.progressHistory.push({ count, time: elapsedMs });

    // Keep only recent history for accurate rate calculation
    if (this.progressHistory.length > 10) {
      this.progressHistory.shift();
    }
  }

  /**
   * Calculate estimated time remaining in milliseconds
   *
   * @returns ETA in ms, or -1 if unknown
   */
  calculateETA(processed: number, total: number): number {
    if (this.progressHistory.length === 0) {
      return -1;
    }

    // Calculate rate from progress history
    const totalProcessed = this.progressHistory.reduce(
      (sum, p) => sum + p.count,
      0
    );
    const totalTime = this.progressHistory.reduce(
      (sum, p) => sum + p.time,
      0
    );

    if (totalTime === 0 || totalProcessed === 0) {
      return -1;
    }

    const rate = totalProcessed / totalTime; // messages per ms
    const remaining = total - processed;

    if (remaining <= 0) {
      return 0;
    }

    return Math.round(remaining / rate);
  }

  /**
   * Format ETA to human-readable string
   */
  formatETA(etaMs: number): string {
    if (etaMs < 0) {
      return '--:--';
    }

    const seconds = Math.floor(etaMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    const s = seconds % 60;
    const m = minutes % 60;
    const h = hours;

    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    } else if (m > 0) {
      return `${m}m ${s}s`;
    } else {
      return `${s}s`;
    }
  }

  /**
   * Format FloodWait display
   */
  formatFloodWait(seconds: number): string {
    const timeStr = this.formatWaitTime(seconds);
    return `FloodWait: Waiting ${timeStr}...`;
  }

  /**
   * Format wait time to human-readable string (seconds input)
   */
  formatWaitTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    const s = seconds % 60;
    const m = minutes % 60;
    const h = hours;

    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    } else if (m > 0) {
      return `${m}m ${s}s`;
    } else {
      return `${s}s`;
    }
  }

  /**
   * Start FloodWait countdown display
   */
  startFloodWaitCountdown(seconds: number): void {
    let remaining = seconds;

    // Clear any existing interval
    if (this.floodWaitInterval) {
      clearInterval(this.floodWaitInterval);
    }

    this.floodWaitInterval = setInterval(() => {
      remaining--;

      if (remaining <= 0) {
        if (this.floodWaitInterval) {
          clearInterval(this.floodWaitInterval);
          this.floodWaitInterval = null;
        }
        this.emit('FloodWait complete');
        for (const callback of this.floodWaitFinishCallbacks) {
          callback();
        }
      } else {
        this.emit(this.formatFloodWait(remaining));
      }
    }, 1000);
  }

  /**
   * Stop FloodWait countdown
   */
  stopFloodWaitCountdown(): void {
    if (this.floodWaitInterval) {
      clearInterval(this.floodWaitInterval);
      this.floodWaitInterval = null;
    }
  }

  /**
   * Format overall migration progress
   */
  formatOverallProgress(info: OverallProgressInfo): string {
    const dialogProgress = `Dialogs: ${info.completedDialogs}/${info.totalDialogs}`;
    const messageProgress = `Messages: ${info.migratedMessages}/${info.totalMessages}`;

    return `${dialogProgress} | ${messageProgress}`;
  }

  /**
   * Set migration start time
   */
  setStartTime(timestamp: number): void {
    this.startTime = timestamp;
  }

  /**
   * Get elapsed time since start in milliseconds
   */
  getElapsedTime(): number {
    if (!this.startTime) {
      return 0;
    }
    return Date.now() - this.startTime;
  }

  /**
   * Format elapsed time to human-readable string
   */
  formatElapsedTime(elapsedMs: number): string {
    const seconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    const s = seconds % 60;
    const m = minutes % 60;
    const h = hours;

    if (h > 0) {
      return `${h}h ${m}m ${s}s`;
    } else if (m > 0) {
      return `${m}m ${s}s`;
    } else {
      return `${s}s`;
    }
  }

  /**
   * Get ANSI code for clearing current line
   */
  getClearLineCode(): string {
    return '\r\x1b[K';
  }

  /**
   * Apply color to text
   */
  colorize(text: string, color: ColorName): string {
    if (!this.colorEnabled) {
      return text;
    }
    return `${COLORS[color]}${text}${COLORS.reset}`;
  }

  /**
   * Show a message (for integration with shutdown handler)
   */
  showMessage(message: string): void {
    this.emit(message);
  }

  /**
   * Clear progress history
   */
  clearHistory(): void {
    this.progressHistory = [];
    this.startTime = null;
  }
}
