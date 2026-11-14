import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VALID_LOGIN_PASSWORD,
  VALID_LOGIN_USERNAME,
  validateLoginCredentials,
} from './authCredentials';

test('validateLoginCredentials accepts exact VanshSales / Vansh@2027 credentials (with trimmed username spaces)', () => {
  assert.deepEqual(validateLoginCredentials(VALID_LOGIN_USERNAME, VALID_LOGIN_PASSWORD), {
    ok: true,
  });
  assert.deepEqual(validateLoginCredentials('  VanshSales  ', 'Vansh@2027'), {
    ok: true,
  });
});

test('validateLoginCredentials rejects empty, wrong-case, or invalid credentials', () => {
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
