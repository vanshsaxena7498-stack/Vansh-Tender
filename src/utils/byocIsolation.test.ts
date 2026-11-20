import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIsolatedTargetDescriptor,
  buildByocConsoleUrl,
  CENTRAL_FIREBASE_PROJECT_ID,
  parseFirebaseConfigSnippet,
  validateByocFirebaseConfig,
} from '../lib/byocConfigHelpers';

interface TestTargetDescriptor {
  projectId: string;
  isByoc: boolean;
  role: 'admin' | 'secondary';
}

const CENTRAL_ADMIN_TARGET: TestTargetDescriptor = {
  projectId: CENTRAL_FIREBASE_PROJECT_ID,
  isByoc: false,
  role: 'admin',
};

test('parseFirebaseConfigSnippet parses JSON and JS const firebaseConfig blocks safely', () => {
  const jsSnippet = `
    const firebaseConfig = {
      apiKey: "AIzaSyDemoNiyan12345",
      authDomain: "niyan-crm-cloud.firebaseapp.com",
      projectId: "niyan-crm-cloud",
      storageBucket: "niyan-crm-cloud.firebasestorage.app",
      messagingSenderId: "9988776655",
      appId: "1:9988776655:web:abcdef123456"
    };
  `;
  const parsedJs = parseFirebaseConfigSnippet(jsSnippet);
  assert.ok(parsedJs !== null);
  assert.equal(parsedJs?.projectId, 'niyan-crm-cloud');
  assert.equal(parsedJs?.apiKey, 'AIzaSyDemoNiyan12345');
  assert.equal(parsedJs?.appId, '1:9988776655:web:abcdef123456');

  const jsonSnippet = JSON.stringify({
    apiKey: 'AIzaSyJsonKey',
    authDomain: 'niyan-json.firebaseapp.com',
    projectId: 'niyan-json',
    appId: '1:123:web:456',
    databaseId: 'custom-db',
  });
  const parsedJson = parseFirebaseConfigSnippet(jsonSnippet);
  assert.equal(parsedJson?.projectId, 'niyan-json');
  assert.equal(parsedJson?.firestoreDatabaseId, 'custom-db');
  assert.equal(parseFirebaseConfigSnippet('random invalid text'), null);
});

test('validateByocFirebaseConfig blocks Admin central Firebase projectId and accepts isolated user projects', () => {
  const conflict = validateByocFirebaseConfig({
    apiKey: 'AIzaSyTest',
    authDomain: `${CENTRAL_FIREBASE_PROJECT_ID}.firebaseapp.com`,
    projectId: CENTRAL_FIREBASE_PROJECT_ID,
    appId: '1:111:web:222',
  });
  assert.equal(conflict.valid, false);
  assert.match(conflict.error || '', /Admin cloud/i);

  const missing = validateByocFirebaseConfig({
    projectId: 'niyan-own-project',
  });
  assert.equal(missing.valid, false);
  assert.ok(missing.missingFields.includes('apiKey'));
  assert.ok(missing.missingFields.includes('appId'));

  const valid = validateByocFirebaseConfig({
    apiKey: 'AIzaSyOwnKey',
    authDomain: 'niyan-own-project.firebaseapp.com',
    projectId: 'niyan-own-project',
    appId: '1:555:web:666',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.normalized.projectId, 'niyan-own-project');
});

test('assertIsolatedTargetDescriptor blocks unconfigured secondary users and central-project spoofing, while allowing Admin or verified BYOC', () => {
  assert.throws(
    () =>
      assertIsolatedTargetDescriptor({
        role: 'secondary',
        workspaceTenantId: 'sec_niyan',
        target: null,
        adminFallback: CENTRAL_ADMIN_TARGET,
      }),
    /BYOC_NOT_CONFIGURED/,
  );

  assert.throws(
    () =>
      assertIsolatedTargetDescriptor({
        role: 'secondary',
        workspaceTenantId: 'sec_niyan',
        target: CENTRAL_ADMIN_TARGET,
        adminFallback: CENTRAL_ADMIN_TARGET,
      }),
    /BYOC_NOT_CONFIGURED/,
  );

  const spoofedByocTarget: TestTargetDescriptor = {
    ...CENTRAL_ADMIN_TARGET,
    isByoc: true,
    role: 'secondary',
  };
  assert.throws(
    () =>
      assertIsolatedTargetDescriptor({
        role: 'secondary',
        workspaceTenantId: 'sec_niyan',
        target: spoofedByocTarget,
        adminFallback: CENTRAL_ADMIN_TARGET,
      }),
    /BYOC_PROJECT_CONFLICT/,
  );

  const validByocTarget: TestTargetDescriptor = {
    projectId: 'niyan-own-project',
    isByoc: true,
    role: 'secondary',
  };
  const resolvedSecondary = assertIsolatedTargetDescriptor({
    role: 'secondary',
    workspaceTenantId: 'sec_niyan',
    target: validByocTarget,
    adminFallback: CENTRAL_ADMIN_TARGET,
  });
  assert.equal(resolvedSecondary.projectId, 'niyan-own-project');

  const resolvedAdmin = assertIsolatedTargetDescriptor({
    role: 'admin',
    workspaceTenantId: null,
    target: null,
    adminFallback: CENTRAL_ADMIN_TARGET,
  });
  assert.equal(resolvedAdmin.projectId, CENTRAL_FIREBASE_PROJECT_ID);
});

test('buildByocConsoleUrl generates user-specific Firebase Console URL or null when unconfigured', () => {
  assert.equal(buildByocConsoleUrl('', ''), null);
  assert.equal(
    buildByocConsoleUrl('niyan-own-project', ''),
    'https://console.firebase.google.com/project/niyan-own-project/firestore/databases/(default)/data',
  );
  assert.equal(
    buildByocConsoleUrl('niyan-own-project', 'niyan-db'),
    'https://console.firebase.google.com/project/niyan-own-project/firestore/databases/niyan-db/data',
  );
});

