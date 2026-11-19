export interface SafeJsonResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T | null;
  rawText: string;
  errorMessage: string | null;
}

const HTML_OR_SERVER_ERROR_PREFIXES = [
  '<!doctype',
  '<html',
  '<head',
  '<body',
  '<title',
  'a server error',
  'internal server error',
  '502 bad gateway',
  '504 gateway',
  'service unavailable',
  'application error',
  'exception:',
];

function summarizeNonJsonBody(rawText: string, status: number): string {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return status >= 400
      ? `Server returned an empty error response (HTTP ${status}).`
      : `Server returned an empty response (HTTP ${status}).`;
  }
  const lower = trimmed.toLowerCase();
  const looksLikeHtml =
    lower.startsWith('<!doctype') ||
    lower.startsWith('<html') ||
    lower.startsWith('<head') ||
    lower.startsWith('<body') ||
    lower.startsWith('<title') ||
    lower.includes('</html>');

  if (looksLikeHtml) {
    if (lower.includes('sign in') || lower.includes('accounts.google.com') || lower.includes('servicelogin')) {
      return `Upstream endpoint returned a Google Sign-In HTML page (HTTP ${status}). Ensure deployment access is set to "Anyone".`;
    }
    return `Upstream endpoint returned an HTML page instead of JSON (HTTP ${status}). Check the API route or deployment URL.`;
  }

  if (HTML_OR_SERVER_ERROR_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return `Server returned an unexpected text error (HTTP ${status}): ${trimmed.slice(0, 140)}`;
  }

  return `Invalid JSON response from server (HTTP ${status}): ${trimmed.slice(0, 140)}`;
}

/**
 * Safely parses any Fetch Response by reading plain text first and validating JSON,
 * preventing unhandled "Unexpected token 'A', 'A server e'..." SyntaxError crashes
 * when proxies or Apps Script webhooks return plain text or HTML error pages.
 */
export async function safeReadJsonResponse<T = Record<string, unknown>>(
  res: Pick<Response, 'ok' | 'status' | 'text'>,
): Promise<SafeJsonResult<T>> {
  let rawText = '';
  try {
    rawText = await res.text();
  } catch (err) {
    return {
      ok: false,
      status: res.status || 0,
      data: null,
      rawText: '',
      errorMessage: err instanceof Error ? err.message : 'Failed to read server response body.',
    };
  }

  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      ok: res.ok,
      status: res.status,
      data: null,
      rawText,
      errorMessage: res.ok ? null : summarizeNonJsonBody(rawText, res.status),
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as T;
    const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    const apiError =
      record && typeof record.error === 'string' && record.error.trim()
        ? record.error.trim()
        : record && typeof record.message === 'string' && record.ok === false
          ? record.message.trim()
          : null;
    const isOk = Boolean(res.ok) && (record ? record.ok !== false : true);
    return {
      ok: isOk,
      status: res.status,
      data: parsed,
      rawText,
      errorMessage: isOk ? null : apiError || `Request failed with status ${res.status}.`,
    };
  } catch {
    return {
      ok: false,
      status: res.status || 502,
      data: null,
      rawText,
      errorMessage: summarizeNonJsonBody(rawText, res.status || 502),
    };
  }
}
