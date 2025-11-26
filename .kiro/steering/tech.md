# Technology Stack

## Architecture

服務導向架構 (Service-Oriented)：核心功能拆分為獨立服務模組，透過介面定義依賴，由協調器 (Orchestrator) 整合執行流程。

```
CLI Layer (commander) → Orchestrator → Services (Auth, Dialog, Group, Migration, Progress, Report)
```

## Core Technologies

- **Language**: TypeScript 5.7+ (strict mode)
- **Runtime**: Node.js 18+
- **Module System**: ESM (ES Modules)

## Key Libraries

| Library | Purpose |
|---------|---------|
| `telegram` (GramJS) | Telegram MTProto API 客戶端 |
| `commander` | CLI 命令解析與選項處理 |
| `winston` | 結構化日誌記錄 |
| `dotenv` | 環境變數載入 |

## Development Standards

### Type Safety

- **嚴格模式**：`strict: true` 啟用所有嚴格檢查
- **禁止 any**：`noImplicitAny: true`
- **Null 安全**：`strictNullChecks: true`
- **未使用檢查**：`noUnusedLocals`, `noUnusedParameters`

### Code Quality

```bash
# Lint
npm run lint          # ESLint 檢查
npm run lint:fix      # 自動修正

# Format
npm run format        # Prettier 格式化
npm run format:check  # 檢查格式
```

### Testing

- **Framework**: Vitest
- **Pattern**: 測試檔案使用 `.test.ts` 或 `.spec.ts` 後綴
- **Location**: 排除於編譯目標 (`tsconfig.json` excludes)

## Development Environment

### Required Tools

- Node.js >= 18.0.0
- npm (包含於 Node.js)

### Common Commands

```bash
npm run dev      # 開發模式執行 (tsx)
npm run build    # 編譯 TypeScript
npm run start    # 執行編譯後版本
npm run test     # 執行測試
npm run typecheck # 類型檢查
```

## Key Technical Decisions

### Result Type Pattern

所有可能失敗的操作回傳 `Result<T, E>` 而非拋出例外，強制呼叫端處理錯誤：

```typescript
type Result<T, E> = { success: true; data: T } | { success: false; error: E };
```

### 依賴注入

服務透過建構子注入依賴，便於測試時替換為 mock：

```typescript
constructor(config: Config, services?: OrchestratorServices) {
  this.dialogService = services?.dialogService ?? new DialogService();
}
```

### 介面優先

所有服務實作對應的 `I*Service` 介面，定義於 `types/interfaces.ts`。

---
_Document standards and patterns, not every dependency_
