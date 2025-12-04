/**
 * Task 10.1: CLI Command Parsing
 *
 * Implements the main CLI program using commander.js
 *
 * Requirements: 8.1, 8.2, 8.4
 * - Use commander to define CLI commands: migrate, status, export, import
 * - Support config path, progress path, verbose output options
 * - Support --dry-run preview mode and --dialog for specific dialog migration
 * - Validate required settings before startup
 */

import { Command } from 'commander';
import type { Result } from '../types/result.js';
import { success, failure } from '../types/result.js';
import type { ConfigError } from '../types/errors.js';

/**
 * Global CLI options
 */
export interface GlobalOptions {
  config: string;
  progress: string;
  verbose: boolean;
  quiet: boolean;
}

/**
 * Migrate command options
 */
export interface MigrateOptions {
  dryRun: boolean;
  dialog?: string;
  from?: string;
  to?: string;
}

/**
 * Startup configuration validation input
 */
export interface StartupConfig {
  apiId?: number;
  apiHash?: string;
  phoneNumberA?: string;
  targetUserB?: string;
}

/**
 * Creates the CLI program with all commands and options
 *
 * @returns Configured Commander program instance
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('tg-migrate')
    .description('Telegram message migration tool from account A to B')
    .version('1.0.0')
    .option(
      '-c, --config <path>',
      'Configuration file path',
      './config.json'
    )
    .option(
      '-p, --progress <path>',
      'Progress file path',
      './migration-progress.json'
    )
    .option('-v, --verbose', 'Enable verbose output (DEBUG level)', false)
    .option('-q, --quiet', 'Quiet mode (ERROR only)', false);

  // Migrate command (default)
  program
    .command('migrate', { isDefault: true })
    .description('Execute message migration (default command)')
    .option('--dry-run', 'Preview mode without actual migration', false)
    .option('--dialog <id>', 'Migrate specific dialog only')
    .option('--from <date>', 'Start date filter (ISO 8601 format)')
    .option('--to <date>', 'End date filter (ISO 8601 format)')
    .action(async (options, command) => {
      // Action will be implemented by main entry point
      const globalOpts = command.optsWithGlobals();
      console.log('Migrate command', { ...options, global: globalOpts });
    });

  // Status command
  program
    .command('status')
    .description('Display migration status')
    .action(async (_options, command) => {
      const globalOpts = command.optsWithGlobals();
      console.log('Status command', { global: globalOpts });
    });

  // Export command
  program
    .command('export')
    .description('Export progress to a file')
    .argument('<output>', 'Output file path')
    .action(async (output, _options, command) => {
      const globalOpts = command.optsWithGlobals();
      console.log('Export command', { output, global: globalOpts });
    });

  // Import command
  program
    .command('import')
    .description('Import progress from a file')
    .argument('<file>', 'Progress file to import')
    .action(async (file, _options, command) => {
      const globalOpts = command.optsWithGlobals();
      console.log('Import command', { file, global: globalOpts });
    });

  // Clean command (Task 13.2)
  program
    .command('clean')
    .description('Securely delete all local session and progress data')
    .option('--force', 'Skip confirmation prompt', false)
    .action(async (options, command) => {
      const globalOpts = command.optsWithGlobals();
      console.log('Clean command', { ...options, global: globalOpts });
    });

  // List command - 列出所有對話
  program
    .command('list')
    .description('List all dialogs with their IDs')
    .option('--type <type>', 'Filter by dialog type (private, group, supergroup, channel, bot)')
    .action(async (options, command) => {
      const globalOpts = command.optsWithGlobals();
      console.log('List command', { ...options, global: globalOpts });
    });

  return program;
}

/**
 * Parse global options from command line arguments
 *
 * @param args - Command line arguments
 * @returns Parsed global options
 */
export function parseOptions(args: string[]): GlobalOptions {
  const program = createProgram();

  // Parse without executing actions
  program.parse(['node', 'tg-migrate', ...args], { from: 'user' });

  const opts = program.opts();

  return {
    config: opts.config || './config.json',
    progress: opts.progress || './migration-progress.json',
    verbose: opts.verbose || false,
    quiet: opts.quiet || false,
  };
}

/**
 * Parse migrate command options from command line arguments
 *
 * @param args - Command line arguments
 * @returns Parsed migrate options
 */
export function parseMigrateOptions(args: string[]): MigrateOptions {
  const program = createProgram();

  // Find migrate command and parse its options
  let migrateOpts: MigrateOptions = {
    dryRun: false,
    dialog: undefined,
    from: undefined,
    to: undefined,
  };

  const migrateCmd = program.commands.find((cmd) => cmd.name() === 'migrate');
  if (migrateCmd) {
    // Override action to capture options
    migrateCmd.action((options) => {
      migrateOpts = {
        dryRun: options.dryRun || false,
        dialog: options.dialog,
        from: options.from,
        to: options.to,
      };
    });

    // Parse with migrate command
    program.parse(['node', 'tg-migrate', 'migrate', ...args], { from: 'user' });
  }

  return migrateOpts;
}

/**
 * Validate startup configuration
 *
 * Checks that all required settings exist before starting migration
 *
 * @param config - Configuration to validate
 * @returns Success or error
 */
export function validateStartupConfig(
  config: StartupConfig
): Result<void, ConfigError> {
  const requiredFields: Array<keyof StartupConfig> = [
    'apiId',
    'apiHash',
    'phoneNumberA',
    'targetUserB',
  ];

  for (const field of requiredFields) {
    const value = config[field];
    if (value === undefined || value === null || value === '') {
      return failure({
        type: 'MISSING_REQUIRED',
        field,
      });
    }
  }

  // Validate apiId is a positive number
  if (typeof config.apiId !== 'number' || config.apiId <= 0) {
    return failure({
      type: 'INVALID_VALUE',
      field: 'apiId',
      message: 'API ID must be a positive number',
    });
  }

  // Validate apiHash format (32 hex characters)
  if (
    typeof config.apiHash !== 'string' ||
    !/^[a-f0-9]{32}$/i.test(config.apiHash)
  ) {
    return failure({
      type: 'INVALID_VALUE',
      field: 'apiHash',
      message: 'API Hash must be a 32-character hexadecimal string',
    });
  }

  return success(undefined);
}
