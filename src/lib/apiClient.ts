import { getActivePerTabSessionToken } from '../utils/sessionStorageAuth';

let volatileSessionToken = '';

export function setInMemorySessionToken(token: string): void {
  volatileSessionToken = (token || '').trim();
}

export function getActiveBearerToken(): string {
  if (volatileSessionToken) return volatileSessionToken;
  return getActivePerTabSessionToken();
}

export function clearInMemorySessionToken(): void {
  volatileSessionToken = '';
}

export function buildAuthorizedHeaders(
  extra: Record<string, string> = {},
  explicitToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = (explicitToken ?? getActiveBearerToken()).trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}
