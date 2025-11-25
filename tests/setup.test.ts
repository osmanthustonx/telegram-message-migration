import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

describe('Project Setup', () => {
  const projectRoot = resolve(import.meta.dirname, '..');

  describe('Directory Structure', () => {
    it('should have src directory', () => {
      expect(existsSync(resolve(projectRoot, 'src'))).toBe(true);
    });

    it('should have src/services directory', () => {
      expect(existsSync(resolve(projectRoot, 'src/services'))).toBe(true);
    });

    it('should have src/types directory', () => {
      expect(existsSync(resolve(projectRoot, 'src/types'))).toBe(true);
    });

    it('should have src/utils directory', () => {
      expect(existsSync(resolve(projectRoot, 'src/utils'))).toBe(true);
    });

    it('should have tests directory', () => {
      expect(existsSync(resolve(projectRoot, 'tests'))).toBe(true);
    });
  });

  describe('Configuration Files', () => {
    it('should have package.json', () => {
      expect(existsSync(resolve(projectRoot, 'package.json'))).toBe(true);
    });

    it('should have tsconfig.json', () => {
      expect(existsSync(resolve(projectRoot, 'tsconfig.json'))).toBe(true);
    });

    it('should have eslint.config.js', () => {
      expect(existsSync(resolve(projectRoot, 'eslint.config.js'))).toBe(true);
    });

    it('should have .prettierrc', () => {
      expect(existsSync(resolve(projectRoot, '.prettierrc'))).toBe(true);
    });
  });

  describe('Entry Point', () => {
    it('should have src/index.ts', () => {
      expect(existsSync(resolve(projectRoot, 'src/index.ts'))).toBe(true);
    });
  });
});
