/**
 * Task 3.2: 實作 FloodWait 事件追蹤與遷移報告產生
 *
 * 實作 IReportService 介面
 *
 * Requirements: 5.6, 7.4
 * - 記錄每次 FloodWait 事件的等待秒數與觸發操作
 * - 統計 FloodWait 發生次數與總等待時間
 * - 產生遷移完成報告包含對話統計、失敗清單、FloodWait 摘要
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { IReportService, FloodWaitStats } from '../types/interfaces.js';
import type {
  FloodWaitEvent,
  MigrationProgress,
  DetailedMigrationReport,
  MigrationReportError,
} from '../types/models.js';
import type { Result } from '../types/result.js';
import type { FileError } from '../types/errors.js';
import { success, failure } from '../types/result.js';
import { DialogStatus } from '../types/enums.js';

/**
 * 報告服務實作
 *
 * 追蹤 FloodWait 事件並產生遷移報告
 */
export class ReportService implements IReportService {
  /** 已記錄的 FloodWait 事件 */
  private floodWaitEvents: FloodWaitEvent[] = [];

  /**
   * 記錄 FloodWait 事件
   *
   * @param event - FloodWait 事件資訊
   */
  recordFloodWait(event: FloodWaitEvent): void {
    this.floodWaitEvents.push({ ...event });
  }

  /**
   * 取得 FloodWait 統計資訊
   *
   * @returns FloodWait 統計
   */
  getFloodWaitStats(): FloodWaitStats {
    if (this.floodWaitEvents.length === 0) {
      return {
        totalEvents: 0,
        totalWaitTime: 0,
        longestWait: 0,
      };
    }

    const totalWaitTime = this.floodWaitEvents.reduce((sum, e) => sum + e.seconds, 0);
    const longestWait = Math.max(...this.floodWaitEvents.map((e) => e.seconds));

    return {
      totalEvents: this.floodWaitEvents.length,
      totalWaitTime,
      longestWait,
    };
  }

  /**
   * 取得所有已記錄的 FloodWait 事件
   *
   * @returns FloodWait 事件列表（副本）
   */
  getFloodWaitEvents(): FloodWaitEvent[] {
    return [...this.floodWaitEvents];
  }

  /**
   * 清除所有已記錄的事件
   */
  clearEvents(): void {
    this.floodWaitEvents = [];
  }

  /**
   * 產生遷移報告
   *
   * @param progress - 遷移進度
   * @returns 詳細遷移報告
   */
  generateReport(progress: MigrationProgress): DetailedMigrationReport {
    const startedAt = new Date(progress.startedAt);
    const completedAt = new Date(progress.updatedAt);
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const duration = Math.floor(durationMs / 1000); // 秒

    // 合併 progress 中的 floodWaitEvents 與本服務記錄的事件
    const allFloodWaitEvents: FloodWaitEvent[] = [
      ...progress.floodWaitEvents,
      ...this.floodWaitEvents,
    ];

    // 計算 FloodWait 摘要
    const floodWaitSummary = this.calculateFloodWaitSummary(allFloodWaitEvents);

    // 收集錯誤清單
    const errors = this.collectErrors(progress);

    return {
      startedAt,
      completedAt,
      duration,
      totalDialogs: progress.stats.totalDialogs,
      completedDialogs: progress.stats.completedDialogs,
      failedDialogs: progress.stats.failedDialogs,
      skippedDialogs: progress.stats.skippedDialogs,
      totalMessages: progress.stats.totalMessages,
      migratedMessages: progress.stats.migratedMessages,
      failedMessages: progress.stats.failedMessages,
      floodWaitSummary,
      errors,
    };
  }

  /**
   * 將報告格式化為人類可讀的文字
   *
   * @param report - 詳細遷移報告
   * @returns 格式化的文字報告
   */
  formatReportAsText(report: DetailedMigrationReport): string {
    const lines: string[] = [];

    // 標題
    lines.push('========================================');
    lines.push('          Telegram 遷移報告');
    lines.push('========================================');
    lines.push('');

    // 時間資訊
    lines.push('--- 執行時間 ---');
    lines.push(`開始時間: ${this.formatDateTime(report.startedAt)}`);
    lines.push(`完成時間: ${this.formatDateTime(report.completedAt)}`);
    lines.push(`總執行時間: ${this.formatDuration(report.duration)}`);
    lines.push('');

    // 對話統計
    lines.push('--- 對話統計 ---');
    lines.push(`總對話數: ${report.totalDialogs}`);
    lines.push(`已完成: ${report.completedDialogs}`);
    lines.push(`失敗: ${report.failedDialogs}`);
    lines.push(`已跳過: ${report.skippedDialogs}`);
    const successRate =
      report.totalDialogs > 0
        ? ((report.completedDialogs / report.totalDialogs) * 100).toFixed(1)
        : '0.0';
    lines.push(`成功率: ${successRate}%`);
    lines.push('');

    // 訊息統計
    lines.push('--- 訊息統計 ---');
    lines.push(`總訊息數: ${report.totalMessages}`);
    lines.push(`已遷移: ${report.migratedMessages}`);
    lines.push(`失敗: ${report.failedMessages}`);
    const messageSuccessRate =
      report.totalMessages > 0
        ? ((report.migratedMessages / report.totalMessages) * 100).toFixed(1)
        : '0.0';
    lines.push(`成功率: ${messageSuccessRate}%`);
    lines.push('');

    // FloodWait 摘要
    if (report.floodWaitSummary.totalEvents > 0) {
      lines.push('--- FloodWait 摘要 ---');
      lines.push(`事件總數: ${report.floodWaitSummary.totalEvents}`);
      lines.push(`總等待時間: ${this.formatDuration(report.floodWaitSummary.totalWaitTime)}`);
      lines.push(`最長等待: ${report.floodWaitSummary.longestWait} 秒`);
      lines.push('');
    }

    // 失敗對話清單
    if (report.errors.length > 0) {
      lines.push('--- 失敗清單 ---');
      for (const error of report.errors) {
        lines.push(`- [${error.dialogId}] ${error.dialogName}`);
        lines.push(`  錯誤: ${error.error}`);
        lines.push(`  時間: ${error.timestamp}`);
      }
      lines.push('');
    }

    lines.push('========================================');
    lines.push('              報告結束');
    lines.push('========================================');

    return lines.join('\n');
  }

  /**
   * 將報告儲存至檔案
   *
   * @param report - 詳細遷移報告
   * @param filePath - 檔案路徑
   * @returns 成功或錯誤
   */
  async saveReportToFile(
    report: DetailedMigrationReport,
    filePath: string
  ): Promise<Result<void, FileError>> {
    try {
      // 確保目錄存在
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // 格式化並寫入檔案
      const content = this.formatReportAsText(report);
      await fs.writeFile(filePath, content, 'utf-8');

      return success(undefined);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return failure<void, FileError>({
        type: 'WRITE_FAILED',
        path: filePath,
        message: err.message,
      });
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * 計算 FloodWait 摘要
   */
  private calculateFloodWaitSummary(events: FloodWaitEvent[]): {
    totalEvents: number;
    totalWaitTime: number;
    longestWait: number;
    events: FloodWaitEvent[];
  } {
    if (events.length === 0) {
      return {
        totalEvents: 0,
        totalWaitTime: 0,
        longestWait: 0,
        events: [],
      };
    }

    const totalWaitTime = events.reduce((sum, e) => sum + e.seconds, 0);
    const longestWait = Math.max(...events.map((e) => e.seconds));

    return {
      totalEvents: events.length,
      totalWaitTime,
      longestWait,
      events: [...events],
    };
  }

  /**
   * 從遷移進度收集錯誤清單
   */
  private collectErrors(progress: MigrationProgress): MigrationReportError[] {
    const errors: MigrationReportError[] = [];

    for (const [, dialog] of progress.dialogs) {
      if (dialog.status === DialogStatus.Failed && dialog.errors.length > 0) {
        // 取最新的錯誤
        const latestError = dialog.errors[dialog.errors.length - 1];
        if (latestError) {
          errors.push({
            dialogId: dialog.dialogId,
            dialogName: dialog.dialogName,
            error: latestError.errorMessage,
            timestamp: latestError.timestamp,
          });
        }
      }
    }

    return errors;
  }

  /**
   * 格式化日期時間
   */
  private formatDateTime(date: Date): string {
    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  }

  /**
   * 格式化執行時間
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours} 小時 ${minutes} 分鐘 ${secs} 秒`;
    } else if (minutes > 0) {
      return `${minutes} 分鐘 ${secs} 秒`;
    } else {
      return `${secs} 秒`;
    }
  }
}
