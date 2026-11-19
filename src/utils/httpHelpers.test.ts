import assert from 'node:assert/strict';
import test from 'node:test';
import { safeReadJsonResponse } from './httpHelpers';

test('safeReadJsonResponse parses valid JSON responses cleanly', async () => {
  const res = new Response(JSON.stringify({ ok: true, count: 3 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  const parsed = await safeReadJsonResponse<{ ok: boolean; count: number }>(res);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, 200);
  assert.equal(parsed.data?.count, 3);
  assert.equal(parsed.errorMessage, null);
});

test('safeReadJsonResponse respects ok: false inside JSON payloads', async () => {
  const res = new Response(JSON.stringify({ ok: false, error: 'Invalid OTP code' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  const parsed = await safeReadJsonResponse(res);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errorMessage, 'Invalid OTP code');
});

test('safeReadJsonResponse catches plain-text server error without throwing SyntaxError', async () => {
  const res = new Response('A server error has occurred while executing function.', {
    status: 500,
    headers: { 'Content-Type': 'text/plain' },
  });
  const parsed = await safeReadJsonResponse(res);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.data, null);
  assert.match(parsed.errorMessage || '', /unexpected text error \(HTTP 500\)/i);
  assert.match(parsed.errorMessage || '', /A server error/i);
});

test('safeReadJsonResponse explains HTML and Google Sign-In pages cleanly', async () => {
  const htmlErr = new Response('<!doctype html><html><title>Error 502</title><body>Bad Gateway</body></html>', {
    status: 502,
  });
  const parsedHtml = await safeReadJsonResponse(htmlErr);
  assert.equal(parsedHtml.ok, false);
  assert.match(parsedHtml.errorMessage || '', /HTML page instead of JSON/i);

  const googleLoginHtml = new Response(
    '<html><head><title>Sign in</title></head><body>Redirecting to accounts.google.com/ServiceLogin</body></html>',
    { status: 200 },
  );
  const parsedGoogle = await safeReadJsonResponse(googleLoginHtml);
  assert.equal(parsedGoogle.ok, false);
  assert.match(parsedGoogle.errorMessage || '', /Google Sign-In HTML page/i);
});

test('safeReadJsonResponse handles empty 200 and 500 response bodies', async () => {
  const emptyOk = new Response('', { status: 200 });
  const parsedOk = await safeReadJsonResponse(emptyOk);
  assert.equal(parsedOk.ok, true);
  assert.equal(parsedOk.data, null);
  assert.equal(parsedOk.errorMessage, null);

  const emptyErr = new Response('   ', { status: 500 });
  const parsedErr = await safeReadJsonResponse(emptyErr);
  assert.equal(parsedErr.ok, false);
  assert.match(parsedErr.errorMessage || '', /empty error response \(HTTP 500\)/i);
});
