/**
 * Task 3.1: 實作多層級日誌服務
 *
 * 使用 winston 日誌框架實作 ILogService 介面
 *
 * Requirements: 7.1, 7.2, 7.5, 7.6
 * - 整合 winston 日誌框架並設定 Console 與 File 兩個輸出目標
 * - 支援 DEBUG、INFO、WARN、ERROR 四個日誌等級
 * - 在日誌中遮蔽電話號碼等敏感資訊
 * - 實作結構化日誌格式包含時間戳記與上下文資訊
 */

import winston from 'winston';
import type { ILogService } from '../types/interfaces.js';
import type {
  LogContext,
  MigrationProgress,
  MigrationReport,
  DialogReportEntry,
  FloodWaitSummary,
} from '../types/models.js';
import { LogLevel, DialogStatus } from '../types/enums.js';

/**
 * LogService 建構設定
 */
export interface LogServiceConfig {
  /** 日誌等級 */
  level: LogLevel;
  /** 日誌檔案路徑 */
  logFilePath: string;
  /** 是否啟用主控台輸出 (預設: true) */
  enableConsole?: boolean;
}

/**
 * 日誌服務實作
 *
 * 提供結構化日誌記錄與遷移報告產生功能
 */
export class LogService implements ILogService {
  private logger: winston.Logger;
  private currentLevel: LogLevel;

  constructor(config: LogServiceConfig) {
    this.currentLevel = config.level;

    // 建立 winston logger
    this.logger = winston.createLogger({
      level: config.level,
      format: winston.format.combine(
        winston.format.timestamp({ format: () => new Date().toISOString() }),
        winston.format.errors({ stack: true }),
        this.createMaskingFormat(),
        winston.format.json()
      ),
      transports: this.createTransports(config),
    });
  }

  /**
   * 建立日誌傳輸目標
   */
  private createTransports(config: LogServiceConfig): winston.transport[] {
    const transports: winston.transport[] = [];

    // 檔案輸出 (JSON 格式)
    transports.push(
      new winston.transports.File({
        filename: config.logFilePath,
        format: winston.format.combine(
          winston.format.timestamp({ format: () => new Date().toISOString() }),
          this.createMaskingFormat(),
          winston.format.json()
        ),
      })
    );

    // 主控台輸出 (彩色格式)
    if (config.enableConsole !== false) {
      transports.push(
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            this.createMaskingFormat(),
            winston.format.printf(({ level, message, timestamp, ...rest }) => {
              const contextStr = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
              return `${timestamp} [${level}] ${message}${contextStr}`;
            })
          ),
        })
      );
    }

    return transports;
  }

  /**
   * 建立敏感資訊遮蔽格式器
   */
  private createMaskingFormat(): winston.Logform.Format {
    return winston.format((info) => {
      // 遮蔽訊息中的敏感資訊
      if (typeof info.message === 'string') {
        info.message = this.maskSensitiveData(info.message);
      }

      // 遮蔽上下文中的敏感資訊
      for (const key of Object.keys(info)) {
        if (key !== 'level' && key !== 'message' && key !== 'timestamp') {
          if (typeof info[key] === 'string') {
            info[key] = this.maskSensitiveData(info[key]);
          }
        }
      }

      return info;
    })();
  }

  /**
   * 遮蔽敏感資訊
   *
   * - 電話號碼: +886912345678 -> +886****5678
   * - API Hash: abcdef1234567890abcdef1234567890 -> abcd****7890
   */
  private maskSensitiveData(value: string): string {
    let masked = value;

    // 遮蔽國際格式電話號碼 (+886912345678)
    masked = masked.replace(/(\+\d{3})(\d{4,})(\d{3})/g, (_, prefix, middle, suffix) => {
      return `${prefix}${'*'.repeat(middle.length)}${suffix}`;
    });

    // 遮蔽台灣格式電話號碼 (0912345678)
    masked = masked.replace(/\b(09)(\d{4,})(\d{2})\b/g, (_, prefix, middle, suffix) => {
      return `${prefix}${'*'.repeat(middle.length)}${suffix}`;
    });

    // 遮蔽 API Hash (32 字元的十六進位字串)
    masked = masked.replace(/\b([a-f0-9]{4})([a-f0-9]{24})([a-f0-9]{4})\b/gi, (_, prefix, middle, suffix) => {
      return `${prefix}${'*'.repeat(middle.length)}${suffix}`;
    });

    return masked;
  }

  /**
   * 記錄偵錯資訊
   */
  debug(message: string, context?: LogContext): void {
    this.logger.debug(message, context);
  }

  /**
   * 記錄一般資訊
   */
  info(message: string, context?: LogContext): void {
    this.logger.info(message, context);
  }

  /**
   * 記錄警告
   */
  warn(message: string, context?: LogContext): void {
    this.logger.warn(message, context);
  }

  /**
   * 記錄錯誤
   */
  error(message: string, error?: Error, context?: LogContext): void {
    const logData: Record<string, unknown> = { ...context };

    if (error) {
      logData.error = {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
    }

    this.logger.error(message, logData);
  }

  /**
   * 記錄 FloodWait 事件
   */
  logFloodWait(seconds: number, operation: string): void {
    this.logger.warn(`FloodWait: 等待 ${seconds} 秒後重試`, {
      seconds,
      operation,
    });
  }

  /**
   * 記錄訊息遷移事件
   */
  logMessageMigration(dialogId: string, messageCount: number, success: boolean): void {
    const level = success ? 'info' : 'warn';
    const status = success ? '成功' : '失敗';

    this.logger.log(level, `訊息遷移${status}: ${messageCount} 則訊息`, {
      dialogId,
      messageCount,
      success,
    });
  }

  /**
   * 產生遷移報告
   */
  generateReport(progress: MigrationProgress): MigrationReport {
    // 計算執行時間
    const startTime = new Date(progress.startedAt).getTime();
    const endTime = new Date(progress.updatedAt).getTime();
    const durationMs = endTime - startTime;
    const duration = this.formatDuration(durationMs);

    // 收集失敗對話
    const failedDialogs: DialogReportEntry[] = [];
    for (const [, dialog] of progress.dialogs) {
      if (dialog.status === DialogStatus.Failed) {
        failedDialogs.push({
          dialogId: dialog.dialogId,
          dialogName: dialog.dialogName,
          status: dialog.status,
          errors: dialog.errors.map((e) => e.errorMessage),
        });
      }
    }

    // 計算 FloodWait 摘要
    const floodWaitSummary = this.calculateFloodWaitSummary(progress.floodWaitEvents);

    // 建立摘要
    const summary = this.createSummary(progress, duration);

    return {
      summary,
      duration,
      statistics: progress.stats,
      failedDialogs,
      floodWaitSummary,
    };
  }

  /**
   * 設定日誌等級
   */
  setLevel(level: LogLevel): void {
    this.currentLevel = level;
    this.logger.level = level;
  }

  /**
   * 取得目前日誌等級
   */
  getLevel(): LogLevel {
    return this.currentLevel;
  }

  /**
   * 格式化執行時間
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours} 小時 ${minutes % 60} 分鐘`;
    } else if (minutes > 0) {
      return `${minutes} 分鐘 ${seconds % 60} 秒`;
    } else {
      return `${seconds} 秒`;
    }
  }

  /**
   * 計算 FloodWait 摘要
   */
  private calculateFloodWaitSummary(events: { seconds: number; operation: string }[]): FloodWaitSummary {
    if (events.length === 0) {
      return {
        totalEvents: 0,
        totalSeconds: 0,
        maxWaitSeconds: 0,
        mostFrequentOperation: null,
      };
    }

    const totalSeconds = events.reduce((sum, e) => sum + e.seconds, 0);
    const maxWaitSeconds = Math.max(...events.map((e) => e.seconds));

    // 計算最常觸發的操作
    const operationCounts = new Map<string, number>();
    for (const event of events) {
      operationCounts.set(event.operation, (operationCounts.get(event.operation) || 0) + 1);
    }

    let mostFrequentOperation: string | null = null;
    let maxCount = 0;
    for (const [operation, count] of operationCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostFrequentOperation = operation;
      }
    }

    return {
      totalEvents: events.length,
      totalSeconds,
      maxWaitSeconds,
      mostFrequentOperation,
    };
  }

  /**
   * 建立報告摘要
   */
  private createSummary(progress: MigrationProgress, duration: string): string {
    const { stats } = progress;
    const successRate = stats.totalDialogs > 0 ? ((stats.completedDialogs / stats.totalDialogs) * 100).toFixed(1) : 0;

    return (
      `遷移完成: ${stats.completedDialogs}/${stats.totalDialogs} 個對話 (${successRate}% 成功), ` +
      `${stats.migratedMessages}/${stats.totalMessages} 則訊息, ` +
      `執行時間: ${duration}`
    );
  }
}
