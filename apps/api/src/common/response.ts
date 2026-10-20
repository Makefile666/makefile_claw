/**
 * 统一 API 响应结构
 * 成功：{ code: 0, data: {}, msg: "success" }
 * 失败：{ code: 1, data: null, msg: "...", error: "ERROR_IDENTIFIER" }
 * code = 0 表示成功，其他表示失败
 * error 仅在异常响应中携带，用于透传错误标识
 */

export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  msg: string;
}

export interface ApiErrorResponse {
  code: number;
  data: unknown;
  msg: string;
  error: string;
}

/** 成功响应 */
export function success<T>(data: T, msg = 'success'): ApiResponse<T> {
  return { code: 0, data, msg };
}

/** 失败响应（携带 error 错误标识） */
export function error(
  msg: string,
  code = 1,
  error = 'INTERNAL_ERROR',
  data: unknown = null,
): ApiErrorResponse {
  return { code, data, msg, error };
}
