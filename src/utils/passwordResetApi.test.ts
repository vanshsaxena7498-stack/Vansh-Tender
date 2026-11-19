import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test, { after, before } from 'node:test';
import express from 'express';
import handler, { restoreVercelApiUrl } from '../../api/index.ts';
import { createApiRouter } from '../../server-core.ts';

const STATE_DIR = path.resolve(process.cwd(), '.data');
const STATE_FILE = path.join(STATE_DIR, 'crm-server-state.json');

let hadStateFile = false;
let priorStateContent = '';
let hadDataDir = false;

before(() => {
  hadDataDir = fs.existsSync(STATE_DIR);
  if (fs.existsSync(STATE_FILE)) {
    hadStateFile = true;
    priorStateContent = fs.readFileSync(STATE_FILE, 'utf8');
  }
});

after(() => {
  if (hadStateFile) {
    fs.writeFileSync(STATE_FILE, priorStateContent, 'utf8');
  } else {
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
    }
    if (!hadDataDir && fs.existsSync(STATE_DIR)) {
      try {
        fs.rmdirSync(STATE_DIR);
      } catch {
        // Ignore non-empty dir
      }
    }
  }
});

async function withHttpServer(
  listener: http.RequestListener,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to bind ephemeral test port');
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('restoreVercelApiUrl restores subpaths forwarded via __api_path or Vercel headers', () => {
  assert.equal(
    restoreVercelApiUrl('/api/index?__api_path=/auth/forgot-password', {}),
    '/api/auth/forgot-password',
  );
  assert.equal(
    restoreVercelApiUrl('/api/index?__api_path=/auth/verify-code&source=ui', {}),
    '/api/auth/verify-code?source=ui',
  );
  assert.equal(
    restoreVercelApiUrl('/api/index?__api_path=/auth/reset-password', {}),
    '/api/auth/reset-password',
  );
  assert.equal(
    restoreVercelApiUrl('/api/index', { 'x-matched-path': '/api/auth/login' }),
    '/api/auth/login',
  );
  assert.equal(
    restoreVercelApiUrl('/api/auth/forgot-password', {}),
    '/api/auth/forgot-password',
  );
});

test('Vercel handler routes /api/index?__api_path=/auth/forgot-password without 404 when SMTP/Resend unconfigured', async () => {
  const prevResend = process.env.RESEND_API_KEY;
  const prevSmtpUser = process.env.SMTP_USER;
  const prevSmtpPass = process.env.SMTP_PASS;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  try {
    await withHttpServer(handler as unknown as http.RequestListener, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/index?__api_path=/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail: 'vanshsaxena7498@gmail.com' }),
      });
      assert.equal(res.status, 200);
      const data = (await res.json()) as {
        ok: boolean;
        emailSent: boolean;
        providerConfigured: boolean;
        recipient: string;
        otpCode?: unknown;
      };
      assert.equal(data.ok, true);
      assert.equal(data.emailSent, false);
      assert.equal(data.providerConfigured, false);
      assert.equal(data.recipient, 'vanshsaxena7498@gmail.com');
      assert.equal(data.otpCode, undefined, 'Never leak raw OTP in API response');

      const missingRes = await fetch(`${baseUrl}/api/index?__api_path=/auth/non-existent`, {
        method: 'POST',
      });
      assert.equal(missingRes.status, 404);
      const missingJson = (await missingRes.json()) as { ok: boolean; error: string };
      assert.equal(missingJson.ok, false);
    });
  } finally {
    if (prevResend !== undefined) process.env.RESEND_API_KEY = prevResend;
    if (prevSmtpUser !== undefined) process.env.SMTP_USER = prevSmtpUser;
    if (prevSmtpPass !== undefined) process.env.SMTP_PASS = prevSmtpPass;
  }
});

test('End-to-end OTP forgot-password -> verify-code -> reset-password -> stateless login survives fresh router instance', async () => {
  const prevResend = process.env.RESEND_API_KEY;
  const prevFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = 're_test_key_123';

  let capturedOtp = '';
  let capturedRecipient = '';

  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === 'https://api.resend.com/emails') {
      const body = JSON.parse(String(init?.body || '{}')) as { to?: string[]; text?: string };
      capturedRecipient = body.to?.[0] || '';
      const match = (body.text || '').match(/Verification Code is:\s*(\d{6})/);
      capturedOtp = match?.[1] || '';
      return new Response(JSON.stringify({ id: 'email_123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return prevFetch(input, init);
  };

  globalThis.fetch = mockFetch;

  try {
    let savedCredentialToken = '';
    let savedCookieHeader = '';

    await withHttpServer(handler as unknown as http.RequestListener, async (baseUrl) => {
      // 1. Send reset code
      const forgotRes = await prevFetch(`${baseUrl}/api/index?__api_path=/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetEmail: 'vanshsaxena7498@gmail.com' }),
      });
      assert.equal(forgotRes.status, 200);
      const forgotJson = (await forgotRes.json()) as {
        ok: boolean;
        emailSent: boolean;
        otpToken?: string;
        otpCode?: unknown;
      };
      assert.equal(forgotJson.ok, true);
      assert.equal(forgotJson.emailSent, true);
      assert.equal(forgotJson.otpCode, undefined);
      assert.ok(forgotJson.otpToken);
      assert.equal(capturedRecipient, 'vanshsaxena7498@gmail.com');
      assert.match(capturedOtp, /^\d{6}$/);

      // 2. Wrong OTP fails cleanly with 400
      const wrongCode = capturedOtp === '000000' ? '111111' : '000000';
      const badVerifyRes = await prevFetch(`${baseUrl}/api/index?__api_path=/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: wrongCode, otpToken: forgotJson.otpToken }),
      });
      assert.equal(badVerifyRes.status, 400);

      // 3. Valid OTP returns verifiedToken
      const goodVerifyRes = await prevFetch(`${baseUrl}/api/index?__api_path=/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: capturedOtp, otpToken: forgotJson.otpToken }),
      });
      assert.equal(goodVerifyRes.status, 200);
      const verifyJson = (await goodVerifyRes.json()) as {
        ok: boolean;
        verifiedToken?: string;
      };
      assert.equal(verifyJson.ok, true);
      assert.ok(verifyJson.verifiedToken);

      // 4. Reset password issues credentialToken + HttpOnly cookie
      const resetRes = await prevFetch(`${baseUrl}/api/index?__api_path=/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'otp',
          verifiedToken: verifyJson.verifiedToken,
          newPassword: 'UpdatedPass@2029',
        }),
      });
      assert.equal(resetRes.status, 200);
      const resetJson = (await resetRes.json()) as {
        ok: boolean;
        username?: string;
        credentialToken?: string;
      };
      assert.equal(resetJson.ok, true);
      assert.equal(resetJson.username, 'VanshSales');
      assert.ok(resetJson.credentialToken);
      savedCredentialToken = resetJson.credentialToken;

      const setCookie = resetRes.headers.get('set-cookie') || '';
      assert.ok(setCookie.includes('vansh_crm_pwd='));
      savedCookieHeader = setCookie.split(';')[0];

      // 5. Login with new password succeeds, old password fails
      const newLoginRes = await prevFetch(`${baseUrl}/api/index?__api_path=/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'VanshSales',
          password: 'UpdatedPass@2029',
          credentialToken: savedCredentialToken,
        }),
      });
      assert.equal(newLoginRes.status, 200);

      const oldLoginRes = await prevFetch(`${baseUrl}/api/index?__api_path=/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'VanshSales',
          password: 'Vansh@2027',
          credentialToken: savedCredentialToken,
        }),
      });
      assert.equal(oldLoginRes.status, 401);
    });

    // 6. Simulate Vercel cold start: wipe persisted state file & spin up a brand new Express router
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
    }
    const coldApp = express();
    coldApp.use(express.json());
    coldApp.use('/api', createApiRouter());

    await withHttpServer(coldApp as unknown as http.RequestListener, async (coldBaseUrl) => {
      const loginViaCookie = await prevFetch(`${coldBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: savedCookieHeader,
        },
        body: JSON.stringify({
          username: 'VanshSales',
          password: 'UpdatedPass@2029',
        }),
      });
      assert.equal(
        loginViaCookie.status,
        200,
        'Reset password must succeed across serverless cold starts via signed HttpOnly cookie',
      );

      const loginViaToken = await prevFetch(`${coldBaseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'VanshSales',
          password: 'UpdatedPass@2029',
          credentialToken: savedCredentialToken,
        }),
      });
      assert.equal(
        loginViaToken.status,
        200,
        'Reset password must succeed across serverless cold starts via signed credentialToken',
      );
    });
  } finally {
    globalThis.fetch = prevFetch;
    if (prevResend === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = prevResend;
    }
  }
});

test('Secondary user signup OTP, per-user forgot password, Admin-only directory, and sheet-sync 502 hardening', async () => {
  const prevResend = process.env.RESEND_API_KEY;
  const prevFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = 're_test_key_123';

  const sentEmails: Array<{ to: string; subject: string; text: string }> = [];

  globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === 'https://api.resend.com/emails') {
      const body = JSON.parse(String(init?.body || '{}')) as {
        to?: string[];
        subject?: string;
        text?: string;
      };
      sentEmails.push({
        to: body.to?.[0] || '',
        subject: body.subject || '',
        text: body.text || '',
      });
      return new Response(JSON.stringify({ id: `email_${sentEmails.length}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === 'https://script.google.com/macros/s/test-bad-text/exec') {
      return new Response('A server error has occurred on Apps Script', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    return prevFetch(input, init);
  }) as typeof fetch;

  try {
    await withHttpServer(handler as unknown as http.RequestListener, async (baseUrl) => {
      // 1. Signup OTP goes strictly to secondary user's Gmail, NEVER Admin Gmail
      const sendSignupOtpRes = await prevFetch(`${baseUrl}/api/auth/signup/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'priya.biddesk@gmail.com' }),
      });
      assert.equal(sendSignupOtpRes.status, 200);
      const sendSignupJson = (await sendSignupOtpRes.json()) as {
        ok: boolean;
        recipient: string;
        otpToken?: string;
      };
      assert.equal(sendSignupJson.ok, true);
      assert.equal(sendSignupJson.recipient, 'priya.biddesk@gmail.com');
      assert.ok(sendSignupJson.otpToken);

      const lastEmail = sentEmails[sentEmails.length - 1];
      assert.equal(lastEmail.to, 'priya.biddesk@gmail.com');
      assert.notEqual(lastEmail.to, 'vanshsaxena7498@gmail.com');
      const signupOtpMatch = lastEmail.text.match(/Verification Code:\s*(\d{6})/);
      assert.ok(signupOtpMatch?.[1]);

      // 2. Verify signup OTP
      const verifySignupRes = await prevFetch(`${baseUrl}/api/auth/signup/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'priya.biddesk@gmail.com',
          otp: signupOtpMatch[1],
          otpToken: sendSignupJson.otpToken,
        }),
      });
      assert.equal(verifySignupRes.status, 200);
      const verifySignupJson = (await verifySignupRes.json()) as {
        ok: boolean;
        verifiedToken?: string;
      };
      assert.equal(verifySignupJson.ok, true);
      assert.ok(verifySignupJson.verifiedToken);

      // 3. Complete signup
      const completeSignupRes = await prevFetch(`${baseUrl}/api/auth/signup/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'priya.biddesk@gmail.com',
          username: 'PriyaOps',
          password: 'Priya@2027',
          verifiedToken: verifySignupJson.verifiedToken,
        }),
      });
      assert.equal(completeSignupRes.status, 201);
      const completeJson = (await completeSignupRes.json()) as {
        ok: boolean;
        user: { userId: string; username: string; email: string; role: string };
        credentialToken: string;
      };
      assert.equal(completeJson.ok, true);
      assert.equal(completeJson.user.username, 'PriyaOps');
      assert.equal(completeJson.user.role, 'secondary');
      assert.equal(completeJson.user.email, 'priya.biddesk@gmail.com');

      // 4. Secondary user login returns NO adminSessionToken; Admin login returns adminSessionToken
      const secLoginRes = await prevFetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'PriyaOps',
          password: 'Priya@2027',
          clientCredentialTokens: [completeJson.credentialToken],
        }),
      });
      assert.equal(secLoginRes.status, 200);
      const secLoginJson = (await secLoginRes.json()) as {
        ok: boolean;
        adminSessionToken?: string;
      };
      assert.equal(secLoginJson.ok, true);
      assert.equal(secLoginJson.adminSessionToken, undefined);

      // Admin-only endpoint rejects missing/non-admin token
      const unauthorizedList = await prevFetch(`${baseUrl}/api/auth/secondary-users`);
      assert.equal(unauthorizedList.status, 403);

      // Admin logs in cleanly (with current password or reset token; ensure Admin works)
      const adminForgotRes = await prevFetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'VanshSales' }),
      });
      assert.equal(adminForgotRes.status, 200);
      const adminOtpEmail = sentEmails[sentEmails.length - 1];
      assert.equal(adminOtpEmail.to, 'vanshsaxena7498@gmail.com');

      const adminLoginRes = await prevFetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'VanshSales',
          password: 'UpdatedPass@2029',
        }),
      });
      // Fallback if cold test had initial default password instead
      let adminSessionToken = '';
      if (adminLoginRes.status === 200) {
        const j = (await adminLoginRes.json()) as { adminSessionToken?: string };
        adminSessionToken = j.adminSessionToken || '';
      } else {
        const defaultAdminLoginRes = await prevFetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identifier: 'VanshSales',
            password: 'Vansh@2027',
          }),
        });
        assert.equal(defaultAdminLoginRes.status, 200);
        const j = (await defaultAdminLoginRes.json()) as { adminSessionToken?: string };
        adminSessionToken = j.adminSessionToken || '';
      }
      assert.ok(adminSessionToken);

      const authorizedList = await prevFetch(`${baseUrl}/api/auth/secondary-users`, {
        headers: { 'x-crm-admin-token': adminSessionToken },
      });
      assert.equal(authorizedList.status, 200);
      const listJson = (await authorizedList.json()) as {
        ok: boolean;
        users: Array<{ username: string; email: string }>;
      };
      assert.equal(listJson.ok, true);
      assert.ok(listJson.users.some((u) => u.username === 'PriyaOps' && u.email === 'priya.biddesk@gmail.com'));

      // 5. Per-user Forgot Password for PriyaOps routes OTP strictly to priya.biddesk@gmail.com
      const secForgotRes = await prevFetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'PriyaOps',
          clientCredentialTokens: [completeJson.credentialToken],
        }),
      });
      assert.equal(secForgotRes.status, 200);
      const secForgotJson = (await secForgotRes.json()) as {
        ok: boolean;
        targetEmail: string;
        otpToken?: string;
      };
      assert.equal(secForgotJson.targetEmail, 'priya.biddesk@gmail.com');
      const secOtpEmail = sentEmails[sentEmails.length - 1];
      assert.equal(secOtpEmail.to, 'priya.biddesk@gmail.com');
      const secResetMatch = secOtpEmail.text.match(/Verification Code is:\s*(\d{6})/);
      assert.ok(secResetMatch?.[1]);

      const secVerifyRes = await prevFetch(`${baseUrl}/api/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otp: secResetMatch[1],
          otpToken: secForgotJson.otpToken,
        }),
      });
      assert.equal(secVerifyRes.status, 200);
      const secVerifyJson = (await secVerifyRes.json()) as { verifiedToken: string };

      const secResetRes = await prevFetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'otp',
          verifiedToken: secVerifyJson.verifiedToken,
          newPassword: 'PriyaReset@2028',
          clientCredentialTokens: [completeJson.credentialToken],
        }),
      });
      assert.equal(secResetRes.status, 200);
      const secResetJson = (await secResetRes.json()) as {
        ok: boolean;
        username: string;
        credentialToken: string;
      };
      assert.equal(secResetJson.username, 'PriyaOps');

      const secNewLogin = await prevFetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'PriyaOps',
          password: 'PriyaReset@2028',
          clientCredentialTokens: [secResetJson.credentialToken],
        }),
      });
      assert.equal(secNewLogin.status, 200);

      // 6. Sheet sync proxy returns clean JSON 502 instead of throwing when Apps Script returns plain text error
      const sheetRes = await prevFetch(`${baseUrl}/api/sheet-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: 'https://script.google.com/macros/s/test-bad-text/exec',
          payload: { sheetName: 'MIS Monthly Report', tenders: [] },
        }),
      });
      assert.equal(sheetRes.status, 502);
      const sheetJson = (await sheetRes.json()) as { ok: boolean; error: string };
      assert.equal(sheetJson.ok, false);
      assert.match(sheetJson.error, /non-JSON response/i);
    });
  } finally {
    globalThis.fetch = prevFetch;
    if (prevResend === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = prevResend;
    }
  }
});

