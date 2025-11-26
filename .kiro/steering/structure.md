# Project Structure

## Organization Philosophy

**分層架構 (Layered Architecture)**：CLI 層處理使用者互動，服務層封裝業務邏輯，類型層定義資料結構與介面。

## Directory Patterns

### CLI Layer (`/src/cli/`)
**Purpose**: 使用者介面與命令處理
**Pattern**: 一個檔案對應一個關注點 (program, progress-display, shutdown-handler)
**Barrel Export**: `index.ts` 統一匯出 CLI 元件
**Example**: `program.ts` 定義 CLI 命令，`shutdown-handler.ts` 處理優雅關閉

### Services Layer (`/src/services/`)
**Purpose**: 核心業務邏輯，每個服務專注單一職責
**Pattern**: `{domain}-service.ts` 命名，實作對應 `I{Domain}Service` 介面

**Domain Services** (業務邏輯):
- `auth-service.ts` - Telegram 驗證
- `dialog-service.ts` - 對話列舉與過濾
- `migration-service.ts` - 訊息遷移邏輯
- `orchestrator.ts` - 流程協調

**Infrastructure Services** (跨領域支援):
- Pattern: 提供共用基礎設施功能，可被多個 Domain Service 依賴
- Example: `session-manager.ts` (Session 持久化), `rate-limiter.ts` (流量控制), `config-loader.ts` (設定載入), `log-service.ts` (日誌記錄)

### Types Layer (`/src/types/`)
**Purpose**: TypeScript 類型定義與介面
**Pattern**: 按類別分檔 (interfaces, models, enums, errors, result)
**Barrel Export**: `index.ts` 統一匯出所有型別，方便其他模組引用
**Structure**:
- `interfaces.ts` - 服務介面定義 (`I*Service`)
- `models.ts` - 資料模型 (`*Config`, `*Info`, `*Progress`)
- `enums.ts` - 列舉類型 (`DialogStatus`, `MigrationPhase`, `MergeStrategy`)
- `errors.ts` - 錯誤類型定義
- `result.ts` - Result 類型與工具函式

### Entry Point (`/src/index.ts`)
**Purpose**: CLI 入口，連接 commander 程式與服務層
**Pattern**: 組裝服務、設定命令動作、啟動執行

## Naming Conventions

- **Files**: kebab-case (`auth-service.ts`, `progress-display.ts`)
- **Classes**: PascalCase (`AuthService`, `MigrationOrchestrator`)
- **Interfaces**: I-prefix PascalCase (`IAuthService`, `IDialogService`)
- **Types**: PascalCase (`DialogInfo`, `MigrationConfig`)
- **Functions**: camelCase (`createProgram`, `validateStartupConfig`)
- **Constants**: UPPER_SNAKE_CASE (少用，多數設定透過類型)

## Import Organization

```typescript
// 1. Node.js built-ins
import * as fs from 'fs/promises';

// 2. External packages
import { TelegramClient } from 'telegram';
import { Command } from 'commander';

// 3. Internal types
import type { Result } from '../types/result.js';
import type { DialogInfo, MigrationConfig } from '../types/models.js';

// 4. Internal services
import { DialogService } from './dialog-service.js';
```

**Rules**:
- 使用相對路徑 (`./`, `../`)
- `.js` 副檔名必須（ESM 要求）
- `type` imports 與 value imports 分開

## Code Organization Principles

### 單向依賴
```
index.ts → cli/* → services/* → types/*
              ↓         ↓
           services/*  types/*
```

### 介面隔離
- 服務間透過介面溝通
- 具體實作僅在組裝點（index.ts, orchestrator.ts）引用

### 錯誤處理
- 每個模組定義自己的錯誤類型於 `types/errors.ts`
- 使用 `Result` 類型而非例外
- 呼叫端必須檢查 `result.success` 後才能存取 `result.data`

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_
