#!/usr/bin/env node
/**
 * Telegram Message Migration Tool
 *
 * CLI entry point for migrating messages from Telegram account A to account B.
 * Uses GramJS for Telegram MTProto API operations.
 *
 * Tasks: 10.1, 10.2, 10.3, 11.1, 11.2, 11.3
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.6
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { existsSync } from 'fs';

// 載入 .env 檔案（支援多個路徑）
function loadEnvFile(): void {
  // process.argv[0] 是 Node.js 執行檔路徑或 SEA 執行檔路徑
  const execPath = process.argv[0] ?? process.cwd();

  const possiblePaths = [
    // 1. 當前工作目錄
    path.resolve(process.cwd(), '.env'),
    // 2. 執行檔所在目錄（適用於 SEA executable）
    path.resolve(path.dirname(execPath), '.env'),
  ];

  for (const envPath of possiblePaths) {
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath });
      console.log(`[Config] Loaded .env from: ${envPath}`);
      return;
    }
  }

  // 如果找不到任何 .env，使用預設行為（不顯示警告，因為可能使用環境變數）
  dotenv.config();
}

loadEnvFile();
// @ts-expect-error - input module has no type declarations
import input from 'input';
import * as fs from 'fs/promises';
import { createProgram, validateStartupConfig } from './cli/program.js';
import { ProgressDisplay } from './cli/progress-display.js';
import { ShutdownHandler } from './cli/shutdown-handler.js';
import { ConfigLoader } from './services/config-loader.js';
import { LogService } from './services/log-service.js';
import { AuthService } from './services/auth-service.js';
import { ProgressService } from './services/progress-service.js';
import { MigrationOrchestrator } from './services/orchestrator.js';
import type { OrchestratorConfig } from './types/models.js';
import { DialogStatus } from './types/enums.js';

// Initialize components
const shutdownHandler = new ShutdownHandler();
const progressDisplay = new ProgressDisplay();

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Register shutdown handler
  shutdownHandler.register();

  // Connect progress display to shutdown handler
  shutdownHandler.onMessage((msg) => {
    progressDisplay.showMessage(msg);
  });

  // Create and parse CLI program
  const program = createProgram();

  // Override migrate command action to execute migration
  const migrateCmd = program.commands.find((cmd) => cmd.name() === 'migrate');
  if (migrateCmd) {
    migrateCmd.action(async (options, command) => {
      const globalOpts = command.optsWithGlobals();

      // Load configuration (interactive mode)
      const configLoader = new ConfigLoader();
      const configResult = await configLoader.loadInteractive();

      if (!configResult.success) {
        console.error(`Configuration error: ${configResult.error.type}`);
        if ('field' in configResult.error) {
          console.error(`  Field: ${configResult.error.field}`);
        }
        if ('message' in configResult.error) {
          console.error(`  Message: ${configResult.error.message}`);
        }
        process.exit(1);
      }

      const config = configResult.data;

      // Validate startup config
      const validationResult = validateStartupConfig({
        apiId: config.apiId,
        apiHash: config.apiHash,
        phoneNumberA: config.phoneNumberA,
        targetUserB: config.targetUserB,
      });

      if (!validationResult.success) {
        console.error(`Validation error: ${validationResult.error.type}`);
        if ('field' in validationResult.error) {
          console.error(`  Field: ${validationResult.error.field}`);
        }
        process.exit(1);
      }

      // Initialize logger
      const logService = new LogService({
        level: globalOpts.verbose ? 'debug' : globalOpts.quiet ? 'error' : config.logLevel,
        logFilePath: config.logFilePath,
        enableConsole: true,
      });

      logService.info('Migration tool started', {
        dryRun: String(options.dryRun),
        dialog: options.dialog ?? 'all',
        from: options.from ?? 'none',
        to: options.to ?? 'none',
      });

      // Debug: 顯示 dialogFilter 設定
      if (config.dialogFilter) {
        console.log('\n[Debug] Dialog filter settings:');
        if (config.dialogFilter.excludeTypes) {
          console.log(`  excludeTypes: ${config.dialogFilter.excludeTypes.join(', ')}`);
        }
        if (config.dialogFilter.includeTypes) {
          console.log(`  includeTypes: ${config.dialogFilter.includeTypes.join(', ')}`);
        }
      } else {
        console.log('\n[Debug] No dialog filter configured');
      }

      // Set up progress display
      progressDisplay.setStartTime(Date.now());

      // Initialize AuthService with interactive prompts
      const authService = new AuthService({
        codePrompt: async (): Promise<string> => {
          return await input.text('Please enter the verification code: ');
        },
        passwordPrompt: async (): Promise<string> => {
          return await input.password('Please enter your 2FA password: ');
        },
      });

      // Authenticate with Telegram
      logService.info('Authenticating with Telegram...');
      const authResult = await authService.authenticate({
        apiId: config.apiId,
        apiHash: config.apiHash,
        phoneNumber: config.phoneNumberA,
        sessionPath: config.sessionPath,
      });

      if (!authResult.success) {
        const authError = authResult.error as { type: string; message?: string };
        logService.error(`Authentication failed: ${authError.message ?? authError.type}`);
        console.error(`Authentication failed: ${authError.type}`);
        if (authError.message) {
          console.error(`  Message: ${authError.message}`);
        }
        process.exit(1);
      }

      const client = authResult.data;
      logService.info('Authentication successful');

      // Build orchestrator config
      const orchestratorConfig: OrchestratorConfig = {
        apiId: config.apiId,
        apiHash: config.apiHash,
        sessionPath: config.sessionPath,
        targetAccountB: config.targetUserB,
        progressPath: globalOpts.progress || config.progressPath,
        batchSize: config.batchSize,
        groupNamePrefix: config.groupNamePrefix,
        logLevel: config.logLevel,
        logFilePath: config.logFilePath,
        dialogFilter: options.dialog
          ? { includeIds: [options.dialog] }
          : config.dialogFilter,
        dateRange: options.from || options.to
          ? {
              from: options.from ? new Date(options.from) : undefined,
              to: options.to ? new Date(options.to) : undefined,
            }
          : config.dateRange,
        maxFloodWaitSeconds: config.floodWaitThreshold,
        groupCreationDelayMs: config.groupCreationDelayMs,
      };

      // Create orchestrator
      const orchestrator = new MigrationOrchestrator(orchestratorConfig);

      // Connect shutdown handler to orchestrator
      let isShuttingDown = false;

      // 註冊保存進度回調（Ctrl+C 時會呼叫）
      shutdownHandler.onSaveProgress(async () => {
        logService.info('Saving progress before shutdown...');
        const saved = await orchestrator.saveCurrentProgress();
        if (saved) {
          logService.info('Progress saved successfully');
        }
      });

      // 註冊關閉回調
      shutdownHandler.onShutdown(async () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        logService.info('Shutdown requested...');

        // 請求 orchestrator 停止遷移迴圈
        orchestrator.requestShutdown();

        // 斷開連線
        try {
          await client.disconnect();
          logService.info('Disconnected from Telegram');
        } catch (err) {
          const disconnectError = err instanceof Error ? err : new Error(String(err));
          logService.error('Error disconnecting', disconnectError);
        }
      });

      // 註冊強制退出回調
      shutdownHandler.onForceExit(() => {
        logService.warn('Force exit triggered');
        process.exit(1);
      });

      // Run migration
      logService.info('Starting migration...', { dryRun: String(options.dryRun) });

      const migrationResult = await orchestrator.runMigration(client, {
        dryRun: options.dryRun,
        maxRetries: 3,
      });

      if (migrationResult.success) {
        const result = migrationResult.data;
        logService.info('Migration completed', {
          totalDialogs: String(result.totalDialogs),
          completedDialogs: String(result.completedDialogs),
          failedDialogs: String(result.failedDialogs),
          duration: String(result.duration),
        });

        console.log('\n=== Migration Summary ===');
        console.log(`Total dialogs: ${result.totalDialogs}`);
        if (result.filteredDialogs > 0) {
          console.log(`Filtered out: ${result.filteredDialogs} (by type filter)`);
        }
        console.log(`Completed: ${result.completedDialogs}`);
        console.log(`Skipped: ${result.skippedDialogs}`);
        console.log(`Failed: ${result.failedDialogs}`);
        console.log(`Total messages: ${result.totalMessages}`);
        console.log(`Migrated: ${result.migratedMessages}`);
        console.log(`Failed messages: ${result.failedMessages}`);
        console.log(`Duration: ${result.duration} seconds`);

        if (options.dryRun) {
          console.log('\n(Dry run mode - no actual changes were made)');
        }
      } else {
        const errorMsg = 'message' in migrationResult.error
          ? migrationResult.error.message
          : migrationResult.error.type;
        logService.error(`Migration failed: ${errorMsg}`);
        console.error(`Migration failed: ${migrationResult.error.type}`);
        if ('message' in migrationResult.error) {
          console.error(`  Message: ${migrationResult.error.message}`);
        }
        process.exit(1);
      }

      // Disconnect client
      await client.disconnect();
      logService.info('Disconnected from Telegram');
    });
  }

  // Override status command action
  const statusCmd = program.commands.find((cmd) => cmd.name() === 'status');
  if (statusCmd) {
    statusCmd.action(async (_options, command) => {
      const globalOpts = command.optsWithGlobals();
      const progressPath = globalOpts.progress || './migration-progress.json';

      console.log(`Migration Status (from ${progressPath})`);
      console.log('='.repeat(50));

      const progressService = new ProgressService();
      const loadResult = await progressService.load(progressPath);

      if (!loadResult.success) {
        console.log('No progress file found or file is invalid.');
        console.log(`Error: ${loadResult.error.type}`);
        return;
      }

      const progress = loadResult.data;
      console.log(`Started at: ${progress.startedAt}`);
      console.log(`Last updated: ${progress.updatedAt}`);
      console.log(`Current phase: ${progress.currentPhase}`);
      console.log(`Source account: ${progress.sourceAccount || 'N/A'}`);
      console.log(`Target account: ${progress.targetAccount}`);
      console.log('');
      console.log('Statistics:');
      console.log(`  Total dialogs: ${progress.stats.totalDialogs}`);
      console.log(`  Completed: ${progress.stats.completedDialogs}`);
      console.log(`  Failed: ${progress.stats.failedDialogs}`);
      console.log(`  Skipped: ${progress.stats.skippedDialogs}`);
      console.log(`  Total messages: ${progress.stats.totalMessages}`);
      console.log(`  Migrated: ${progress.stats.migratedMessages}`);
      console.log(`  Failed messages: ${progress.stats.failedMessages}`);
      console.log(`  FloodWait events: ${progress.stats.floodWaitCount}`);
      console.log(`  Total FloodWait time: ${progress.stats.totalFloodWaitSeconds}s`);

      // Show dialog details
      if (progress.dialogs.size > 0) {
        console.log('');
        console.log('Dialog Status:');
        console.log('-'.repeat(80));
        console.log('  Status  ID'.padEnd(25) + 'Name'.padEnd(35) + 'Messages');
        console.log('-'.repeat(80));
        for (const [dialogId, dialogProgress] of progress.dialogs) {
          const statusIcon =
            dialogProgress.status === DialogStatus.Completed ? '✓' :
            dialogProgress.status === DialogStatus.Failed ? '✗' :
            dialogProgress.status === DialogStatus.InProgress ? '→' :
            dialogProgress.status === DialogStatus.Skipped ? '-' : '○';
          const idStr = `  ${statusIcon}     ${dialogId}`.padEnd(25);
          const nameStr = (dialogProgress.dialogName || 'Unknown').substring(0, 33).padEnd(35);
          const msgStr = `${dialogProgress.migratedCount}/${dialogProgress.totalCount}`;
          console.log(`${idStr}${nameStr}${msgStr}`);
        }
        console.log('-'.repeat(80));
        console.log('\nTo reset a dialog: tg-migrate reset --dialog <ID>');
        console.log('To reset all:      tg-migrate reset --all');
      }
    });
  }

  // Override export command action
  const exportCmd = program.commands.find((cmd) => cmd.name() === 'export');
  if (exportCmd) {
    exportCmd.action(async (output, _options, command) => {
      const globalOpts = command.optsWithGlobals();
      const progressPath = globalOpts.progress || './migration-progress.json';

      console.log(`Exporting progress from ${progressPath} to ${output}...`);

      const progressService = new ProgressService();
      const loadResult = await progressService.load(progressPath);

      if (!loadResult.success) {
        console.error(`Failed to load progress: ${loadResult.error.type}`);
        process.exit(1);
      }

      try {
        const exportData = progressService.exportProgress(loadResult.data);
        await fs.writeFile(output, exportData, 'utf-8');
        console.log(`Progress exported successfully to ${output}`);
      } catch (error) {
        console.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
  }

  // Override import command action
  const importCmd = program.commands.find((cmd) => cmd.name() === 'import');
  if (importCmd) {
    importCmd.action(async (file, _options, command) => {
      const globalOpts = command.optsWithGlobals();
      const progressPath = globalOpts.progress || './migration-progress.json';

      console.log(`Importing progress from ${file} to ${progressPath}...`);

      const progressService = new ProgressService();

      try {
        const fileContent = await fs.readFile(file, 'utf-8');
        const importResult = progressService.importProgress(fileContent);

        if (!importResult.success) {
          console.error(`Failed to import progress: ${importResult.error.type}`);
          if ('message' in importResult.error) {
            console.error(`  Message: ${importResult.error.message}`);
          }
          process.exit(1);
        }

        const saveResult = await progressService.save(progressPath, importResult.data);

        if (saveResult.success) {
          console.log(`Progress imported successfully to ${progressPath}`);
        } else {
          console.error(`Save failed: ${saveResult.error.type}`);
          process.exit(1);
        }
      } catch (error) {
        console.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
  }

  // Override list command action - 列出所有對話
  const listCmd = program.commands.find((cmd) => cmd.name() === 'list');
  if (listCmd) {
    listCmd.action(async (options, _command) => {
      // Load configuration
      const configLoader = new ConfigLoader();
      const configResult = await configLoader.loadInteractive();

      if (!configResult.success) {
        console.error(`Configuration error: ${configResult.error.type}`);
        process.exit(1);
      }

      const config = configResult.data;

      // Initialize AuthService
      const authService = new AuthService({
        codePrompt: async (): Promise<string> => {
          return await input.text('Please enter the verification code: ');
        },
        passwordPrompt: async (): Promise<string> => {
          return await input.password('Please enter your 2FA password: ');
        },
      });

      // Authenticate
      console.log('\nAuthenticating with Telegram...');
      const authResult = await authService.authenticate({
        apiId: config.apiId,
        apiHash: config.apiHash,
        phoneNumber: config.phoneNumberA,
        sessionPath: config.sessionPath,
      });

      if (!authResult.success) {
        const authError = authResult.error as { type: string; message?: string };
        console.error(`Authentication failed: ${authError.message ?? authError.type}`);
        process.exit(1);
      }

      const client = authResult.data;
      console.log('Authentication successful\n');

      // Get dialogs
      const { DialogService } = await import('./services/dialog-service.js');
      const dialogService = new DialogService();
      const dialogsResult = await dialogService.getAllDialogs(client);

      if (!dialogsResult.success) {
        console.error(`Failed to get dialogs: ${dialogsResult.error.type}`);
        await client.disconnect();
        process.exit(1);
      }

      let dialogs = dialogsResult.data;

      // Apply type filter if specified
      if (options.type) {
        dialogs = dialogs.filter(d => d.type === options.type);
      }

      // Apply config filter (excludeTypes)
      if (config.dialogFilter?.excludeTypes) {
        dialogs = dialogs.filter(d => !config.dialogFilter!.excludeTypes!.includes(d.type));
      }

      // Display dialogs
      console.log('='.repeat(80));
      console.log('ID'.padEnd(15) + 'Type'.padEnd(12) + 'Messages'.padEnd(10) + 'Name');
      console.log('='.repeat(80));

      for (const dialog of dialogs) {
        const id = dialog.id.padEnd(15);
        const type = dialog.type.padEnd(12);
        const msgCount = dialog.messageCount.toString().padEnd(10);
        console.log(`${id}${type}${msgCount}${dialog.name}`);
      }

      console.log('='.repeat(80));
      console.log(`Total: ${dialogs.length} dialogs`);

      if (config.dialogFilter?.excludeTypes) {
        console.log(`(Filtered out types: ${config.dialogFilter.excludeTypes.join(', ')})`);
      }

      // Disconnect
      await client.disconnect();
    });
  }

  // Override reset command action - 重置遷移進度
  const resetCmd = program.commands.find((cmd) => cmd.name() === 'reset');
  if (resetCmd) {
    resetCmd.action(async (options, command) => {
      const globalOpts = command.optsWithGlobals();
      const progressPath = globalOpts.progress || './migration-progress.json';

      // 驗證參數
      if (!options.dialog && !options.all) {
        console.error('Error: Must specify --dialog <ids> or --all');
        console.log('\nUsage examples:');
        console.log('  tg-migrate reset --dialog 123456789       # Reset specific dialog');
        console.log('  tg-migrate reset --dialog 123,456,789     # Reset multiple dialogs');
        console.log('  tg-migrate reset --all                    # Reset all dialogs');
        console.log('  tg-migrate reset --all --force            # Reset all without confirmation');
        process.exit(1);
      }

      const progressService = new ProgressService();
      const loadResult = await progressService.load(progressPath);

      if (!loadResult.success) {
        console.log('No progress file found. Nothing to reset.');
        return;
      }

      const progress = loadResult.data;

      if (options.all) {
        // 重置所有對話
        if (!options.force) {
          const dialogCount = progress.dialogs.size;
          const confirm = await input.text(
            `Are you sure you want to reset ALL ${dialogCount} dialogs? (yes/no): `
          );
          if (confirm.toLowerCase() !== 'yes') {
            console.log('Reset cancelled.');
            return;
          }
        }

        // 清空所有對話進度
        const dialogIds = Array.from(progress.dialogs.keys());
        for (const dialogId of dialogIds) {
          progress.dialogs.delete(dialogId);
        }

        // 重置統計
        progress.stats = {
          totalDialogs: 0,
          completedDialogs: 0,
          failedDialogs: 0,
          skippedDialogs: 0,
          totalMessages: 0,
          migratedMessages: 0,
          failedMessages: 0,
          floodWaitCount: 0,
          totalFloodWaitSeconds: 0,
        };

        progress.updatedAt = new Date().toISOString();
        progress.currentPhase = 'idle';

        const saveResult = await progressService.save(progressPath, progress);
        if (saveResult.success) {
          console.log(`✓ Reset all ${dialogIds.length} dialogs successfully.`);
          console.log(`  Progress file: ${progressPath}`);
        } else {
          console.error(`Failed to save progress: ${saveResult.error.type}`);
          process.exit(1);
        }
      } else if (options.dialog) {
        // 重置指定對話
        const dialogIds = options.dialog.split(',').map((id: string) => id.trim());
        const resetIds: string[] = [];
        const notFoundIds: string[] = [];

        for (const dialogId of dialogIds) {
          if (progress.dialogs.has(dialogId)) {
            progress.dialogs.delete(dialogId);
            resetIds.push(dialogId);
          } else {
            notFoundIds.push(dialogId);
          }
        }

        if (resetIds.length > 0) {
          // 更新統計（重新計算）
          let completedCount = 0;
          let failedCount = 0;
          let skippedCount = 0;
          let migratedMessages = 0;
          let failedMessages = 0;

          for (const dialogProgress of progress.dialogs.values()) {
            if (dialogProgress.status === DialogStatus.Completed) completedCount++;
            else if (dialogProgress.status === DialogStatus.Failed) failedCount++;
            else if (dialogProgress.status === DialogStatus.Skipped) skippedCount++;
            migratedMessages += dialogProgress.migratedCount;
            failedMessages += dialogProgress.errors.length;
          }

          progress.stats.totalDialogs = progress.dialogs.size;
          progress.stats.completedDialogs = completedCount;
          progress.stats.failedDialogs = failedCount;
          progress.stats.skippedDialogs = skippedCount;
          progress.stats.migratedMessages = migratedMessages;
          progress.stats.failedMessages = failedMessages;
          progress.updatedAt = new Date().toISOString();

          const saveResult = await progressService.save(progressPath, progress);
          if (saveResult.success) {
            console.log(`✓ Reset ${resetIds.length} dialog(s) successfully:`);
            for (const id of resetIds) {
              console.log(`  - ${id}`);
            }
          } else {
            console.error(`Failed to save progress: ${saveResult.error.type}`);
            process.exit(1);
          }
        }

        if (notFoundIds.length > 0) {
          console.log(`\n⚠ Dialog(s) not found in progress file:`);
          for (const id of notFoundIds) {
            console.log(`  - ${id}`);
          }
        }

        if (resetIds.length === 0) {
          console.log('No dialogs were reset.');
        }
      }
    });
  }

  // Parse and execute command
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
