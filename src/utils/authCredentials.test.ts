import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_RECOVERY_EMAIL,
  ADMIN_USER_ID,
  buildEmptySecondaryWorkspace,
  clearInMemoryPasswordOverrideForTests,
  findUserByIdentifier,
  getStoredCredentialToken,
  listSecondaryUsers,
  loadSecondaryWorkspaceSnapshot,
  registerSecondaryUserAccount,
  saveResetPasswordCredential,
  saveSecondaryWorkspaceSnapshot,
  VALID_LOGIN_PASSWORD,
  VALID_LOGIN_USERNAME,
  validateLoginCredentials,
} from './authCredentials';

function createMockWindowStorage(initial: Array<[string, string]> = []) {
  const store = new Map<string, string>(initial);
  const mockWindow = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => {
        store.set(key, val);
      },
      clear: () => {
        throw new Error('localStorage.clear must NEVER be called');
      },
      removeItem: () => {
        throw new Error('localStorage.removeItem must NEVER be called');
      },
    },
  };
  return { store, mockWindow };
}

test('validateLoginCredentials accepts exact VanshSales / Vansh@2027 credentials (with trimmed username spaces)', () => {
  clearInMemoryPasswordOverrideForTests();
  const exact = validateLoginCredentials(VALID_LOGIN_USERNAME, VALID_LOGIN_PASSWORD);
  assert.equal(exact.ok, true);
  assert.equal(exact.user?.userId, ADMIN_USER_ID);
  assert.equal(exact.user?.username, VALID_LOGIN_USERNAME);
  assert.equal(exact.user?.email, ADMIN_RECOVERY_EMAIL);
  assert.equal(exact.user?.role, 'admin');

  const trimmed = validateLoginCredentials('  VanshSales  ', 'Vansh@2027');
  assert.equal(trimmed.ok, true);
  assert.equal(trimmed.user?.username, VALID_LOGIN_USERNAME);
  assert.equal(trimmed.user?.role, 'admin');
});

test('validateLoginCredentials rejects empty, wrong-case, or invalid credentials', () => {
  clearInMemoryPasswordOverrideForTests();
  const emptyUser = validateLoginCredentials('', 'Vansh@2027');
  assert.equal(emptyUser.ok, false);
  assert.ok(emptyUser.error);

  const emptyPass = validateLoginCredentials('VanshSales', '');
  assert.equal(emptyPass.ok, false);
  assert.ok(emptyPass.error);

  const wrongCaseUser = validateLoginCredentials('vanshsales', 'Vansh@2027');
  assert.equal(wrongCaseUser.ok, false);

  const wrongPass = validateLoginCredentials('VanshSales', 'wrong123');
  assert.equal(wrongPass.ok, false);
});

test('saveResetPasswordCredential updates login password and token without clearing existing localStorage CRM data', () => {
  const prevWindow = (globalThis as { window?: unknown }).window;
  const { store, mockWindow } = createMockWindowStorage([
    ['crm_tenders_backup', '[{"id":"tnd-1"}]'],
    ['crm_attachments_cache', '{"file":"spec.pdf"}'],
  ]);
  (globalThis as { window: unknown }).window = mockWindow;

  try {
    clearInMemoryPasswordOverrideForTests();
    saveResetPasswordCredential('VanshSales', 'FreshPass@2028', 'signed.token.123');

    assert.equal(getStoredCredentialToken(), 'signed.token.123');
    assert.equal(validateLoginCredentials('VanshSales', 'FreshPass@2028').ok, true);
    assert.equal(validateLoginCredentials('VanshSales', VALID_LOGIN_PASSWORD).ok, false);

    // Existing CRM data remains 100% untouched
    assert.equal(store.get('crm_tenders_backup'), '[{"id":"tnd-1"}]');
    assert.equal(store.get('crm_attachments_cache'), '{"file":"spec.pdf"}');

    // Simulate page reload where memory cache resets and localStorage is read back
    clearInMemoryPasswordOverrideForTests();
    assert.equal(getStoredCredentialToken(), 'signed.token.123');
    assert.equal(validateLoginCredentials('VanshSales', 'FreshPass@2028').ok, true);
  } finally {
    clearInMemoryPasswordOverrideForTests();
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = prevWindow;
    }
  }
});

test('registerSecondaryUserAccount enforces uniqueness, protects Admin identity, and supports per-user reset & isolated workspaces', () => {
  const prevWindow = (globalThis as { window?: unknown }).window;
  const { store, mockWindow } = createMockWindowStorage([
    ['crm_tenders_backup', '[{"id":"admin-tender-1"}]'],
  ]);
  (globalThis as { window: unknown }).window = mockWindow;

  try {
    clearInMemoryPasswordOverrideForTests();

    assert.throws(
      () =>
        registerSecondaryUserAccount({
          username: 'VanshSales',
          email: 'other@gmail.com',
          password: 'Password123',
        }),
      /Admin/i,
    );

    assert.throws(
      () =>
        registerSecondaryUserAccount({
          username: 'newmember',
          email: ADMIN_RECOVERY_EMAIL,
          password: 'Password123',
        }),
      /Admin/i,
    );

    const created = registerSecondaryUserAccount({
      username: 'RohanBidDesk',
      email: 'rohan.desk@gmail.com',
      password: 'Rohan@2027',
      credentialToken: 'sec.token.1',
    });
    assert.equal(created.role, 'secondary');
    assert.equal(created.email, 'rohan.desk@gmail.com');

    assert.throws(
      () =>
        registerSecondaryUserAccount({
          username: 'rohanbiddesk',
          email: 'different@gmail.com',
          password: 'Password123',
        }),
      /already registered/i,
    );

    assert.throws(
      () =>
        registerSecondaryUserAccount({
          username: 'AnotherUser',
          email: 'ROHAN.DESK@gmail.com',
          password: 'Password123',
        }),
      /already linked/i,
    );

    const secLogin = validateLoginCredentials('RohanBidDesk', 'Rohan@2027');
    assert.equal(secLogin.ok, true);
    assert.equal(secLogin.user?.role, 'secondary');
    assert.equal(secLogin.user?.email, 'rohan.desk@gmail.com');

    const secEmailLogin = validateLoginCredentials('rohan.desk@gmail.com', 'Rohan@2027');
    assert.equal(secEmailLogin.ok, true);
    assert.equal(secEmailLogin.user?.userId, created.userId);

    // Per-user password reset updates only the secondary user, leaving Admin password untouched
    saveResetPasswordCredential('RohanBidDesk', 'RohanUpdated@2028', 'sec.token.2');
    assert.equal(validateLoginCredentials('RohanBidDesk', 'RohanUpdated@2028').ok, true);
    assert.equal(validateLoginCredentials('RohanBidDesk', 'Rohan@2027').ok, false);
    assert.equal(validateLoginCredentials(VALID_LOGIN_USERNAME, VALID_LOGIN_PASSWORD).ok, true);

    assert.equal(findUserByIdentifier('rohan.desk@gmail.com')?.username, 'RohanBidDesk');
    assert.equal(listSecondaryUsers().length, 1);

    // Secondary workspace starts empty with zero Admin data and saves without wiping localStorage
    const emptyWs = buildEmptySecondaryWorkspace({
      userId: created.userId,
      username: created.username,
      email: created.email,
    });
    assert.equal(emptyWs.tenders.length, 0);
    assert.equal(emptyWs.emdRecords.length, 0);
    assert.equal(emptyWs.mafTrackers.length, 0);
    assert.equal(emptyWs.emailSettings.recipientEmail, 'rohan.desk@gmail.com');
    assert.equal(emptyWs.sheetSettings.webhookUrl, '');

    saveSecondaryWorkspaceSnapshot(created.userId, emptyWs);
    const reloadedWs = loadSecondaryWorkspaceSnapshot(created.userId);
    assert.equal(reloadedWs?.firmProfile.adminName, 'RohanBidDesk');
    assert.equal(store.get('crm_tenders_backup'), '[{"id":"admin-tender-1"}]');

    // Stored credentials must NEVER persist raw plaintext passwords in localStorage
    const usersJson = store.get('vansh_crm_auth_users_v2') || '';
    const overrideJson = store.get('vansh_crm_auth_credential_v1') || '';
    assert.ok(!usersJson.includes('Rohan@2027'));
    assert.ok(!usersJson.includes('RohanUpdated@2028'));
    assert.ok(!overrideJson.includes('FreshPass@2028'));
    assert.ok(usersJson.includes('passwordHash'));
  } finally {
    clearInMemoryPasswordOverrideForTests();
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = prevWindow;
    }
  }
});

test('validateLoginCredentials supports legacy plaintext localStorage overrides and strips plaintext on next save', () => {
  const prevWindow = (globalThis as { window?: unknown }).window;
  const legacyStore = JSON.stringify({
    sec_legacy: {
      userId: 'sec_legacy',
      username: 'LegacyDesk',
      email: 'legacy.desk@gmail.com',
      role: 'secondary',
      password: 'LegacyPlaintext@123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isActive: true,
    },
  });
  const { store, mockWindow } = createMockWindowStorage([
    ['vansh_crm_auth_users_v2', legacyStore],
  ]);
  (globalThis as { window: unknown }).window = mockWindow;

  try {
    clearInMemoryPasswordOverrideForTests();
    assert.equal(validateLoginCredentials('LegacyDesk', 'LegacyPlaintext@123').ok, true);

    saveResetPasswordCredential('LegacyDesk', 'MigratedPass@456');
    const updatedJson = store.get('vansh_crm_auth_users_v2') || '';
    assert.ok(!updatedJson.includes('LegacyPlaintext@123'));
    assert.ok(!updatedJson.includes('MigratedPass@456'));
    assert.equal(validateLoginCredentials('LegacyDesk', 'MigratedPass@456').ok, true);
  } finally {
    clearInMemoryPasswordOverrideForTests();
    if (prevWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window: unknown }).window = prevWindow;
    }
  }
});

