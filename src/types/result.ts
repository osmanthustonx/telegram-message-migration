/**
 * Result Type - 統一錯誤處理的函數式型別
 *
 * 使用 discriminated union 實現 Railway-oriented programming 模式，
 * 讓錯誤處理更加明確且型別安全。
 */

/**
 * Result 型別 - 代表操作可能成功或失敗的結果
 *
 * @typeParam T - 成功時的資料型別
 * @typeParam E - 失敗時的錯誤型別，預設為 Error
 */
export type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

/**
 * 建立成功的 Result
 *
 * @param data - 成功時的資料
 * @returns 包含成功資料的 Result
 *
 * @example
 * ```typescript
 * const result = success({ userId: 123 });
 * if (result.success) {
 *   console.log(result.data.userId); // 123
 * }
 * ```
 */
export function success<T>(data: T): Result<T, never> {
  return { success: true, data };
}

/**
 * 建立失敗的 Result
 *
 * @param error - 錯誤資訊
 * @returns 包含錯誤的 Result
 *
 * @example
 * ```typescript
 * const result = failure(new Error('Something went wrong'));
 * if (!result.success) {
 *   console.error(result.error.message);
 * }
 * ```
 */
export function failure<T, E = Error>(error: E): Result<T, E> {
  return { success: false, error };
}

/**
 * 檢查 Result 是否為成功
 *
 * @param result - 要檢查的 Result
 * @returns 如果是成功則回傳 true
 */
export function isSuccess<T, E>(
  result: Result<T, E>
): result is { readonly success: true; readonly data: T } {
  return result.success;
}

/**
 * 檢查 Result 是否為失敗
 *
 * @param result - 要檢查的 Result
 * @returns 如果是失敗則回傳 true
 */
export function isFailure<T, E>(
  result: Result<T, E>
): result is { readonly success: false; readonly error: E } {
  return !result.success;
}
