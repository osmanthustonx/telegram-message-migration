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

import 'dotenv/config';
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

      // Load configuration
      const configLoader = new ConfigLoader();
      const configResult = configLoader.load();

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
      shutdownHandler.onShutdown(async () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        logService.info('Shutdown requested, saving progress...');
        // Progress is saved automatically by orchestrator after each dialog
        await client.disconnect();
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
        for (const [dialogId, dialogProgress] of progress.dialogs) {
          const statusIcon =
            dialogProgress.status === DialogStatus.Completed ? '✓' :
            dialogProgress.status === DialogStatus.Failed ? '✗' :
            dialogProgress.status === DialogStatus.InProgress ? '→' :
            dialogProgress.status === DialogStatus.Skipped ? '-' : '○';
          console.log(`  ${statusIcon} ${dialogId}: ${dialogProgress.status} (${dialogProgress.migratedCount} messages)`);
        }
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

  // Parse and execute command
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
