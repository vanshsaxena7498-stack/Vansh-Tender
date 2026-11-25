import assert from 'node:assert/strict';
import test from 'node:test';
import type { CrmUserSession } from '../types/crm';
import {
  clearPerTabCrmSession,
  CRM_SESSION_MAX_AGE_MS,
  CRM_SESSION_STORAGE_KEY,
  getRemainingCrmSessionMs,
  loadValidPerTabCrmSession,
  savePerTabCrmSession,
  updatePerTabActiveTab,
} from './sessionStorageAuth.ts';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

const OWNER_SESSION: CrmUserSession = {
  userId: 'own_aarav',
  username: 'AaravAdmin',
  email: 'aarav@acmeinfra.example',
  role: 'owner',
  companyId: 'cmp_acme',
  companyName: 'Acme Infra Pvt Ltd',
};

const MEMBER_SESSION: CrmUserSession = {
  userId: 'usr_priya',
  username: 'PriyaOps',
  email: 'priya@acmeinfra.example',
  role: 'executive',
  companyId: 'cmp_acme',
  companyName: 'Acme Infra Pvt Ltd',
};

test('savePerTabCrmSession & loadValidPerTabCrmSession survive reload within 15 minutes', () => {
  const tabStorage = createMemoryStorage();
  const t0 = 1_700_000_000_000;

  savePerTabCrmSession(
    {
      session: OWNER_SESSION,
      sessionToken: 'hmac-token-123',
      loginAtMs: t0,
      activeTab: 'dashboard',
    },
    tabStorage,
  );

  // Immediately after reload
  const loaded0 = loadValidPerTabCrmSession(t0 + 10_000, tabStorage);
  assert.equal(loaded0.status, 'valid');
  if (loaded0.status === 'valid') {
    assert.equal(loaded0.data.session.username, 'AaravAdmin');
    assert.equal(loaded0.data.sessionToken, 'hmac-token-123');
    assert.equal(loaded0.data.loginAtMs, t0);
    assert.equal(loaded0.data.activeTab, 'dashboard');
  }

  // Exact 15-minute boundary is still valid (logs out strictly when > 15 min)
  const atBoundary = loadValidPerTabCrmSession(t0 + CRM_SESSION_MAX_AGE_MS, tabStorage);
  assert.equal(atBoundary.status, 'valid');
  assert.equal(getRemainingCrmSessionMs(t0, t0 + CRM_SESSION_MAX_AGE_MS), 0);
});

test('loadValidPerTabCrmSession expires and clears storage when elapsed > 15 minutes', () => {
  const tabStorage = createMemoryStorage();
  const t0 = 1_700_000_000_000;

  savePerTabCrmSession(
    {
      session: MEMBER_SESSION,
      sessionToken: 'tok-member',
      loginAtMs: t0,
      activeTab: 'tenders',
    },
    tabStorage,
  );

  const expired = loadValidPerTabCrmSession(t0 + CRM_SESSION_MAX_AGE_MS + 1, tabStorage);
  assert.equal(expired.status, 'expired');
  if (expired.status === 'expired') {
    assert.equal(expired.expiredSession.userId, 'usr_priya');
    assert.equal(expired.loginAtMs, t0);
  }

  // Storage must be wiped on expiry
  assert.equal(tabStorage.getItem(CRM_SESSION_STORAGE_KEY), null);
  assert.equal(loadValidPerTabCrmSession(t0 + CRM_SESSION_MAX_AGE_MS + 2, tabStorage).status, 'none');
});

test('updatePerTabActiveTab persists active tab across reload without extending loginAtMs', () => {
  const tabStorage = createMemoryStorage();
  const t0 = 1_700_000_000_000;

  savePerTabCrmSession(
    {
      session: OWNER_SESSION,
      sessionToken: 'tok-1',
      loginAtMs: t0,
      activeTab: 'dashboard',
    },
    tabStorage,
  );

  updatePerTabActiveTab('bidra', tabStorage);
  const loaded = loadValidPerTabCrmSession(t0 + 60_000, tabStorage);
  assert.equal(loaded.status, 'valid');
  if (loaded.status === 'valid') {
    assert.equal(loaded.data.activeTab, 'bidra');
    assert.equal(loaded.data.loginAtMs, t0);
    assert.equal(loaded.data.sessionToken, 'tok-1');
  }

  // Corrupt tab value falls back safely to dashboard
  const rawObj = JSON.parse(tabStorage.getItem(CRM_SESSION_STORAGE_KEY)!);
  rawObj.activeTab = 'nonexistent_tab';
  tabStorage.setItem(CRM_SESSION_STORAGE_KEY, JSON.stringify(rawObj));
  const fallbackLoaded = loadValidPerTabCrmSession(t0 + 61_000, tabStorage);
  assert.equal(fallbackLoaded.status, 'valid');
  if (fallbackLoaded.status === 'valid') {
    assert.equal(fallbackLoaded.data.activeTab, 'dashboard');
  }
});

test('isolated new tab has empty sessionStorage and clearPerTabCrmSession + corrupt JSON cleanup work', () => {
  const tab1Storage = createMemoryStorage();
  const tab2Storage = createMemoryStorage(); // simulates closing tab 1 and opening tab 2
  const t0 = 1_700_000_000_000;

  savePerTabCrmSession({ session: OWNER_SESSION, loginAtMs: t0 }, tab1Storage);
  assert.equal(loadValidPerTabCrmSession(t0 + 5_000, tab2Storage).status, 'none');

  clearPerTabCrmSession(tab1Storage);
  assert.equal(loadValidPerTabCrmSession(t0 + 5_000, tab1Storage).status, 'none');

  tab1Storage.setItem(CRM_SESSION_STORAGE_KEY, '{broken_json');
  assert.equal(loadValidPerTabCrmSession(t0, tab1Storage).status, 'none');
  assert.equal(tab1Storage.getItem(CRM_SESSION_STORAGE_KEY), null);
});
