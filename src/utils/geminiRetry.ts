export const PRIMARY_PDF_MODEL = 'gemini-4-hydrogen';
export const FALLBACK_PDF_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_RETRY_DELAYS_MS = [2000, 4000, 8000] as const;

export interface RetryOptions {
  maxRetries?: number;
  delaysMs?: readonly number[];
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (info: {
    attempt: number;
    maxRetries: number;
    delayMs: number;
    error: unknown;
  }) => void;
  sleepFn?: (ms: number) => Promise<void>;
  deadlineAtMs?: number;
}

export interface FallbackRunnerOptions<T> {
  primaryModel?: string;
  fallbackModel?: string;
  primaryRetryOptions?: RetryOptions;
  fallbackRetryOptions?: RetryOptions;
  runAttempt: (model: string, attemptIndex: number) => Promise<T>;
  onFallback?: (info: {
    fromModel: string;
    toModel: string;
    error: unknown;
  }) => void;
}

export interface FallbackRunnerResult<T> {
  result: T;
  modelUsed: string;
  fallbackUsed: boolean;
  primaryAttempts: number;
  totalAttempts: number;
}

export class TimeoutError extends Error {
  readonly code = 'ETIMEDOUT';
  readonly status = 504;

  constructor(message = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  for (const key of ['status', 'statusCode', 'code']) {
    const val = record[key];
    if (typeof val === 'number' && val >= 100 && val <= 599) {
      return val;
    }
    if (typeof val === 'string' && /^\d{3}$/.test(val.trim())) {
      return Number(val.trim());
    }
  }
  const nested = record.error;
  if (nested && typeof nested === 'object') {
    return extractErrorStatus(nested);
  }
  return undefined;
}

export function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.name;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message;
    }
    if (record.error && typeof record.error === 'object') {
      const nestedMsg = extractErrorMessage(record.error);
      if (nestedMsg) return nestedMsg;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  }
  return String(error || 'Unknown error');
}

export function isNonRetryableAuthOrConfigError(error: unknown): boolean {
  const status = extractErrorStatus(error);
  const msg = extractErrorMessage(error);
  if (
    /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|UNAUTHENTICATED|invalid api key/i.test(
      msg,
    )
  ) {
    return true;
  }
  if (status === 401 || status === 403) {
    return true;
  }
  return false;
}

export function isRetryableGeminiError(error: unknown): boolean {
  if (isNonRetryableAuthOrConfigError(error)) {
    return false;
  }

  const status = extractErrorStatus(error);
  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 408
  ) {
    return true;
  }

  const msg = extractErrorMessage(error);
  const name = error instanceof Error ? error.name : '';

  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /\b(503|429|502|504|408)\b/.test(msg) ||
    /UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|INTERNAL|high demand|overloaded|try again later|rate limit|quota|temporarily unavailable|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network|socket hang up|timed out|timeout|empty response/i.test(
      msg,
    )
  ) {
    return true;
  }

  return false;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Request timed out while processing PDF.',
): Promise<T> {
  if (timeoutMs <= 0) {
    throw new TimeoutError(timeoutMessage);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new TimeoutError(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export function getRetryDelayMs(
  retryIndex: number,
  delaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): number {
  if (delaysMs.length === 0) return 0;
  if (retryIndex < delaysMs.length) return delaysMs[retryIndex];
  const last = delaysMs[delaysMs.length - 1];
  const extraSteps = retryIndex - delaysMs.length + 1;
  return last * 2 ** extraSteps;
}

export async function withRetry<T>(
  fn: (attemptIndex: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<{ value: T; attempts: number }> {
  const maxRetries = Math.max(0, options.maxRetries ?? 3);
  const delaysMs = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const shouldRetry = options.shouldRetry ?? isRetryableGeminiError;
  const sleepFn = options.sleepFn ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }

      const scheduledDelay = getRetryDelayMs(attempt, delaysMs);
      if (options.deadlineAtMs !== undefined) {
        const remainingMs = options.deadlineAtMs - Date.now();
        if (remainingMs <= scheduledDelay + 1500) {
          throw error;
        }
      }

      options.onRetry?.({
        attempt: attempt + 1,
        maxRetries,
        delayMs: scheduledDelay,
        error,
      });

      if (scheduledDelay > 0) {
        await sleepFn(scheduledDelay);
      }
    }
  }

  throw lastError;
}

export async function executeWithRetryAndFallback<T>({
  primaryModel = PRIMARY_PDF_MODEL,
  fallbackModel = FALLBACK_PDF_MODEL,
  primaryRetryOptions = {},
  fallbackRetryOptions = {},
  runAttempt,
  onFallback,
}: FallbackRunnerOptions<T>): Promise<FallbackRunnerResult<T>> {
  let primaryAttempts = 0;

  try {
    const primaryRes = await withRetry(
      (attemptIndex) => {
        primaryAttempts = attemptIndex + 1;
        return runAttempt(primaryModel, attemptIndex);
      },
      {
        maxRetries: 3,
        delaysMs: DEFAULT_RETRY_DELAYS_MS,
        ...primaryRetryOptions,
      },
    );

    return {
      result: primaryRes.value,
      modelUsed: primaryModel,
      fallbackUsed: false,
      primaryAttempts: primaryRes.attempts,
      totalAttempts: primaryRes.attempts,
    };
  } catch (primaryError) {
    if (isNonRetryableAuthOrConfigError(primaryError) || !fallbackModel || fallbackModel === primaryModel) {
      throw primaryError;
    }

    const canFallback =
      isRetryableGeminiError(primaryError) ||
      extractErrorStatus(primaryError) === 404 ||
      /NOT_FOUND|model.*not found|unsupported/i.test(extractErrorMessage(primaryError));

    if (!canFallback) {
      throw primaryError;
    }

    onFallback?.({
      fromModel: primaryModel,
      toModel: fallbackModel,
      error: primaryError,
    });

    const fallbackRes = await withRetry(
      (attemptIndex) => runAttempt(fallbackModel, attemptIndex),
      {
        maxRetries: 1,
        delaysMs: [1500],
        ...fallbackRetryOptions,
      },
    );

    return {
      result: fallbackRes.value,
      modelUsed: fallbackModel,
      fallbackUsed: true,
      primaryAttempts,
      totalAttempts: primaryAttempts + fallbackRes.attempts,
    };
  }
}

export function extractJsonObjectFromText<T extends object>(
  rawText: string,
): T | null {
  const cleaned = (rawText || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) return null;

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    // Fall back to substring brace extraction below
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function sanitizeExtractErrorMessage(
  rawInput: unknown,
  httpStatus?: number,
): string {
  const extractedText = extractErrorMessage(rawInput).trim();
  const inferredStatus = httpStatus ?? extractErrorStatus(rawInput);

  if (
    inferredStatus === 503 ||
    inferredStatus === 502 ||
    /503|UNAVAILABLE|high demand|overloaded/i.test(extractedText)
  ) {
    return "Server busy hai, kripya 5 second baad 'Retry This File' par click karein.";
  }

  if (
    inferredStatus === 429 ||
    /429|RESOURCE_EXHAUSTED|rate limit|quota/i.test(extractedText)
  ) {
    return "AI scanning limit temporary full ho gayi hai. Kripya thodi der baad 'Retry This File' karein.";
  }

  if (
    inferredStatus === 504 ||
    inferredStatus === 408 ||
    /AbortError|TimeoutError|timed out|timeout|DEADLINE_EXCEEDED/i.test(extractedText)
  ) {
    return "Scan timeout ho gaya (45s limit). Network ya PDF bada hone ki wajah se time laga — 'Retry This File' par click karein.";
  }

  if (inferredStatus === 413 || /payload too large|entity too large|413/i.test(extractedText)) {
    return 'PDF file serverless size limit (~4.5 MB) se badi hai. Kripya smaller ya compressed PDF upload karein.';
  }

  if (
    inferredStatus === 401 ||
    inferredStatus === 403 ||
    /API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED/i.test(extractedText)
  ) {
    return 'Server AI configuration issue (GEMINI_API_KEY). Admin Settings / Secrets check karein.';
  }

  if (/fetch failed|Failed to fetch|NetworkError|ECONNRESET|ECONNREFUSED/i.test(extractedText)) {
    return "Network connection error. Internet check karke 'Retry This File' par click karein.";
  }

  const looksLikeRawJsonOrHtml =
    extractedText.startsWith('{') ||
    extractedText.startsWith('[') ||
    extractedText.startsWith('<') ||
    extractedText.includes('<!DOCTYPE') ||
    /"error"\s*:/.test(extractedText) ||
    extractedText.length > 220;

  if (looksLikeRawJsonOrHtml || !extractedText) {
    return "PDF scan complete nahi ho paaya (temporary server error). Kripya 'Retry This File' par click karein.";
  }

  return extractedText;
}
