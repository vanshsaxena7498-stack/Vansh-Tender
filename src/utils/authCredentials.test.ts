import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEmptySecondaryWorkspace,
  computeEffectivePresenceStatus,
  deduplicateSecondaryUsers,
  hasCrmPermission,
  isWorkspaceAdminRole,
  normalizeCrmRole,
  PRESENCE_HEARTBEAT_TTL_MS,
  ROLE_LABELS,
  sanitizeUserIdSlug,
} from './authCredentials.ts';

test('RBAC role normalization and permission matrix enforce least privilege', () => {
  assert.equal(normalizeCrmRole('owner'), 'owner');
  assert.equal(normalizeCrmRole('admin'), 'admin');
  assert.equal(normalizeCrmRole('manager'), 'manager');
  assert.equal(normalizeCrmRole('finance'), 'finance');
  assert.equal(normalizeCrmRole('viewer'), 'viewer');
  assert.equal(normalizeCrmRole('secondary'), 'executive');
  assert.equal(normalizeCrmRole('unknown'), 'viewer');

  assert.equal(isWorkspaceAdminRole('owner'), true);
  assert.equal(isWorkspaceAdminRole('admin'), true);
  assert.equal(isWorkspaceAdminRole('manager'), false);
  assert.equal(isWorkspaceAdminRole('viewer'), false);

  assert.equal(hasCrmPermission('owner', 'team.manage'), true);
  assert.equal(hasCrmPermission('admin', 'settings.manage'), true);
  assert.equal(hasCrmPermission('manager', 'tenders.delete'), true);
  assert.equal(hasCrmPermission('manager', 'team.manage'), false);
  assert.equal(hasCrmPermission('executive', 'tenders.write'), true);
  assert.equal(hasCrmPermission('executive', 'tenders.delete'), false);
  assert.equal(hasCrmPermission('finance', 'emd.write'), true);
  assert.equal(hasCrmPermission('finance', 'tenders.write'), false);
  assert.equal(hasCrmPermission('viewer', 'tenders.read'), true);
  assert.equal(hasCrmPermission('viewer', 'tenders.write'), false);

  assert.ok(ROLE_LABELS.owner.length > 0);
  assert.ok(ROLE_LABELS.viewer.length > 0);
});

test('computeEffectivePresenceStatus respects 90s TTL and disabled lock', () => {
  const baseNow = Date.parse('2026-11-20T10:00:00.000Z');
  assert.equal(
    computeEffectivePresenceStatus(
      {
        isEnabled: true,
        isActive: true,
        presenceStatus: 'active',
        lastHeartbeatAt: new Date(baseNow).toISOString(),
      },
      baseNow + 30_000,
    ),
    'active',
  );

  assert.equal(
    computeEffectivePresenceStatus(
      {
        isEnabled: true,
        isActive: true,
        presenceStatus: 'active',
        lastHeartbeatAt: new Date(baseNow).toISOString(),
      },
      baseNow + PRESENCE_HEARTBEAT_TTL_MS + 5_000,
    ),
    'not_active',
  );

  assert.equal(
    computeEffectivePresenceStatus(
      {
        isEnabled: false,
        isActive: true,
        presenceStatus: 'active',
        lastHeartbeatAt: new Date(baseNow).toISOString(),
      },
      baseNow + 1_000,
    ),
    'not_active',
  );
});

test('deduplicateSecondaryUsers merges aliases and buildEmptySecondaryWorkspace starts cleanly without mock seeds or default PIN', () => {
  const deduped = deduplicateSecondaryUsers([
    {
      userId: 'usr_old',
      username: 'PriyaOps',
      email: 'Priya.Desk@EXAMPLE.COM',
      role: 'executive',
      createdAt: '2026-11-10T10:00:00.000Z',
      isActive: false,
      isEnabled: true,
      presenceStatus: 'not_active',
    },
    {
      userId: 'usr_new',
      username: 'PriyaOps',
      email: 'priya.desk@example.com',
      role: 'manager',
      createdAt: '2026-11-18T10:00:00.000Z',
      lastHeartbeatAt: '2026-11-20T05:30:00.000Z',
      isActive: true,
      isEnabled: true,
      presenceStatus: 'active',
      byocProjectId: 'priya-cloud',
    },
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.userId, 'usr_new');
  assert.equal(deduped[0]?.role, 'manager');
  assert.deepEqual(deduped[0]?.aliasUserIds?.sort(), ['usr_new', 'usr_old']);

  const emptyWs = buildEmptySecondaryWorkspace({
    userId: 'own_test_1',
    username: 'AaravAdmin',
    email: 'aarav@acmeinfra.example',
    companyName: 'Acme Infra Pvt Ltd',
  });
  assert.equal(emptyWs.firmProfile.firmName, 'Acme Infra Pvt Ltd');
  assert.equal(emptyWs.preferences.adminPin, '');
  assert.equal(emptyWs.tenders.length, 0);
  assert.equal(emptyWs.emdRecords.length, 0);
  assert.equal(emptyWs.mafTrackers.length, 0);
  assert.equal(emptyWs.emailSettings.recipientEmail, 'aarav@acmeinfra.example');
  assert.equal(sanitizeUserIdSlug('  Aarav Bid Desk! '), 'aarav_bid_desk');
});




