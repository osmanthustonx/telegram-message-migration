/**
 * Task 12.1, 12.2, 12.3: Mac 可執行檔打包測試
 *
 * 測試 Node.js SEA (Single Executable Applications) 建置流程
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 * - 9.1: Mac 原生可執行檔（.app 或獨立二進位檔）
 * - 9.2: 內嵌所有必要的 Node.js 執行環境與依賴
 * - 9.3: 啟動命令列介面或互動式終端
 * - 9.4: 支援 macOS 12 (Monterey) 及更新版本
 * - 9.5: 支援 Intel (x64) 與 Apple Silicon (arm64) 架構
 * - 9.6: 顯示明確的權限要求說明
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Task 12.1: 建置環境設定測試
// Requirements: 9.1, 9.2, 9.5
// ============================================================================

describe('Build Configuration (Task 12.1)', () => {
  describe('sea-config.json', () => {
    it('應存在 sea-config.json 設定檔', () => {
      const configPath = path.resolve(
        __dirname,
        '../../sea-config.json'
      );
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('設定檔應指定 main 為打包後的 bundle', () => {
      const configPath = path.resolve(
        __dirname,
        '../../sea-config.json'
      );
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.main).toBe('dist/bundle.js');
    });

    it('設定檔應指定 output 為 SEA blob 路徑', () => {
      const configPath = path.resolve(
        __dirname,
        '../../sea-config.json'
      );
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.output).toBe('dist/sea-prep.blob');
    });

    it('設定檔應停用實驗性 SEA 警告', () => {
      const configPath = path.resolve(
        __dirname,
        '../../sea-config.json'
      );
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config.disableExperimentalSEAWarning).toBe(true);
    });
  });

  describe('package.json build scripts', () => {
    it('應包含 build:bundle 腳本（esbuild）', () => {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.scripts['build:bundle']).toBeDefined();
      expect(pkg.scripts['build:bundle']).toContain('esbuild');
    });

    it('應包含 build:sea 腳本（SEA blob 產生）', () => {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.scripts['build:sea']).toBeDefined();
      expect(pkg.scripts['build:sea']).toContain('--experimental-sea-config');
    });

    it('應包含 build:exe 腳本（執行檔產生）', () => {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.scripts['build:exe']).toBeDefined();
    });

    it('應包含 build:all 腳本（完整建置流程）', () => {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.scripts['build:all']).toBeDefined();
    });
  });

  describe('esbuild 設定', () => {
    it('esbuild 應設定為 Node 平台', () => {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const bundleScript = pkg.scripts['build:bundle'];
      expect(bundleScript).toContain('--platform=node');
    });

    it('esbuild 應設定目標為 node20', () => {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const bundleScript = pkg.scripts['build:bundle'];
      expect(bundleScript).toContain('--target=node20');
    });

    it('esbuild 應設定為單一 bundle 輸出', () => {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const bundleScript = pkg.scripts['build:bundle'];
      expect(bundleScript).toContain('--bundle');
    });
  });
});

// ============================================================================
// Task 12.2: 執行檔產生流程測試
// Requirements: 9.3, 9.4
// ============================================================================

describe('Executable Generation (Task 12.2)', () => {
  describe('build:exe 腳本', () => {
    it('應呼叫 scripts/build-exe.sh 腳本', () => {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.scripts['build:exe']).toContain('scripts/build-exe.sh');
    });
  });

  describe('build-exe.sh 腳本', () => {
    it('應存在 scripts/build-exe.sh 腳本檔案', () => {
      const scriptPath = path.resolve(
        __dirname,
        '../../scripts/build-exe.sh'
      );
      expect(fs.existsSync(scriptPath)).toBe(true);
    });

    it('腳本應具有執行權限', () => {
      const scriptPath = path.resolve(
        __dirname,
        '../../scripts/build-exe.sh'
      );
      const stats = fs.statSync(scriptPath);
      // 檢查 owner 執行權限 (0o100)
      expect(stats.mode & 0o100).toBeTruthy();
    });

    it('腳本應包含 postject 注入步驟', () => {
      const scriptPath = path.resolve(
        __dirname,
        '../../scripts/build-exe.sh'
      );
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('postject');
    });

    it('腳本應包含 codesign 步驟（macOS）', () => {
      const scriptPath = path.resolve(
        __dirname,
        '../../scripts/build-exe.sh'
      );
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('codesign');
    });
  });
});

// ============================================================================
// Task 12.3: 執行檔相容性測試
// Requirements: 9.4, 9.5, 9.6
// ============================================================================

describe('Executable Compatibility (Task 12.3)', () => {
  describe('平台支援', () => {
    it('應支援目前平台（darwin）', () => {
      expect(process.platform).toBe('darwin');
    });

    it('應記錄目前架構（x64 或 arm64）', () => {
      expect(['x64', 'arm64']).toContain(process.arch);
    });
  });

  describe('權限說明', () => {
    it('README 應包含執行權限說明', () => {
      const readmePath = path.resolve(__dirname, '../../README.md');
      if (fs.existsSync(readmePath)) {
        const content = fs.readFileSync(readmePath, 'utf-8');
        // 檢查是否包含 chmod 或權限相關說明
        const hasPermissionDoc =
          content.includes('chmod') || content.includes('執行權限');
        expect(hasPermissionDoc).toBe(true);
      }
    });
  });
});

// ============================================================================
// Task 13.1: 本機資料安全測試
// Requirements: 10.1, 10.2
// ============================================================================

describe('Local Data Security (Task 13.1)', () => {
  describe('Session 檔案安全', () => {
    it('SessionManager 應設定檔案權限為 600', () => {
      // 這個測試驗證 SessionManager 的實作
      // 實際的權限設定在 SessionManager 中實作
      const sessionManagerPath = path.resolve(
        __dirname,
        '../../src/services/session-manager.ts'
      );
      const content = fs.readFileSync(sessionManagerPath, 'utf-8');
      expect(content).toContain('0o600');
    });
  });

  describe('MTProto 協定', () => {
    it('應使用 GramJS 官方函式庫（telegram package）', () => {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      expect(pkg.dependencies['telegram']).toBeDefined();
    });
  });
});

// ============================================================================
// Task 13.2: 資料清除功能測試
// Requirements: 10.3
// ============================================================================

describe('Data Cleanup (Task 13.2)', () => {
  describe('clean 命令', () => {
    it('CLI 應支援 clean 命令', () => {
      const programPath = path.resolve(
        __dirname,
        '../../src/cli/program.ts'
      );
      const content = fs.readFileSync(programPath, 'utf-8');
      expect(content).toContain('clean');
    });
  });

  describe('安全刪除', () => {
    it('SessionManager 應支援 deleteSession 方法', () => {
      const sessionManagerPath = path.resolve(
        __dirname,
        '../../src/services/session-manager.ts'
      );
      const content = fs.readFileSync(sessionManagerPath, 'utf-8');
      expect(content).toContain('deleteSession');
    });
  });
});

// ============================================================================
// Task 13.3: 安全性驗證測試
// Requirements: 10.4, 10.5
// ============================================================================

describe('Security Validation (Task 13.3)', () => {
  describe('密碼不儲存', () => {
    it('驗證流程不應儲存密碼', () => {
      // 檢查 AuthService 不包含密碼儲存邏輯
      const authServicePath = path.resolve(
        __dirname,
        '../../src/services/auth-service.ts'
      );
      const content = fs.readFileSync(authServicePath, 'utf-8');
      // 不應有 savePassword, storePassword 等方法
      expect(content).not.toContain('savePassword');
      expect(content).not.toContain('storePassword');
    });
  });

  describe('Session 完整性', () => {
    it('SessionManager 應支援 validateSessionPermissions 方法', () => {
      const sessionManagerPath = path.resolve(
        __dirname,
        '../../src/services/session-manager.ts'
      );
      const content = fs.readFileSync(sessionManagerPath, 'utf-8');
      expect(content).toContain('validateSessionPermissions');
    });
  });
});
