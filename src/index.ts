#!/usr/bin/env node
/**
 * Telegram Message Migration Tool
 *
 * CLI entry point for migrating messages from Telegram account A to account B.
 * Uses GramJS for Telegram MTProto API operations.
 *
 * Tasks: 10.1, 10.2, 10.3
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.6
 */

import 'dotenv/config';
import { createProgram, validateStartupConfig } from './cli/program.js';
import { ProgressDisplay } from './cli/progress-display.js';
import { ShutdownHandler } from './cli/shutdown-handler.js';
import { ConfigLoader } from './services/config-loader.js';
import { LogService } from './services/log-service.js';

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
        dryRun: options.dryRun,
        dialog: options.dialog,
        from: options.from,
        to: options.to,
      });

      // Set up progress display
      progressDisplay.setStartTime(Date.now());

      // TODO: Task 11 - Implement service integration and main flow

      if (options.dryRun) {
        logService.info('Dry run mode - no actual changes will be made');
      }

      logService.info('Migration configuration validated successfully');
      console.log('Configuration loaded. Ready for migration.');
      console.log('Note: Full migration flow will be implemented in Task 11.');
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
      // TODO: Implement status display using ProgressService
      console.log('Note: Full status display will be implemented in Task 11.');
    });
  }

  // Override export command action
  const exportCmd = program.commands.find((cmd) => cmd.name() === 'export');
  if (exportCmd) {
    exportCmd.action(async (output, _options, command) => {
      const globalOpts = command.optsWithGlobals();
      const progressPath = globalOpts.progress || './migration-progress.json';

      console.log(`Exporting progress from ${progressPath} to ${output}`);
      // TODO: Implement export using ProgressService
      console.log('Note: Full export will be implemented in Task 11.');
    });
  }

  // Override import command action
  const importCmd = program.commands.find((cmd) => cmd.name() === 'import');
  if (importCmd) {
    importCmd.action(async (file, _options, command) => {
      const globalOpts = command.optsWithGlobals();
      const progressPath = globalOpts.progress || './migration-progress.json';

      console.log(`Importing progress from ${file} to ${progressPath}`);
      // TODO: Implement import using ProgressService
      console.log('Note: Full import will be implemented in Task 11.');
    });
  }

  // Parse and execute command
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
