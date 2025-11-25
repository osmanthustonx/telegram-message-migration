/**
 * Task 10.3: Safe Interrupt Mechanism
 *
 * Implements graceful shutdown handling for CLI
 *
 * Requirements: 8.6
 * - Register SIGINT (Ctrl+C) signal handler
 * - Save current progress when interrupt signal received
 * - Complete current batch before exiting
 * - Display progress saved confirmation message
 */

/**
 * Shutdown handler options
 */
export interface ShutdownHandlerOptions {
  /** Force exit timeout in milliseconds (default: 30000) */
  forceExitTimeout?: number;
}

/**
 * Async callback type
 */
export type AsyncCallback = () => Promise<void>;

/**
 * Message callback type
 */
export type MessageCallback = (message: string) => void;

/**
 * Force exit callback type
 */
export type ForceExitCallback = () => void;

/**
 * Shutdown Handler
 *
 * Manages graceful shutdown when receiving SIGINT or SIGTERM signals.
 * Ensures current batch completes and progress is saved before exiting.
 */
export class ShutdownHandler {
  private shuttingDown: boolean = false;
  private batchInProgress: boolean = false;
  private forceExitTimeout: number;

  private sigintHandler: (() => void) | null = null;
  private sigtermHandler: (() => void) | null = null;

  private shutdownCallbacks: AsyncCallback[] = [];
  private saveProgressCallbacks: AsyncCallback[] = [];
  private batchCompleteCallbacks: AsyncCallback[] = [];
  private messageCallbacks: MessageCallback[] = [];
  private forceExitCallbacks: ForceExitCallback[] = [];

  private shutdownPromiseResolve: (() => void) | null = null;
  private shutdownPromise: Promise<void>;
  private forceExitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ShutdownHandlerOptions = {}) {
    this.forceExitTimeout = options.forceExitTimeout ?? 30000;

    // Create shutdown promise
    this.shutdownPromise = new Promise((resolve) => {
      this.shutdownPromiseResolve = resolve;
    });
  }

  /**
   * Register signal handlers
   */
  register(): void {
    this.sigintHandler = (): void => {
      this.initiateShutdown();
    };

    this.sigtermHandler = (): void => {
      this.initiateShutdown();
    };

    process.on('SIGINT', this.sigintHandler);
    process.on('SIGTERM', this.sigtermHandler);
  }

  /**
   * Unregister signal handlers
   */
  unregister(): void {
    if (this.sigintHandler) {
      process.off('SIGINT', this.sigintHandler);
      this.sigintHandler = null;
    }

    if (this.sigtermHandler) {
      process.off('SIGTERM', this.sigtermHandler);
      this.sigtermHandler = null;
    }

    // Clear force exit timer
    if (this.forceExitTimer) {
      clearTimeout(this.forceExitTimer);
      this.forceExitTimer = null;
    }
  }

  /**
   * Check if shutdown is in progress
   */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Set batch in progress flag
   */
  setBatchInProgress(inProgress: boolean): void {
    this.batchInProgress = inProgress;
  }

  /**
   * Check if batch is in progress
   */
  isBatchInProgress(): boolean {
    return this.batchInProgress;
  }

  /**
   * Register shutdown callback
   */
  onShutdown(callback: AsyncCallback): void {
    this.shutdownCallbacks.push(callback);
  }

  /**
   * Register save progress callback
   */
  onSaveProgress(callback: AsyncCallback): void {
    this.saveProgressCallbacks.push(callback);
  }

  /**
   * Register batch complete callback
   */
  onBatchComplete(callback: AsyncCallback): void {
    this.batchCompleteCallbacks.push(callback);
  }

  /**
   * Register message callback
   */
  onMessage(callback: MessageCallback): void {
    this.messageCallbacks.push(callback);
  }

  /**
   * Register force exit callback
   */
  onForceExit(callback: ForceExitCallback): void {
    this.forceExitCallbacks.push(callback);
  }

  /**
   * Get shutdown promise
   */
  getShutdownPromise(): Promise<void> {
    return this.shutdownPromise;
  }

  /**
   * Emit message to all message callbacks
   */
  private emitMessage(message: string): void {
    for (const callback of this.messageCallbacks) {
      callback(message);
    }
  }

  /**
   * Initiate graceful shutdown
   */
  async initiateShutdown(): Promise<void> {
    // Prevent multiple shutdowns
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    this.emitMessage('Shutdown initiated, completing current operations...');

    // Start force exit timer
    this.forceExitTimer = setTimeout(() => {
      this.emitMessage('Force exit timeout reached, terminating...');
      for (const callback of this.forceExitCallbacks) {
        callback();
      }
    }, this.forceExitTimeout);

    try {
      // Execute batch complete callbacks first
      for (const callback of this.batchCompleteCallbacks) {
        try {
          await callback();
        } catch (error) {
          console.error('Error in batch complete callback:', error);
        }
      }

      // Execute save progress callbacks
      for (const callback of this.saveProgressCallbacks) {
        try {
          await callback();
        } catch (error) {
          console.error('Error saving progress:', error);
        }
      }
      this.emitMessage('Progress saved successfully.');

      // Execute general shutdown callbacks
      for (const callback of this.shutdownCallbacks) {
        try {
          await callback();
        } catch (error) {
          console.error('Error in shutdown callback:', error);
        }
      }

      this.emitMessage('Shutdown complete. Exiting...');
    } finally {
      // Clear force exit timer on successful shutdown
      if (this.forceExitTimer) {
        clearTimeout(this.forceExitTimer);
        this.forceExitTimer = null;
      }

      // Resolve shutdown promise
      if (this.shutdownPromiseResolve) {
        this.shutdownPromiseResolve();
      }
    }
  }
}
