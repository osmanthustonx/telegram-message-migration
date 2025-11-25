/**
 * Task 10.1: CLI Command Parsing Tests
 *
 * TDD Tests - Verify CLI implementation matches design.md specifications
 *
 * Requirements: 8.1, 8.2, 8.4
 * - Use commander to define CLI commands: migrate, status, export, import
 * - Support config path, progress path, verbose output options
 * - Support --dry-run preview mode and --dialog for specific dialog migration
 * - Validate required settings before startup
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('CLI Command Parsing', () => {
  // Mock process.argv before tests
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.resetModules();
    process.argv = ['node', 'tg-migrate'];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  describe('Command Definition', () => {
    it('should define migrate command as default', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      expect(program.commands.some((cmd) => cmd.name() === 'migrate')).toBe(true);
    });

    it('should define status command', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      expect(program.commands.some((cmd) => cmd.name() === 'status')).toBe(true);
    });

    it('should define export command', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      expect(program.commands.some((cmd) => cmd.name() === 'export')).toBe(true);
    });

    it('should define import command', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      expect(program.commands.some((cmd) => cmd.name() === 'import')).toBe(true);
    });
  });

  describe('Global Options', () => {
    it('should support --config option with default value', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      const configOption = program.options.find((opt) => opt.long === '--config');
      expect(configOption).toBeDefined();
      expect(configOption?.defaultValue).toBe('./config.json');
    });

    it('should support --progress option with default value', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      const progressOption = program.options.find((opt) => opt.long === '--progress');
      expect(progressOption).toBeDefined();
      expect(progressOption?.defaultValue).toBe('./migration-progress.json');
    });

    it('should support --verbose option for DEBUG level', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      const verboseOption = program.options.find((opt) => opt.long === '--verbose');
      expect(verboseOption).toBeDefined();
    });

    it('should support --quiet option for ERROR only', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      const quietOption = program.options.find((opt) => opt.long === '--quiet');
      expect(quietOption).toBeDefined();
    });
  });

  describe('Migrate Command Options', () => {
    it('should support --dry-run option for preview mode', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      const migrateCmd = program.commands.find((cmd) => cmd.name() === 'migrate');
      expect(migrateCmd).toBeDefined();

      const dryRunOption = migrateCmd?.options.find((opt) => opt.long === '--dry-run');
      expect(dryRunOption).toBeDefined();
    });

    it('should support --dialog option for specific dialog migration', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      const migrateCmd = program.commands.find((cmd) => cmd.name() === 'migrate');
      expect(migrateCmd).toBeDefined();

      const dialogOption = migrateCmd?.options.find((opt) => opt.long === '--dialog');
      expect(dialogOption).toBeDefined();
    });

    it('should support --from option for start date (ISO 8601)', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      const migrateCmd = program.commands.find((cmd) => cmd.name() === 'migrate');
      expect(migrateCmd).toBeDefined();

      const fromOption = migrateCmd?.options.find((opt) => opt.long === '--from');
      expect(fromOption).toBeDefined();
    });

    it('should support --to option for end date (ISO 8601)', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      const migrateCmd = program.commands.find((cmd) => cmd.name() === 'migrate');
      expect(migrateCmd).toBeDefined();

      const toOption = migrateCmd?.options.find((opt) => opt.long === '--to');
      expect(toOption).toBeDefined();
    });
  });

  describe('Import Command Options', () => {
    it('should accept file path argument', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      const importCmd = program.commands.find((cmd) => cmd.name() === 'import');
      expect(importCmd).toBeDefined();
      // Check that import command has an argument for file path
      const args = importCmd?.registeredArguments;
      expect(args).toBeDefined();
      expect(args?.length).toBeGreaterThan(0);
    });
  });

  describe('Export Command Options', () => {
    it('should accept output file path argument', async () => {
      const { createProgram } = await import('../../src/cli/program.js');
      const program = createProgram();

      const exportCmd = program.commands.find((cmd) => cmd.name() === 'export');
      expect(exportCmd).toBeDefined();
      // Check that export command has an argument for output path
      const args = exportCmd?.registeredArguments;
      expect(args).toBeDefined();
      expect(args?.length).toBeGreaterThan(0);
    });
  });

  describe('Option Parsing', () => {
    it('should parse config path from command line', async () => {
      const { parseOptions } = await import('../../src/cli/program.js');

      const options = parseOptions(['--config', '/custom/config.json']);
      expect(options.config).toBe('/custom/config.json');
    });

    it('should parse progress path from command line', async () => {
      const { parseOptions } = await import('../../src/cli/program.js');

      const options = parseOptions(['--progress', '/custom/progress.json']);
      expect(options.progress).toBe('/custom/progress.json');
    });

    it('should set verbose flag correctly', async () => {
      const { parseOptions } = await import('../../src/cli/program.js');

      const options = parseOptions(['--verbose']);
      expect(options.verbose).toBe(true);
    });

    it('should set quiet flag correctly', async () => {
      const { parseOptions } = await import('../../src/cli/program.js');

      const options = parseOptions(['--quiet']);
      expect(options.quiet).toBe(true);
    });
  });

  describe('Migrate Command Parsing', () => {
    it('should parse dry-run flag', async () => {
      const { parseMigrateOptions } = await import('../../src/cli/program.js');

      const options = parseMigrateOptions(['--dry-run']);
      expect(options.dryRun).toBe(true);
    });

    it('should parse specific dialog ID', async () => {
      const { parseMigrateOptions } = await import('../../src/cli/program.js');

      const options = parseMigrateOptions(['--dialog', '12345']);
      expect(options.dialog).toBe('12345');
    });

    it('should parse date range', async () => {
      const { parseMigrateOptions } = await import('../../src/cli/program.js');

      const options = parseMigrateOptions([
        '--from',
        '2024-01-01',
        '--to',
        '2024-12-31',
      ]);
      expect(options.from).toBe('2024-01-01');
      expect(options.to).toBe('2024-12-31');
    });
  });
});

describe('CLI Configuration Validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('should validate required settings exist before startup', async () => {
    const { validateStartupConfig } = await import('../../src/cli/program.js');

    // Missing required fields
    const result = validateStartupConfig({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });

  it('should pass validation when all required settings exist', async () => {
    const { validateStartupConfig } = await import('../../src/cli/program.js');

    const result = validateStartupConfig({
      apiId: 12345,
      apiHash: 'abcdef1234567890abcdef1234567890',
      phoneNumberA: '+886912345678',
      targetUserB: '@user_b',
    });

    expect(result.success).toBe(true);
  });
});
