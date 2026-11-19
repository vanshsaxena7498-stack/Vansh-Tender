import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import nodemailer from 'nodemailer';
import {
  normalizeExtractedBidDraft,
  sanitizeDistrictStateLocation,
  type RawGeminiBidExtraction,
} from './src/utils/bidSearchParser.ts';
import {
  DEFAULT_RETRY_DELAYS_MS,
  executeWithRetryAndFallback,
  extractErrorMessage,
  extractErrorStatus,
  extractJsonObjectFromText,
  FALLBACK_PDF_MODEL,
  isNonRetryableAuthOrConfigError,
  isRetryableGeminiError,
  PRIMARY_PDF_MODEL,
  sanitizeExtractErrorMessage,
  TimeoutError,
  withRetry,
  withTimeout,
} from './src/utils/geminiRetry.ts';
import { parsePlainTextSpecItems } from './src/utils/mafAutoGenerate.ts';

const ADMIN_USER_ID = 'admin_vanshsales';
const ADMIN_USERNAME = 'VanshSales';
const DEFAULT_ADMIN_PASSWORD = process.env.CRM_INITIAL_PASSWORD || 'Vansh@2027';
const RECOVERY_EMAIL = 'vanshsaxena7498@gmail.com';
const DEFAULT_EMAIL_RECIPIENT_NAME = 'Vansh';

const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'vansh-crm-data')
  : path.resolve(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'crm-server-state.json');

type CrmUserRole = 'admin' | 'secondary';

interface PasswordRecord {
  salt: string;
  hash: string;
  updatedAt: string;
}

interface CrmServerUserRecord {
  userId: string;
  username: string;
  email: string;
  role: CrmUserRole;
  salt: string;
  hash: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  isActive: boolean;
}

interface PendingOtpRecord {
  purpose?: 'signup' | 'reset';
  userId?: string;
  username?: string;
  email?: string;
  salt: string;
  otpHash: string;
  expiresAt: number;
  attempts: number;
  requestedAt: string;
}

export interface ServerEmailAlertLogEntry {
  id: string;
  tenantId?: string;
  slotKey: string;
  tenderRefId: string;
  tenderId: string;
  slot: 'slot_11am' | 'slot_4pm' | 'manual' | 'test';
  recipientName: string;
  recipientEmail: string;
  dueDateIso: string;
  status: 'sent' | 'failed';
  provider: string;
  subject: string;
  message: string;
  errorDetail?: string;
  createdAt: string;
}

interface PersistedServerState {
  passwordRecord: PasswordRecord;
  pendingOtp: PendingOtpRecord | null;
  users: Record<string, CrmServerUserRecord>;
  pendingOtps: Record<string, PendingOtpRecord>;
  emailLogs: ServerEmailAlertLogEntry[];
}

function getHmacSecret(): string {
  return (
    process.env.CRM_TOKEN_SECRET ||
    process.env.SMTP_PASS ||
    process.env.RESEND_API_KEY ||
    'vansh-tender-software-otp-hmac-v1'
  );
}

function signSignedToken<T extends object>(payload: T): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getHmacSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySignedToken<T>(token: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, providedSig] = parts;
  if (!encoded || !providedSig) return null;
  const expectedSig = crypto
    .createHmac('sha256', getHmacSecret())
    .update(encoded)
    .digest('base64url');
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

interface ResetOtpTokenPayload {
  kind?: string;
  userId?: string;
  username?: string;
  email?: string;
  salt: string;
  otpHash: string;
  expiresAt: number;
}

function signOtpToken(payload: ResetOtpTokenPayload): string {
  return signSignedToken(payload);
}

function verifyOtpToken(token: string): ResetOtpTokenPayload | null {
  const parsed = verifySignedToken<Partial<ResetOtpTokenPayload>>(token);
  if (
    parsed &&
    (!parsed.kind || parsed.kind === 'reset_otp') &&
    typeof parsed.salt === 'string' &&
    typeof parsed.otpHash === 'string' &&
    typeof parsed.expiresAt === 'number'
  ) {
    return {
      kind: parsed.kind || 'reset_otp',
      userId: typeof parsed.userId === 'string' ? parsed.userId : ADMIN_USER_ID,
      username: typeof parsed.username === 'string' ? parsed.username : ADMIN_USERNAME,
      email: typeof parsed.email === 'string' ? parsed.email : RECOVERY_EMAIL,
      salt: parsed.salt,
      otpHash: parsed.otpHash,
      expiresAt: parsed.expiresAt,
    };
  }
  return null;
}

function signSignupOtpToken(payload: {
  email: string;
  salt: string;
  otpHash: string;
  expiresAt: number;
}): string {
  return signSignedToken({ kind: 'signup_otp', ...payload });
}

function verifySignupOtpToken(token: string): {
  email: string;
  salt: string;
  otpHash: string;
  expiresAt: number;
} | null {
  const parsed = verifySignedToken<{
    kind?: string;
    email?: string;
    salt?: string;
    otpHash?: string;
    expiresAt?: number;
  }>(token);
  if (
    parsed &&
    parsed.kind === 'signup_otp' &&
    typeof parsed.email === 'string' &&
    typeof parsed.salt === 'string' &&
    typeof parsed.otpHash === 'string' &&
    typeof parsed.expiresAt === 'number'
  ) {
    return {
      email: parsed.email.toLowerCase(),
      salt: parsed.salt,
      otpHash: parsed.otpHash,
      expiresAt: parsed.expiresAt,
    };
  }
  return null;
}

function signSignupVerifiedToken(email: string, expiresAt: number): string {
  return signSignedToken({ kind: 'signup_verified', email: email.toLowerCase(), expiresAt });
}

function verifySignupVerifiedToken(token: string): { email: string; expiresAt: number } | null {
  const parsed = verifySignedToken<{ kind?: string; email?: string; expiresAt?: number }>(token);
  if (
    parsed &&
    parsed.kind === 'signup_verified' &&
    typeof parsed.email === 'string' &&
    typeof parsed.expiresAt === 'number'
  ) {
    return { email: parsed.email.toLowerCase(), expiresAt: parsed.expiresAt };
  }
  return null;
}

function signVerifiedResetToken(params: {
  userId: string;
  username: string;
  email: string;
  expiresAt: number;
}): string {
  return signSignedToken({
    kind: 'otp_verified',
    userId: params.userId,
    username: params.username,
    email: params.email,
    expiresAt: params.expiresAt,
  });
}

function verifyVerifiedResetToken(token: string): {
  userId: string;
  username: string;
  email: string;
  expiresAt: number;
} | null {
  const parsed = verifySignedToken<{
    kind?: string;
    userId?: string;
    username?: string;
    email?: string;
    expiresAt?: number;
  }>(token);
  if (
    parsed &&
    parsed.kind === 'otp_verified' &&
    typeof parsed.expiresAt === 'number'
  ) {
    return {
      userId: typeof parsed.userId === 'string' ? parsed.userId : ADMIN_USER_ID,
      username: typeof parsed.username === 'string' ? parsed.username : ADMIN_USERNAME,
      email: typeof parsed.email === 'string' ? parsed.email : RECOVERY_EMAIL,
      expiresAt: parsed.expiresAt,
    };
  }
  return null;
}

function signUserCredentialToken(record: CrmServerUserRecord): string {
  return signSignedToken({
    kind: 'crm_user_cred',
    userId: record.userId,
    username: record.username,
    email: record.email,
    role: record.role,
    salt: record.salt,
    hash: record.hash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    isActive: record.isActive,
  });
}

function verifyUserCredentialToken(token: string): CrmServerUserRecord | null {
  const parsed = verifySignedToken<Record<string, unknown>>(token);
  if (!parsed) return null;
  if (
    parsed.kind === 'crm_user_cred' &&
    typeof parsed.userId === 'string' &&
    typeof parsed.username === 'string' &&
    typeof parsed.email === 'string' &&
    typeof parsed.salt === 'string' &&
    typeof parsed.hash === 'string' &&
    typeof parsed.updatedAt === 'string'
  ) {
    return {
      userId: parsed.userId,
      username: parsed.username,
      email: parsed.email.toLowerCase(),
      role: parsed.role === 'admin' || parsed.userId === ADMIN_USER_ID ? 'admin' : 'secondary',
      salt: parsed.salt,
      hash: parsed.hash,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : parsed.updatedAt,
      updatedAt: parsed.updatedAt,
      isActive: parsed.isActive !== false,
    };
  }
  if (
    parsed.kind === 'crm_pwd' &&
    parsed.username === ADMIN_USERNAME &&
    typeof parsed.salt === 'string' &&
    typeof parsed.hash === 'string' &&
    typeof parsed.updatedAt === 'string'
  ) {
    return {
      userId: ADMIN_USER_ID,
      username: ADMIN_USERNAME,
      email: RECOVERY_EMAIL,
      role: 'admin',
      salt: parsed.salt,
      hash: parsed.hash,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: parsed.updatedAt,
      isActive: true,
    };
  }
  return null;
}

function signAdminSessionToken(adminUser: CrmServerUserRecord): string {
  return signSignedToken({
    kind: 'admin_session',
    userId: adminUser.userId,
    username: adminUser.username,
    email: adminUser.email,
    role: 'admin',
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
}

function verifyAdminSessionToken(token: string): boolean {
  const parsed = verifySignedToken<{
    kind?: string;
    role?: string;
    userId?: string;
    expiresAt?: number;
  }>(token);
  return Boolean(
    parsed &&
      parsed.kind === 'admin_session' &&
      parsed.role === 'admin' &&
      parsed.userId === ADMIN_USER_ID &&
      typeof parsed.expiresAt === 'number' &&
      Date.now() < parsed.expiresAt,
  );
}

function readCookieValue(cookieHeader: string | undefined, name: string): string {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return '';
}

function sanitizeServerUserForClient(user: CrmServerUserRecord) {
  return {
    userId: user.userId,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    isActive: user.isActive !== false,
  };
}

function maskEmailAddress(email: string): string {
  const trimmed = email.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 1) return trimmed;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  const visibleStart = local.slice(0, Math.min(2, local.length));
  const visibleEnd = local.length > 3 ? local.slice(-1) : '';
  return `${visibleStart}***${visibleEnd}@${domain}`;
}

function hashSecret(secret: string, salt?: string): { salt: string; hash: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(secret, actualSalt, 64).toString('hex');
  return { salt: actualSalt, hash: derived };
}

function verifyHashedSecret(secret: string, salt: string, expectedHash: string): boolean {
  const derived = crypto.scryptSync(secret, salt, 64);
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  if (derived.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(derived, expectedBuf);
}

function createInitialState(): PersistedServerState {
  const { salt, hash } = hashSecret(DEFAULT_ADMIN_PASSWORD);
  const adminUpdatedAt = '1970-01-01T00:00:00.000Z';
  const adminUser: CrmServerUserRecord = {
    userId: ADMIN_USER_ID,
    username: ADMIN_USERNAME,
    email: RECOVERY_EMAIL,
    role: 'admin',
    salt,
    hash,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: adminUpdatedAt,
    isActive: true,
  };
  return {
    passwordRecord: {
      salt,
      hash,
      updatedAt: adminUpdatedAt,
    },
    pendingOtp: null,
    users: {
      [ADMIN_USER_ID]: adminUser,
    },
    pendingOtps: {},
    emailLogs: [],
  };
}

function loadServerState(): PersistedServerState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedServerState>;
      if (parsed.passwordRecord?.salt && parsed.passwordRecord?.hash) {
        const users: Record<string, CrmServerUserRecord> =
          parsed.users && typeof parsed.users === 'object' ? { ...parsed.users } : {};
        if (!users[ADMIN_USER_ID]) {
          users[ADMIN_USER_ID] = {
            userId: ADMIN_USER_ID,
            username: ADMIN_USERNAME,
            email: RECOVERY_EMAIL,
            role: 'admin',
            salt: parsed.passwordRecord.salt,
            hash: parsed.passwordRecord.hash,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: parsed.passwordRecord.updatedAt,
            isActive: true,
          };
        }
        return {
          passwordRecord: parsed.passwordRecord,
          pendingOtp: parsed.pendingOtp ?? null,
          users,
          pendingOtps:
            parsed.pendingOtps && typeof parsed.pendingOtps === 'object' ? parsed.pendingOtps : {},
          emailLogs: Array.isArray(parsed.emailLogs) ? parsed.emailLogs.slice(0, 200) : [],
        };
      }
    }
  } catch {
    // Reinitialize state cleanly if corrupted
  }
  const initial = createInitialState();
  saveServerState(initial);
  return initial;
}

function saveServerState(state: PersistedServerState): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist server auth state:', err);
  }
}

function readFirebaseApiKey(): string {
  if (process.env.VITE_FIREBASE_API_KEY) {
    return process.env.VITE_FIREBASE_API_KEY;
  }
  const candidatePaths = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(process.cwd(), '..', 'firebase-applet-config.json'),
  ];
  for (const configPath of candidatePaths) {
    try {
      if (fs.existsSync(configPath)) {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as { apiKey?: string };
        if (parsed.apiKey) return parsed.apiKey;
      }
    } catch {
      // Try next path
    }
  }
  return '';
}

function isValidEmailAddress(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

function detectEmailProvider(): 'resend' | 'smtp' | 'none' {
  if (process.env.RESEND_API_KEY?.trim()) return 'resend';
  if (process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()) return 'smtp';
  return 'none';
}

async function sendAppEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{
  sent: boolean;
  provider: 'resend' | 'smtp' | 'none';
  error?: string;
}> {
  const provider = detectEmailProvider();
  const recipient = params.to.trim();

  if (provider === 'resend') {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY?.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:
            process.env.RESEND_FROM_EMAIL?.trim() ||
            'Vansh Tender Software <onboarding@resend.dev>',
          to: [recipient],
          subject: params.subject,
          text: params.text,
          ...(params.html ? { html: params.html } : {}),
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        return { sent: false, provider, error: `Resend API error (${res.status}): ${errText}` };
      }
      return { sent: true, provider };
    } catch (err) {
      return {
        sent: false,
        provider,
        error: err instanceof Error ? err.message : 'Resend email request failed.',
      };
    }
  }

  if (provider === 'smtp') {
    const smtpHost = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const smtpUser = (process.env.SMTP_USER || '').trim();
    const rawPass = (process.env.SMTP_PASS || '').trim();
    const smtpPass = /^[a-zA-Z]{4}( [a-zA-Z]{4}){3}$/.test(rawPass)
      ? rawPass.replace(/\s+/g, '')
      : rawPass;

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
      await transporter.sendMail({
        from: `"Vansh Tender Software" <${smtpUser}>`,
        to: recipient,
        subject: params.subject,
        text: params.text,
        ...(params.html ? { html: params.html } : {}),
      });
      return { sent: true, provider };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : 'SMTP email delivery failed.';
      const friendlyMsg =
        /534[- ]5\.7\.9|Application-specific password required/i.test(rawMsg)
          ? 'Gmail requires a 16-character App Password in SMTP_PASS (regular Gmail passwords are blocked by 2FA).'
          : /535[- ]5\.7\.8|Username and Password not accepted/i.test(rawMsg)
            ? 'Gmail rejected SMTP_USER / SMTP_PASS credentials. Please check your 16-character Google App Password in SMTP_PASS.'
            : rawMsg;
      return {
        sent: false,
        provider,
        error: friendlyMsg,
      };
    }
  }

  return {
    sent: false,
    provider: 'none',
    error: 'Email gateway (SMTP_USER/SMTP_PASS or RESEND_API_KEY) is not configured.',
  };
}

async function sendSignupOtpEmail(
  targetEmail: string,
  otpCode: string,
): Promise<{
  sent: boolean;
  provider: 'resend' | 'smtp' | 'none';
  error?: string;
}> {
  const subject = 'Vansh Tender Software — New User Gmail Verification Code';
  const textBody = [
    'Hello,',
    '',
    'Use the 6-digit verification code below to verify your Gmail and create your CRM account:',
    '',
    `Verification Code: ${otpCode}`,
    '',
    'This code expires in 15 minutes. If you did not initiate this sign-up, you can safely ignore this email.',
    '',
    'Regards,',
    'Vansh Tender Software Security Desk',
  ].join('\n');

  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;color:#0f172a;">
      <h2 style="margin:0 0 8px;color:#0B1E47;">Vansh Tender Software</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#475569;">New User Gmail Verification for <strong>${targetEmail}</strong></p>
      <div style="padding:16px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;text-align:center;margin-bottom:16px;">
        <p style="margin:0 0 6px;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:1px;">Sign-Up OTP Code</p>
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:6px;color:#0B1E47;font-family:monospace;">${otpCode}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#475569;">Enter this code in the CRM sign-up form to set up your User ID and Password. Expires in <strong>15 minutes</strong>.</p>
    </div>
  `;

  return sendAppEmail({
    to: targetEmail,
    subject,
    text: textBody,
    html: htmlBody,
  });
}

async function sendRecoveryOtpEmail(
  otpCode: string,
  target: { username: string; toEmail: string },
): Promise<{
  sent: boolean;
  provider: 'resend' | 'smtp' | 'none';
  error?: string;
}> {
  const subject = 'Vansh Tender Software — Password Reset Verification Code';
  const greetingName = target.username === ADMIN_USERNAME ? 'Vansh' : target.username;
  const textBody = [
    `Hello ${greetingName},`,
    '',
    `We received a password reset request for your Vansh Tender Software CRM account (User ID: ${target.username}).`,
    '',
    `Your 6-digit Password Reset Verification Code is: ${otpCode}`,
    '',
    'This code expires in 15 minutes. If you did not request this reset, you can safely ignore this email.',
    '',
    'Regards,',
    'Vansh Tender Software Security Desk',
  ].join('\n');

  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;color:#0f172a;">
      <h2 style="margin:0 0 8px;color:#0B1E47;">Vansh Tender Software</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#475569;">Password Reset Request for <strong>${target.username}</strong></p>
      <div style="padding:16px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;text-align:center;margin-bottom:16px;">
        <p style="margin:0 0 6px;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:1px;">Verification Code</p>
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:6px;color:#0B1E47;font-family:monospace;">${otpCode}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#475569;">Enter this code on the Login screen to choose a new password. The code expires in <strong>15 minutes</strong>.</p>
    </div>
  `;

  return sendAppEmail({
    to: target.toEmail,
    subject,
    text: textBody,
    html: htmlBody,
  });
}

async function verifyGoogleIdTokenForEmail(
  idToken: string,
  expectedEmail: string,
): Promise<{
  ok: boolean;
  email?: string;
  error?: string;
}> {
  const apiKey = readFirebaseApiKey();
  if (!apiKey) {
    return { ok: false, error: 'Firebase Web API key not found on server.' };
  }
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  );
  const rawBody = await resp.text();
  if (!resp.ok) {
    return { ok: false, error: 'Google token verification failed.' };
  }
  let data: { users?: Array<{ email?: string; emailVerified?: boolean }> } = {};
  try {
    data = JSON.parse(rawBody) as { users?: Array<{ email?: string; emailVerified?: boolean }> };
  } catch {
    return { ok: false, error: 'Invalid JSON received from Google identity service.' };
  }
  const user = data.users?.[0];
  if (!user || !user.emailVerified) {
    return { ok: false, error: 'Google account email is not verified.' };
  }
  if ((user.email || '').toLowerCase() !== expectedEmail.toLowerCase()) {
    return {
      ok: false,
      error: `Only the registered email (${expectedEmail}) is authorized to reset this account password.`,
    };
  }
  return { ok: true, email: user.email };
}

export function createApiRouter(): Router {
  const router = express.Router();
  let state = loadServerState();
  const otpRateBuckets = new Map<string, number[]>();

  function checkOtpRateLimit(req: Request, bucketKey: string, maxRequests = 15, windowMs = 60_000): boolean {
    const ip =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
        : '') ||
      req.ip ||
      req.socket?.remoteAddress ||
      'local';
    const key = `${bucketKey}:${ip}`;
    const now = Date.now();
    const recent = (otpRateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      otpRateBuckets.set(key, recent);
      return false;
    }
    recent.push(now);
    otpRateBuckets.set(key, recent);
    if (otpRateBuckets.size > 500) {
      for (const [k, list] of otpRateBuckets.entries()) {
        if (list.every((ts) => now - ts >= windowMs)) {
          otpRateBuckets.delete(k);
        }
      }
    }
    return true;
  }

  function buildUserPool(req: Request, body?: Record<string, unknown>): Map<string, CrmServerUserRecord> {
    const pool = new Map<string, CrmServerUserRecord>();
    for (const user of Object.values(state.users || {})) {
      pool.set(user.userId, user);
    }
    if (!pool.has(ADMIN_USER_ID)) {
      pool.set(ADMIN_USER_ID, {
        userId: ADMIN_USER_ID,
        username: ADMIN_USERNAME,
        email: RECOVERY_EMAIL,
        role: 'admin',
        salt: state.passwordRecord.salt,
        hash: state.passwordRecord.hash,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: state.passwordRecord.updatedAt,
        isActive: true,
      });
    }

    const candidateTokens: string[] = [];
    const cookieToken = readCookieValue(req.headers.cookie, 'vansh_crm_pwd');
    if (cookieToken) candidateTokens.push(cookieToken);
    if (body && typeof body.credentialToken === 'string' && body.credentialToken) {
      candidateTokens.push(body.credentialToken);
    }
    if (body && Array.isArray(body.clientCredentialTokens)) {
      for (const tok of body.clientCredentialTokens) {
        if (typeof tok === 'string' && tok) candidateTokens.push(tok);
      }
    }

    for (const token of candidateTokens) {
      const verified = verifyUserCredentialToken(token);
      if (!verified) continue;
      const current = pool.get(verified.userId);
      if (!current || verified.updatedAt >= current.updatedAt) {
        pool.set(verified.userId, {
          ...verified,
          lastLoginAt: current?.lastLoginAt,
        });
      }
    }

    return pool;
  }

  function findUserInPool(
    pool: Map<string, CrmServerUserRecord>,
    identifier: string,
  ): CrmServerUserRecord | null {
    const trimmed = identifier.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    for (const user of pool.values()) {
      if (
        user.userId.toLowerCase() === lower ||
        user.username.toLowerCase() === lower ||
        user.email.toLowerCase() === lower
      ) {
        return user;
      }
    }
    return null;
  }

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      emailProvider: detectEmailProvider(),
      recoveryEmail: maskEmailAddress(RECOVERY_EMAIL),
      runtime: IS_VERCEL ? 'vercel-serverless' : 'node-express',
    });
  });

  router.post('/auth/login', (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      username?: unknown;
      identifier?: unknown;
      password?: unknown;
      credentialToken?: unknown;
      clientCredentialTokens?: unknown;
    };
    const identifier =
      typeof body.identifier === 'string' && body.identifier.trim()
        ? body.identifier.trim()
        : typeof body.username === 'string'
          ? body.username.trim()
          : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!identifier) {
      res.status(400).json({ ok: false, error: 'Please enter your User ID or Email ID.' });
      return;
    }
    if (!password) {
      res.status(400).json({ ok: false, error: 'Please enter your Password.' });
      return;
    }

    const pool = buildUserPool(req, body as Record<string, unknown>);
    const matched = findUserInPool(pool, identifier);

    const isEmailInput = identifier.includes('@');
    const usernameMatches =
      matched &&
      (isEmailInput ||
        identifier === matched.username ||
        identifier === matched.userId);

    if (
      !matched ||
      !usernameMatches ||
      matched.isActive === false ||
      !verifyHashedSecret(password, matched.salt, matched.hash)
    ) {
      res.status(401).json({
        ok: false,
        error: 'Invalid User ID or password. Please check your credentials and try again.',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const updatedUser: CrmServerUserRecord = {
      ...matched,
      lastLoginAt: nowIso,
    };

    state = {
      ...state,
      users: {
        ...state.users,
        [updatedUser.userId]: updatedUser,
      },
      ...(updatedUser.role === 'admin'
        ? {
            passwordRecord: {
              salt: updatedUser.salt,
              hash: updatedUser.hash,
              updatedAt: updatedUser.updatedAt,
            },
          }
        : {}),
    };
    saveServerState(state);

    const credentialToken = signUserCredentialToken(updatedUser);
    const adminSessionToken =
      updatedUser.role === 'admin' ? signAdminSessionToken(updatedUser) : undefined;

    res.json({
      ok: true,
      username: updatedUser.username,
      user: sanitizeServerUserForClient(updatedUser),
      credentialToken,
      ...(adminSessionToken ? { adminSessionToken } : {}),
    });
  });

  router.post('/auth/signup/send-otp', async (req: Request, res: Response) => {
    try {
      if (!checkOtpRateLimit(req, 'signup-otp')) {
        res.status(429).json({
          ok: false,
          error: 'Too many OTP requests. Please wait a minute before requesting another code.',
        });
        return;
      }
      const body = (req.body || {}) as {
        email?: unknown;
        clientCredentialTokens?: unknown;
      };
      const targetEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

      if (!targetEmail || !isValidEmailAddress(targetEmail)) {
        res.status(400).json({
          ok: false,
          error: 'Please enter a valid Gmail / email address to receive your verification OTP.',
        });
        return;
      }

      if (targetEmail === RECOVERY_EMAIL.toLowerCase()) {
        res.status(409).json({
          ok: false,
          error: 'This Gmail is reserved for the primary Admin account. Please use a different Gmail address.',
        });
        return;
      }

      const pool = buildUserPool(req, body as Record<string, unknown>);
      const existingByEmail = findUserInPool(pool, targetEmail);
      if (existingByEmail) {
        res.status(409).json({
          ok: false,
          error: `An account (${existingByEmail.username}) is already registered with ${targetEmail}. Please sign in or use Forgot Password.`,
        });
        return;
      }

      const otpCode = String(crypto.randomInt(100000, 1000000));
      const { salt, hash } = hashSecret(otpCode);
      const expiresAt = Date.now() + 15 * 60 * 1000;
      const otpToken = signSignupOtpToken({
        email: targetEmail,
        salt,
        otpHash: hash,
        expiresAt,
      });

      state = {
        ...state,
        pendingOtps: {
          ...state.pendingOtps,
          [`signup:${targetEmail}`]: {
            purpose: 'signup',
            email: targetEmail,
            salt,
            otpHash: hash,
            expiresAt,
            attempts: 0,
            requestedAt: new Date().toISOString(),
          },
        },
      };
      saveServerState(state);

      const delivery = await sendSignupOtpEmail(targetEmail, otpCode);
      if (!delivery.sent && delivery.provider !== 'none') {
        res.status(502).json({
          ok: false,
          emailSent: false,
          recipient: targetEmail,
          error:
            delivery.error ||
            `Failed to send verification OTP to ${targetEmail}. Please verify your email address and try again.`,
        });
        return;
      }

      if (!delivery.sent) {
        res.status(503).json({
          ok: false,
          emailSent: false,
          providerConfigured: false,
          recipient: targetEmail,
          error:
            'Email gateway (SMTP_USER/SMTP_PASS or RESEND_API_KEY) is not configured on the server to send Gmail verification OTPs.',
        });
        return;
      }

      res.json({
        ok: true,
        emailSent: true,
        providerConfigured: true,
        provider: delivery.provider,
        recipient: targetEmail,
        expiresInMinutes: 15,
        otpToken,
        message: `A 6-digit verification OTP has been sent to ${targetEmail}.`,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to send sign-up verification OTP.',
      });
    }
  });

  router.post('/auth/signup/verify-otp', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        email?: unknown;
        otp?: unknown;
        otpToken?: unknown;
      };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const otp = typeof body.otp === 'string' ? body.otp.trim() : '';

      if (!email || !isValidEmailAddress(email)) {
        res.status(400).json({ ok: false, error: 'Valid Gmail address is required.' });
        return;
      }
      if (!/^\d{6}$/.test(otp)) {
        res.status(400).json({
          ok: false,
          error: `Please enter the 6-digit verification OTP sent to ${email}.`,
        });
        return;
      }

      const signed =
        typeof body.otpToken === 'string' && body.otpToken
          ? verifySignupOtpToken(body.otpToken)
          : null;
      if (signed && signed.email !== email) {
        res.status(400).json({
          ok: false,
          error: 'OTP token does not match the entered Gmail address. Please request a fresh OTP.',
        });
        return;
      }

      const stored = state.pendingOtps[`signup:${email}`] || null;
      const activeOtp = signed
        ? {
            ...signed,
            attempts: stored && stored.otpHash === signed.otpHash ? stored.attempts : 0,
          }
        : stored;

      if (!activeOtp) {
        res.status(400).json({
          ok: false,
          error: 'No active sign-up OTP found. Please request a verification code first.',
        });
        return;
      }
      if (Date.now() > activeOtp.expiresAt) {
        const nextOtps = { ...state.pendingOtps };
        delete nextOtps[`signup:${email}`];
        state = { ...state, pendingOtps: nextOtps };
        saveServerState(state);
        res.status(400).json({
          ok: false,
          error: 'Verification OTP has expired. Please request a new code.',
        });
        return;
      }
      if (activeOtp.attempts >= 5) {
        res.status(429).json({
          ok: false,
          error: 'Too many invalid OTP attempts. Please request a new verification code.',
        });
        return;
      }

      if (!verifyHashedSecret(otp, activeOtp.salt, activeOtp.otpHash)) {
        if (stored) {
          state = {
            ...state,
            pendingOtps: {
              ...state.pendingOtps,
              [`signup:${email}`]: {
                ...stored,
                attempts: stored.attempts + 1,
              },
            },
          };
          saveServerState(state);
        }
        res.status(400).json({
          ok: false,
          error: 'Invalid 6-digit verification OTP. Please check your Gmail inbox and try again.',
        });
        return;
      }

      const verifiedToken = signSignupVerifiedToken(email, Date.now() + 20 * 60 * 1000);
      res.json({
        ok: true,
        email,
        verifiedToken,
        message: 'Gmail verified successfully! Now choose your User ID and Password.',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to verify sign-up OTP.',
      });
    }
  });

  router.post('/auth/signup/complete', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        email?: unknown;
        username?: unknown;
        password?: unknown;
        verifiedToken?: unknown;
        clientCredentialTokens?: unknown;
      };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const verifiedToken =
        typeof body.verifiedToken === 'string' ? body.verifiedToken.trim() : '';

      if (!email || !isValidEmailAddress(email)) {
        res.status(400).json({ ok: false, error: 'A verified Gmail address is required.' });
        return;
      }

      const verifiedClaim = verifiedToken ? verifySignupVerifiedToken(verifiedToken) : null;
      if (!verifiedClaim || verifiedClaim.email !== email || Date.now() > verifiedClaim.expiresAt) {
        res.status(403).json({
          ok: false,
          error: 'Gmail OTP verification is missing or expired. Please verify your Gmail OTP again.',
        });
        return;
      }

      if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
        res.status(400).json({
          ok: false,
          error: 'User ID must be 3 to 40 characters and contain only letters, numbers, "_", ".", or "-".',
        });
        return;
      }
      if (password.length < 6 || password.length > 128) {
        res.status(400).json({
          ok: false,
          error: 'Password must be between 6 and 128 characters.',
        });
        return;
      }

      if (
        username.toLowerCase() === ADMIN_USERNAME.toLowerCase() ||
        email === RECOVERY_EMAIL.toLowerCase()
      ) {
        res.status(409).json({
          ok: false,
          error: 'This User ID or Gmail belongs to the primary Admin account.',
        });
        return;
      }

      const pool = buildUserPool(req, body as Record<string, unknown>);
      const existingByUsername = findUserInPool(pool, username);
      if (existingByUsername) {
        res.status(409).json({
          ok: false,
          error: `User ID "${username}" is already taken. Please choose another User ID.`,
        });
        return;
      }
      const existingByEmail = findUserInPool(pool, email);
      if (existingByEmail) {
        res.status(409).json({
          ok: false,
          error: `Gmail "${email}" is already linked to account "${existingByEmail.username}".`,
        });
        return;
      }

      const slug = username
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48);
      const userId = `sec_${slug}_${crypto.randomBytes(2).toString('hex')}`;
      const nowIso = new Date().toISOString();
      const { salt, hash } = hashSecret(password);

      const newUser: CrmServerUserRecord = {
        userId,
        username,
        email,
        role: 'secondary',
        salt,
        hash,
        createdAt: nowIso,
        updatedAt: nowIso,
        isActive: true,
      };

      const nextOtps = { ...state.pendingOtps };
      delete nextOtps[`signup:${email}`];

      state = {
        ...state,
        users: {
          ...state.users,
          [newUser.userId]: newUser,
        },
        pendingOtps: nextOtps,
      };
      saveServerState(state);

      const credentialToken = signUserCredentialToken(newUser);
      res.status(201).json({
        ok: true,
        user: sanitizeServerUserForClient(newUser),
        credentialToken,
        message: 'Successful ID Creation! Redirecting to the Login screen.',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to complete new user registration.',
      });
    }
  });

  router.post('/auth/forgot-password', async (req: Request, res: Response) => {
    try {
      if (!checkOtpRateLimit(req, 'forgot-otp')) {
        res.status(429).json({
          ok: false,
          error: 'Too many password reset requests. Please wait a minute before trying again.',
        });
        return;
      }
      const body = (req.body || {}) as {
        identifier?: unknown;
        username?: unknown;
        targetEmail?: unknown;
        clientCredentialTokens?: unknown;
      };
      const rawIdentifier =
        (typeof body.identifier === 'string' && body.identifier.trim()) ||
        (typeof body.username === 'string' && body.username.trim()) ||
        (typeof body.targetEmail === 'string' && body.targetEmail.trim()) ||
        '';

      const pool = buildUserPool(req, body as Record<string, unknown>);
      const targetUser = rawIdentifier
        ? findUserInPool(pool, rawIdentifier)
        : pool.get(ADMIN_USER_ID) || null;

      if (!targetUser) {
        res.status(404).json({
          ok: false,
          error: `No CRM account found matching "${rawIdentifier}". Enter your exact User ID or registered Gmail address.`,
        });
        return;
      }

      const otpCode = String(crypto.randomInt(100000, 1000000));
      const { salt, hash } = hashSecret(otpCode);
      const expiresAt = Date.now() + 15 * 60 * 1000;
      const otpToken = signOtpToken({
        kind: 'reset_otp',
        userId: targetUser.userId,
        username: targetUser.username,
        email: targetUser.email,
        salt,
        otpHash: hash,
        expiresAt,
      });

      const otpRecord: PendingOtpRecord = {
        purpose: 'reset',
        userId: targetUser.userId,
        username: targetUser.username,
        email: targetUser.email,
        salt,
        otpHash: hash,
        expiresAt,
        attempts: 0,
        requestedAt: new Date().toISOString(),
      };

      state = {
        ...state,
        pendingOtp: targetUser.role === 'admin' ? otpRecord : state.pendingOtp,
        pendingOtps: {
          ...state.pendingOtps,
          [`reset:${targetUser.userId}`]: otpRecord,
        },
      };
      saveServerState(state);

      const delivery = await sendRecoveryOtpEmail(otpCode, {
        username: targetUser.username,
        toEmail: targetUser.email,
      });

      if (!delivery.sent && delivery.provider !== 'none') {
        res.status(502).json({
          ok: false,
          emailSent: false,
          userId: targetUser.userId,
          username: targetUser.username,
          recipient: targetUser.email,
          targetEmail: targetUser.email,
          maskedEmail: maskEmailAddress(targetUser.email),
          error:
            delivery.error ||
            `Failed to deliver password reset email to ${targetUser.email}. Please check SMTP/Resend settings.`,
        });
        return;
      }

      if (!delivery.sent) {
        res.json({
          ok: true,
          emailSent: false,
          providerConfigured: false,
          userId: targetUser.userId,
          username: targetUser.username,
          recipient: targetUser.email,
          targetEmail: targetUser.email,
          maskedEmail: maskEmailAddress(targetUser.email),
          message: `Email gateway (SMTP_USER/SMTP_PASS or RESEND_API_KEY) is not configured yet. Configure it to send OTP emails to ${targetUser.email}, or verify ownership directly with Google (${targetUser.email}) below.`,
        });
        return;
      }

      res.json({
        ok: true,
        emailSent: true,
        providerConfigured: true,
        provider: delivery.provider,
        userId: targetUser.userId,
        username: targetUser.username,
        recipient: targetUser.email,
        targetEmail: targetUser.email,
        maskedEmail: maskEmailAddress(targetUser.email),
        expiresInMinutes: 15,
        otpToken,
        message: `A 6-digit password reset code has been sent to ${targetUser.email}.`,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to process password reset request.',
      });
    }
  });

  const handleVerifyCode = (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        otp?: unknown;
        otpToken?: unknown;
        identifier?: unknown;
        userId?: unknown;
      };
      const otp = typeof body.otp === 'string' ? body.otp.trim() : '';

      const signedPayload =
        typeof body.otpToken === 'string' && body.otpToken ? verifyOtpToken(body.otpToken) : null;
      const targetUserId =
        signedPayload?.userId ||
        (typeof body.userId === 'string' && body.userId.trim()) ||
        ADMIN_USER_ID;
      const storedForUser =
        state.pendingOtps[`reset:${targetUserId}`] ||
        (targetUserId === ADMIN_USER_ID ? state.pendingOtp : null);

      const targetEmail =
        signedPayload?.email || storedForUser?.email || RECOVERY_EMAIL;
      const targetUsername =
        signedPayload?.username || storedForUser?.username || ADMIN_USERNAME;

      if (!/^\d{6}$/.test(otp)) {
        res.status(400).json({
          ok: false,
          error: `Please enter the 6-digit verification code sent to ${targetEmail}.`,
        });
        return;
      }

      const activeOtp = signedPayload
        ? {
            ...signedPayload,
            attempts:
              storedForUser && storedForUser.otpHash === signedPayload.otpHash
                ? storedForUser.attempts
                : 0,
          }
        : storedForUser;

      if (!activeOtp) {
        res.status(400).json({
          ok: false,
          error: 'No active reset code found. Please request a fresh code first.',
        });
        return;
      }
      if (Date.now() > activeOtp.expiresAt) {
        const nextOtps = { ...state.pendingOtps };
        delete nextOtps[`reset:${targetUserId}`];
        state = {
          ...state,
          pendingOtp: targetUserId === ADMIN_USER_ID ? null : state.pendingOtp,
          pendingOtps: nextOtps,
        };
        saveServerState(state);
        res.status(400).json({
          ok: false,
          error: 'Verification code has expired. Please request a new code.',
        });
        return;
      }
      if (activeOtp.attempts >= 5) {
        const nextOtps = { ...state.pendingOtps };
        delete nextOtps[`reset:${targetUserId}`];
        state = {
          ...state,
          pendingOtp: targetUserId === ADMIN_USER_ID ? null : state.pendingOtp,
          pendingOtps: nextOtps,
        };
        saveServerState(state);
        res.status(429).json({
          ok: false,
          error: 'Too many invalid code attempts. Please request a new reset code.',
        });
        return;
      }

      const matches = verifyHashedSecret(otp, activeOtp.salt, activeOtp.otpHash);
      if (!matches) {
        if (storedForUser) {
          const bumped = { ...storedForUser, attempts: storedForUser.attempts + 1 };
          state = {
            ...state,
            pendingOtp: targetUserId === ADMIN_USER_ID ? bumped : state.pendingOtp,
            pendingOtps: {
              ...state.pendingOtps,
              [`reset:${targetUserId}`]: bumped,
            },
          };
          saveServerState(state);
        }
        res.status(400).json({
          ok: false,
          error: 'Invalid 6-digit verification code. Please check your inbox and retry.',
        });
        return;
      }

      const verifiedToken = signVerifiedResetToken({
        userId: targetUserId,
        username: targetUsername,
        email: targetEmail,
        expiresAt: activeOtp.expiresAt,
      });
      res.json({
        ok: true,
        verifiedToken,
        userId: targetUserId,
        username: targetUsername,
        targetEmail,
        message: 'Verification code confirmed. Enter your new password below.',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to verify reset code.',
      });
    }
  };

  router.post('/auth/verify-code', handleVerifyCode);
  router.post('/auth/verify-otp', handleVerifyCode);

  router.post('/auth/reset-password', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        mode?: 'otp' | 'google';
        identifier?: string;
        userId?: string;
        otp?: string;
        otpToken?: string;
        verifiedToken?: string;
        firebaseIdToken?: string;
        newPassword?: string;
        clientCredentialTokens?: unknown;
      };
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (newPassword.length < 6 || newPassword.length > 128) {
        res.status(400).json({
          ok: false,
          error: 'New password must be between 6 and 128 characters.',
        });
        return;
      }

      const pool = buildUserPool(req, body as Record<string, unknown>);
      const verifiedClaim =
        typeof body.verifiedToken === 'string' && body.verifiedToken
          ? verifyVerifiedResetToken(body.verifiedToken)
          : null;
      const signedOtpPayload =
        typeof body.otpToken === 'string' && body.otpToken ? verifyOtpToken(body.otpToken) : null;

      const lookupKey =
        verifiedClaim?.userId ||
        signedOtpPayload?.userId ||
        (typeof body.userId === 'string' && body.userId.trim()) ||
        (typeof body.identifier === 'string' && body.identifier.trim()) ||
        ADMIN_USER_ID;

      const targetUser = findUserInPool(pool, lookupKey);
      if (!targetUser) {
        res.status(404).json({
          ok: false,
          error: 'Target user account could not be resolved for password reset.',
        });
        return;
      }

      if (body.mode === 'google') {
        const token = typeof body.firebaseIdToken === 'string' ? body.firebaseIdToken : '';
        if (!token) {
          res.status(400).json({ ok: false, error: 'Google verification token is required.' });
          return;
        }
        const verified = await verifyGoogleIdTokenForEmail(token, targetUser.email);
        if (!verified.ok) {
          res.status(403).json({ ok: false, error: verified.error || 'Google verification failed.' });
          return;
        }
      } else {
        if (verifiedClaim) {
          if (verifiedClaim.userId !== targetUser.userId) {
            res.status(403).json({
              ok: false,
              error: 'Verification token does not match the selected CRM account.',
            });
            return;
          }
          if (Date.now() > verifiedClaim.expiresAt) {
            res.status(400).json({
              ok: false,
              error: 'Verification session expired. Please request a fresh code.',
            });
            return;
          }
        } else {
          const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
          const storedForUser =
            state.pendingOtps[`reset:${targetUser.userId}`] ||
            (targetUser.role === 'admin' ? state.pendingOtp : null);
          const activeOtp = signedOtpPayload
            ? {
                ...signedOtpPayload,
                attempts:
                  storedForUser && storedForUser.otpHash === signedOtpPayload.otpHash
                    ? storedForUser.attempts
                    : 0,
              }
            : storedForUser;

          if (!activeOtp || (signedOtpPayload?.userId && signedOtpPayload.userId !== targetUser.userId)) {
            res.status(400).json({
              ok: false,
              error: 'No active reset code found. Please request a fresh code first.',
            });
            return;
          }
          if (Date.now() > activeOtp.expiresAt) {
            const nextOtps = { ...state.pendingOtps };
            delete nextOtps[`reset:${targetUser.userId}`];
            state = {
              ...state,
              pendingOtp: targetUser.role === 'admin' ? null : state.pendingOtp,
              pendingOtps: nextOtps,
            };
            saveServerState(state);
            res.status(400).json({
              ok: false,
              error: 'Verification code has expired. Please request a new code.',
            });
            return;
          }
          if (activeOtp.attempts >= 5) {
            const nextOtps = { ...state.pendingOtps };
            delete nextOtps[`reset:${targetUser.userId}`];
            state = {
              ...state,
              pendingOtp: targetUser.role === 'admin' ? null : state.pendingOtp,
              pendingOtps: nextOtps,
            };
            saveServerState(state);
            res.status(429).json({
              ok: false,
              error: 'Too many invalid code attempts. Please request a new reset code.',
            });
            return;
          }
          const matches = verifyHashedSecret(otp, activeOtp.salt, activeOtp.otpHash);
          if (!matches) {
            if (storedForUser) {
              const bumped = { ...storedForUser, attempts: storedForUser.attempts + 1 };
              state = {
                ...state,
                pendingOtp: targetUser.role === 'admin' ? bumped : state.pendingOtp,
                pendingOtps: {
                  ...state.pendingOtps,
                  [`reset:${targetUser.userId}`]: bumped,
                },
              };
              saveServerState(state);
            }
            res.status(400).json({
              ok: false,
              error: 'Invalid 6-digit verification code. Please check your inbox and retry.',
            });
            return;
          }
        }
      }

      const nextHash = hashSecret(newPassword);
      const updatedAt = new Date().toISOString();
      const updatedUser: CrmServerUserRecord = {
        ...targetUser,
        salt: nextHash.salt,
        hash: nextHash.hash,
        updatedAt,
      };

      const nextOtps = { ...state.pendingOtps };
      delete nextOtps[`reset:${targetUser.userId}`];

      state = {
        ...state,
        ...(targetUser.role === 'admin'
          ? {
              passwordRecord: {
                salt: nextHash.salt,
                hash: nextHash.hash,
                updatedAt,
              },
              pendingOtp: null,
            }
          : {}),
        users: {
          ...state.users,
          [updatedUser.userId]: updatedUser,
        },
        pendingOtps: nextOtps,
      };
      saveServerState(state);

      const credentialToken = signUserCredentialToken(updatedUser);
      if (targetUser.role === 'admin') {
        const isHttps =
          req.secure || req.headers['x-forwarded-proto'] === 'https' || IS_VERCEL;
        res.setHeader(
          'Set-Cookie',
          `vansh_crm_pwd=${encodeURIComponent(credentialToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`,
        );
      }

      res.json({
        ok: true,
        username: updatedUser.username,
        user: sanitizeServerUserForClient(updatedUser),
        credentialToken,
        message: 'Password has been reset successfully. You can now log in with your new password.',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to reset password.',
      });
    }
  });

  router.get('/auth/secondary-users', (req: Request, res: Response) => {
    const adminToken =
      typeof req.headers['x-crm-admin-token'] === 'string'
        ? req.headers['x-crm-admin-token'].trim()
        : '';
    if (!adminToken || !verifyAdminSessionToken(adminToken)) {
      res.status(403).json({
        ok: false,
        error: 'Admin session authorization is required to view secondary accounts.',
      });
      return;
    }
    const secondaryUsers = Object.values(state.users || {})
      .filter((u) => u.role === 'secondary')
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map(sanitizeServerUserForClient);

    res.json({
      ok: true,
      users: secondaryUsers,
    });
  });

  router.get('/notifications/email/status', (req: Request, res: Response) => {
    const provider = detectEmailProvider();
    const tenantId =
      typeof req.query.tenantId === 'string' && req.query.tenantId.trim()
        ? req.query.tenantId.trim()
        : ADMIN_USER_ID;
    const isAdminTenant = tenantId === ADMIN_USER_ID;
    const scopedLogs = state.emailLogs.filter((entry) =>
      isAdminTenant ? !entry.tenantId || entry.tenantId === ADMIN_USER_ID : entry.tenantId === tenantId,
    );
    res.json({
      ok: true,
      provider,
      automatedConfigured: provider !== 'none',
      defaultRecipientName: isAdminTenant ? DEFAULT_EMAIL_RECIPIENT_NAME : '',
      defaultRecipientEmail: isAdminTenant ? RECOVERY_EMAIL : '',
      scheduleLabels: ['11:00 AM IST', '4:00 PM IST'],
      logs: scopedLogs,
    });
  });

  router.post('/notifications/email', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        tenantId?: string;
        slotKey?: string;
        tenderRefId?: string;
        tenderId?: string;
        slot?: 'slot_11am' | 'slot_4pm' | 'manual' | 'test';
        recipientName?: string;
        recipientEmail?: string;
        dueDateIso?: string;
        subject?: string;
        message?: string;
        html?: string;
      };

      const tenantId =
        typeof body.tenantId === 'string' && body.tenantId.trim()
          ? body.tenantId.trim()
          : ADMIN_USER_ID;
      const isAdminTenant = tenantId === ADMIN_USER_ID;
      const slot = body.slot || 'slot_11am';
      const tenderId = String(body.tenderId || '').trim();
      const tenderRefId = String(body.tenderRefId || tenderId).trim();
      const recipientName = String(
        body.recipientName || (isAdminTenant ? DEFAULT_EMAIL_RECIPIENT_NAME : 'User'),
      ).trim();
      const recipientEmail = String(
        body.recipientEmail || (isAdminTenant ? RECOVERY_EMAIL : ''),
      ).trim();
      const dueDateIso = String(body.dueDateIso || '').trim();
      const subject = String(body.subject || `NEW TENDER ALERT NOTIFICATION · ${tenderId}`).trim();
      const message = String(body.message || '').trim();
      const html = typeof body.html === 'string' && body.html.trim() ? body.html : undefined;

      if (!tenderId || !message || !isValidEmailAddress(recipientEmail)) {
        res.status(400).json({
          ok: false,
          error: 'Valid tender details, email body content, and recipient email address are required.',
        });
        return;
      }

      const rawSlotKey =
        (typeof body.slotKey === 'string' && body.slotKey.trim()) ||
        `${tenderRefId}__${dueDateIso || 'none'}__${slot}`;
      const slotKey = isAdminTenant ? rawSlotKey : `${tenantId}::${rawSlotKey}`;

      if (slot !== 'test' && slot !== 'manual') {
        const existingLog = state.emailLogs.find((l) => {
          const logTenantMatches = isAdminTenant
            ? !l.tenantId || l.tenantId === ADMIN_USER_ID
            : l.tenantId === tenantId;
          return logTenantMatches && (l.slotKey === slotKey || l.slotKey === rawSlotKey) && l.status === 'sent';
        });
        if (existingLog) {
          res.json({
            ok: true,
            deduplicated: true,
            delivered: true,
            provider: existingLog.provider,
            logEntry: existingLog,
          });
          return;
        }
      }

      const delivery = await sendAppEmail({
        to: recipientEmail,
        subject,
        text: message,
        html,
      });

      const entry: ServerEmailAlertLogEntry = {
        id: `emlog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        tenantId,
        slotKey,
        tenderRefId,
        tenderId,
        slot,
        recipientName,
        recipientEmail,
        dueDateIso,
        status: delivery.sent ? 'sent' : 'failed',
        provider: delivery.provider,
        subject,
        message,
        ...(delivery.error ? { errorDetail: delivery.error } : {}),
        createdAt: new Date().toISOString(),
      };

      state = {
        ...state,
        emailLogs: [entry, ...state.emailLogs].slice(0, 300),
      };
      saveServerState(state);

      res.json({
        ok: true,
        deduplicated: false,
        delivered: delivery.sent,
        provider: delivery.provider,
        ...(delivery.error ? { errorDetail: delivery.error } : {}),
        logEntry: entry,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to dispatch tender reminder email.',
      });
    }
  });

  router.post('/tenders/extract-pdf', async (req: Request, res: Response) => {
    const routeStartedAt = Date.now();
    const TOTAL_ROUTE_BUDGET_MS = 54_000;
    const PRIMARY_ATTEMPT_TIMEOUT_MS = 14_000;
    const FALLBACK_ATTEMPT_TIMEOUT_MS = 20_000;

    try {
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        res.status(503).json({
          ok: false,
          success: false,
          retryable: false,
          error:
            'Gemini API key is not configured on the server. Add GEMINI_API_KEY in AI Studio Secrets or Vercel Environment Variables.',
        });
        return;
      }

      const body = (req.body || {}) as {
        fileName?: unknown;
        mimeType?: unknown;
        fileBase64?: unknown;
      };
      const fileName =
        typeof body.fileName === 'string' && body.fileName.trim()
          ? body.fileName.trim()
          : 'bid-document.pdf';
      const mimeType =
        typeof body.mimeType === 'string' && body.mimeType.trim()
          ? body.mimeType.trim()
          : 'application/pdf';
      const rawBase64 = typeof body.fileBase64 === 'string' ? body.fileBase64.trim() : '';
      const base64Data = rawBase64.replace(/^data:[^;]+;base64,/i, '');

      if (!base64Data) {
        res.status(400).json({
          ok: false,
          success: false,
          retryable: false,
          error: 'No PDF content received. Please upload a valid .pdf file.',
        });
        return;
      }

      if (mimeType !== 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) {
        res.status(400).json({
          ok: false,
          success: false,
          retryable: false,
          error: 'Only PDF (.pdf) bid documents are supported for Bid Search scanning.',
        });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const promptText = [
        'Analyze this Indian GeM / Government tender bid PDF document and extract every field accurately into JSON.',
        'Extraction Rules:',
        '1. tenderId: Exact Bid Number / Document Number (e.g., "GEM/2026/B/8153995").',
        '2. portal: Return "GeM" if this is a Government e-Marketplace (GeM) bid document, otherwise "CPPP / eProcure", "State Portal", "PSU / Direct", or "Private".',
        '3. stage: Always return "Identified / Reviewing".',
        '4. department: Combine Ministry, Department, and Organisation Name cleanly (e.g., "Ministry Of Defence / Department Of Military Affairs (Indian Army)").',
        '5. location: Extract District and State from Consignee / Reporting Officer Address or Pre-Bid Venue (e.g., "Panchkula, Haryana").',
        '6. consigneeAddressRaw: Extract the complete verbatim Consignee / Reporting Officer / Delivery Address, PIN code, town/base, or Pre-Bid Venue from the PDF so District and State can be verified via Google Search.',
        '7. title: Extract BOQ Title or primary scope of supply/work.',
        '8. category: Extract Primary Product Category or main Item Category.',
        '9. publishDate: Extract Bid "Dated" / Published Date strictly in YYYY-MM-DD format.',
        '10. submissionDueDate: Extract "Bid End Date/Time" strictly in 24-hour YYYY-MM-DDTHH:mm format.',
        '11. preBidDate: Extract Pre-Bid Date in YYYY-MM-DD format if available, otherwise "".',
        '12. completionDate: Always return "".',
        '13. estimatedValue: Numeric INR value if Estimated Bid Value is explicitly stated, otherwise 0.',
        '14. quotedValue: Always return 0.',
        '15. emdRequired: Return "Required" if EMD Amount > 0 (or "BG Submitted" if Bank Guarantee / e-PBG is specified), "Exempted - MSME/Startup" if MSE/MSME/Udyam/Startup EMD exemption applies, or "Not Required" if EMD is No/Nil/Not Required.',
        '16. emdAmount: Numeric EMD Amount in INR (e.g., 150000), or 0 if none or MSME exempted.',
        '17. msmeExempt: Boolean true ONLY if the tender document states EMD exemption for MSME/MSE/Udyam/Startup bidders (e.g., "MSE/MSME EMD Exemption: Yes"), otherwise false.',
        '18. resultInfo: Always return "".',
      ].join('\n');

      const extractionSchema = {
        type: Type.OBJECT,
        properties: {
          tenderId: { type: Type.STRING, description: 'Exact Tender ID / Bid Number' },
          portal: { type: Type.STRING, description: 'Portal source such as GeM' },
          stage: { type: Type.STRING, description: 'Always Identified / Reviewing' },
          department: {
            type: Type.STRING,
            description: 'Combined Ministry, Department, and Organisation Name',
          },
          location: {
            type: Type.STRING,
            description: 'District and State from Consignee Address or Pre-Bid Venue',
          },
          consigneeAddressRaw: {
            type: Type.STRING,
            description: 'Complete verbatim Consignee / Delivery Address or PIN code from PDF',
          },
          title: {
            type: Type.STRING,
            description: 'BOQ Title or primary scope of work',
          },
          category: {
            type: Type.STRING,
            description: 'Primary Product Category or main Item Category',
          },
          publishDate: {
            type: Type.STRING,
            description: 'Dated / Published Date in YYYY-MM-DD format',
          },
          submissionDueDate: {
            type: Type.STRING,
            description: 'Bid End Date/Time in YYYY-MM-DDTHH:mm format',
          },
          preBidDate: {
            type: Type.STRING,
            description: 'Pre-Bid Meeting Date in YYYY-MM-DD format or empty string',
          },
          completionDate: {
            type: Type.STRING,
            description: 'Leave blank empty string',
          },
          estimatedValue: {
            type: Type.NUMBER,
            description: 'Estimated Bid Value in INR if explicitly mentioned, else 0',
          },
          quotedValue: {
            type: Type.NUMBER,
            description: 'Leave 0',
          },
          emdRequired: {
            type: Type.STRING,
            description: 'Required, BG Submitted, Exempted - MSME/Startup, or Not Required',
          },
          emdAmount: {
            type: Type.NUMBER,
            description: 'Numeric EMD amount in INR or 0',
          },
          msmeExempt: {
            type: Type.BOOLEAN,
            description: 'True if tender grants EMD exemption for MSME/MSE/Udyam/Startup bidders',
          },
          resultInfo: {
            type: Type.STRING,
            description: 'Leave blank empty string',
          },
        },
        required: [
          'tenderId',
          'portal',
          'stage',
          'department',
          'location',
          'consigneeAddressRaw',
          'title',
          'category',
          'publishDate',
          'submissionDueDate',
          'preBidDate',
          'completionDate',
          'estimatedValue',
          'quotedValue',
          'emdRequired',
          'emdAmount',
          'msmeExempt',
          'resultInfo',
        ],
      };

      const extractionOutcome = await executeWithRetryAndFallback<RawGeminiBidExtraction>({
        primaryModel: PRIMARY_PDF_MODEL,
        fallbackModel: FALLBACK_PDF_MODEL,
        skipPrimaryIfInCooldown: true,
        primaryRetryOptions: {
          maxRetries: 3,
          delaysMs: DEFAULT_RETRY_DELAYS_MS,
          deadlineAtMs: routeStartedAt + 30_000,
          onRetry: ({ attempt, maxRetries, delayMs, error }) => {
            console.warn(
              `[extract-pdf] Primary model ${PRIMARY_PDF_MODEL} busy on "${fileName}" (status=${extractErrorStatus(error) ?? 'unknown'}). Retry ${attempt}/${maxRetries} in ${delayMs}ms.`,
            );
          },
        },
        fallbackRetryOptions: {
          maxRetries: 2,
          delaysMs: [1500, 3000],
          deadlineAtMs: routeStartedAt + TOTAL_ROUTE_BUDGET_MS - 2_000,
          onRetry: ({ attempt, maxRetries, delayMs, error }) => {
            console.warn(
              `[extract-pdf] Fallback model ${FALLBACK_PDF_MODEL} busy on "${fileName}" (status=${extractErrorStatus(error) ?? 'unknown'}). Retry ${attempt}/${maxRetries} in ${delayMs}ms.`,
            );
          },
        },
        onFallback: ({ fromModel, toModel, error }) => {
          console.warn(
            `[extract-pdf] Switching from ${fromModel} to fast fallback model ${toModel} for "${fileName}" (${extractErrorStatus(error) ?? ''} ${extractErrorMessage(error).slice(0, 140)}).`,
          );
        },
        runAttempt: async (model) => {
          const remainingBudgetMs = routeStartedAt + TOTAL_ROUTE_BUDGET_MS - Date.now();
          const capMs =
            model === PRIMARY_PDF_MODEL ? PRIMARY_ATTEMPT_TIMEOUT_MS : FALLBACK_ATTEMPT_TIMEOUT_MS;
          const attemptTimeoutMs = Math.max(4_000, Math.min(capMs, remainingBudgetMs));
          if (remainingBudgetMs <= 1_500) {
            throw new TimeoutError('Server time budget exceeded before completing PDF extraction.');
          }

          const modelResponse = await withTimeout(
            ai.models.generateContent({
              model,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'application/pdf',
                      data: base64Data,
                    },
                  },
                  {
                    text: promptText,
                  },
                ],
              },
              config: {
                abortSignal: AbortSignal.timeout(attemptTimeoutMs),
                systemInstruction:
                  'You are a precision Indian GeM and government tender PDF parser. Extract structured bid details strictly matching the JSON schema without inventing missing financial figures.',
                ...(model === PRIMARY_PDF_MODEL
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : {}),
                responseMimeType: 'application/json',
                responseSchema: extractionSchema,
              },
            }),
            attemptTimeoutMs,
            'Gemini PDF extraction request timed out.',
          );

          const rawText = (modelResponse.text ?? '').trim();
          const parsedJson = extractJsonObjectFromText<RawGeminiBidExtraction>(rawText);
          if (!parsedJson) {
            throw new Error('Gemini returned empty or invalid structured JSON output.');
          }
          return parsedJson;
        },
      });

      const parsed = extractionOutcome.result;
      const addressForSearch =
        typeof parsed.consigneeAddressRaw === 'string' && parsed.consigneeAddressRaw.trim()
          ? parsed.consigneeAddressRaw.trim()
          : typeof parsed.location === 'string'
            ? parsed.location.trim()
            : '';

      const remainingForGeoMs = routeStartedAt + TOTAL_ROUTE_BUDGET_MS - Date.now();
      if (addressForSearch && remainingForGeoMs >= 3_500) {
        try {
          const geoModel = extractionOutcome.fallbackUsed ? FALLBACK_PDF_MODEL : PRIMARY_PDF_MODEL;
          const geoOutcome = await withRetry(
            async () => {
              const geoTimeout = Math.max(2_500, Math.min(5_000, routeStartedAt + TOTAL_ROUTE_BUDGET_MS - Date.now()));
              return await withTimeout(
                ai.models.generateContent({
                  model: geoModel,
                  contents: [
                    'Using Google Search, find the exact Indian administrative District and State for the address below (lookup PIN code, locality, town, cantonment, or organisation campus if district is not explicitly stated).',
                    'Return ONLY "District, State" (for example: "Panchkula, Haryana" or "Lucknow, Uttar Pradesh") with no extra words, street address, or PIN code.',
                    '',
                    `Address from PDF: ${addressForSearch}`,
                    `Department / Organisation: ${typeof parsed.department === 'string' ? parsed.department : ''}`,
                    `Initial Extracted Location: ${typeof parsed.location === 'string' ? parsed.location : ''}`,
                  ].join('\n'),
                  config: {
                    abortSignal: AbortSignal.timeout(geoTimeout),
                    tools: [{ googleSearch: {} }],
                    ...(geoModel === PRIMARY_PDF_MODEL
                      ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                      : {}),
                    systemInstruction:
                      'Output strictly "District, State" for an Indian address. Never include street address, PIN code, office name, bullet points, or explanatory text.',
                  },
                }),
                geoTimeout,
                'Google Search location grounding timed out.',
              );
            },
            {
              maxRetries: remainingForGeoMs >= 9_000 ? 1 : 0,
              delaysMs: [1000],
              deadlineAtMs: routeStartedAt + TOTAL_ROUTE_BUDGET_MS,
            },
          );

          const groundedLocation = sanitizeDistrictStateLocation(geoOutcome.value.text ?? '');
          if (
            groundedLocation &&
            groundedLocation.includes(',') &&
            !/cannot|unable|unknown|sorry|not found/i.test(groundedLocation)
          ) {
            parsed.location = groundedLocation;
          }
        } catch {
          // Non-fatal fallback: keep normalized PDF location if Search Grounding fails or times out
        }
      }

      const extracted = normalizeExtractedBidDraft(parsed, fileName);
      res.status(200).json({
        ok: true,
        success: true,
        modelUsed: extractionOutcome.modelUsed,
        fallbackUsed: extractionOutcome.fallbackUsed,
        extracted,
      });
    } catch (err) {
      const inferredStatus = extractErrorStatus(err);
      const retryable = isRetryableGeminiError(err);
      const isAuthErr = isNonRetryableAuthOrConfigError(err);
      const httpStatus = isAuthErr
        ? 403
        : inferredStatus === 429
          ? 429
          : err instanceof TimeoutError || inferredStatus === 504
            ? 504
            : retryable || inferredStatus === 503 || inferredStatus === 502
              ? 503
              : 500;

      const friendlyError = sanitizeExtractErrorMessage(err, httpStatus);
      console.error('[extract-pdf] Returning clean error JSON:', httpStatus, friendlyError);

      if (!res.headersSent) {
        res.status(httpStatus).json({
          ok: false,
          success: false,
          retryable,
          error: friendlyError,
        });
      }
    }
  });

  function isValidAppsScriptUrl(rawUrl: string): boolean {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed || trimmed.length > 500) return false;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'https:') return false;
      const host = parsed.hostname.toLowerCase();
      if (host === 'script.google.com' || host === 'script.googleusercontent.com') {
        return parsed.pathname.startsWith('/macros/');
      }
      return false;
    } catch {
      return false;
    }
  }

  router.post('/sheet-sync', async (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      webhookUrl?: unknown;
      payload?: unknown;
    };
    const webhookUrl = typeof body.webhookUrl === 'string' ? body.webhookUrl.trim() : '';

    if (!isValidAppsScriptUrl(webhookUrl)) {
      res.status(400).json({
        ok: false,
        error:
          'Invalid Google Apps Script Webhook URL. Expected https://script.google.com/macros/s/.../exec',
      });
      return;
    }

    if (!body.payload || typeof body.payload !== 'object') {
      res.status(400).json({
        ok: false,
        error: 'Missing structured JSON sync payload.',
      });
      return;
    }

    try {
      const upstream = await fetch(webhookUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.payload),
        signal: AbortSignal.timeout(15000),
      });

      const rawText = await upstream.text();
      const trimmed = rawText.trim();
      const lower = trimmed.toLowerCase();
      const looksLikeAuthHtml =
        lower.startsWith('<!doctype') ||
        lower.startsWith('<html') ||
        lower.startsWith('<head') ||
        lower.startsWith('<body') ||
        lower.startsWith('<title') ||
        lower.includes('accounts.google.com') ||
        lower.includes('servicelogin');

      if (looksLikeAuthHtml) {
        res.status(400).json({
          ok: false,
          error:
            'Google Apps Script returned a login or HTML error page instead of JSON. In Apps Script -> Deploy -> Manage deployments, set "Who has access" to "Anyone" and redeploy.',
        });
        return;
      }

      let parsedJson: { ok?: boolean; error?: string; [key: string]: unknown } | null = null;
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          parsedJson = JSON.parse(trimmed) as { ok?: boolean; error?: string };
        } catch {
          parsedJson = null;
        }
      }

      if (!upstream.ok) {
        res.status(502).json({
          ok: false,
          error:
            parsedJson?.error ||
            `Google Apps Script returned HTTP ${upstream.status}: ${trimmed.slice(0, 140) || 'Verify the Web App deployment URL.'}`,
        });
        return;
      }

      if (!parsedJson) {
        res.status(502).json({
          ok: false,
          error: `Google Apps Script returned a non-JSON response: ${trimmed.slice(0, 160) || '(empty body)'}`,
        });
        return;
      }

      if (parsedJson.ok === false) {
        res.status(400).json({
          ok: false,
          error: parsedJson.error || 'Google Apps Script reported an execution error.',
        });
        return;
      }

      res.json({
        ok: true,
        syncedAt: new Date().toISOString(),
        scriptResponse: parsedJson,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to reach Google Apps Script Webhook URL.';
      res.status(502).json({
        ok: false,
        error: message.includes('Timeout')
          ? 'Google Apps Script webhook timed out after 15s.'
          : `Google Sheet webhook failed: ${message}`,
      });
    }
  });

  router.post('/sheet-sync/pull', async (req: Request, res: Response) => {
    const body = (req.body || {}) as { webhookUrl?: unknown };
    const webhookUrl = typeof body.webhookUrl === 'string' ? body.webhookUrl.trim() : '';

    if (!isValidAppsScriptUrl(webhookUrl)) {
      res.status(400).json({
        ok: false,
        error: 'Invalid Google Apps Script Webhook URL.',
      });
      return;
    }

    try {
      const upstream = await fetch(webhookUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      const text = await upstream.text();
      const trimmed = text.trim();
      if (!upstream.ok || !trimmed.startsWith('{')) {
        res.status(502).json({
          ok: false,
          error: `Could not read JSON status from Google Apps Script Web App (${trimmed.slice(0, 120) || upstream.status}).`,
        });
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        res.status(502).json({
          ok: false,
          error: 'Google Apps Script returned malformed JSON status.',
        });
        return;
      }
      res.json({ ok: true, sheetStatus: parsed });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to query Google Sheet status.',
      });
    }
  });

  router.post('/maf/extract-from-attachments', async (req: Request, res: Response) => {
    const routeStartedAt = Date.now();
    const TOTAL_ROUTE_BUDGET_MS = 54_000;
    const PRIMARY_ATTEMPT_TIMEOUT_MS = 14_000;
    const FALLBACK_ATTEMPT_TIMEOUT_MS = 20_000;

    interface IncomingAttachmentInput {
      fileName?: unknown;
      mimeType?: unknown;
      dataUrl?: unknown;
    }

    const parseAttachmentPayload = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return null;
      const obj = raw as IncomingAttachmentInput;
      const fileName = typeof obj.fileName === 'string' ? obj.fileName.trim() : '';
      const rawDataUrl = typeof obj.dataUrl === 'string' ? obj.dataUrl.trim() : '';
      if (!rawDataUrl) return null;
      const match = rawDataUrl.match(/^data:([^;]+);base64,(.+)$/i);
      const mimeType = (
        typeof obj.mimeType === 'string' && obj.mimeType.trim()
          ? obj.mimeType.trim()
          : match?.[1] || 'application/pdf'
      ).toLowerCase();
      const base64Data = (match?.[2] ?? rawDataUrl).replace(/\s+/g, '');
      if (!base64Data) return null;
      return {
        fileName: fileName || 'document.pdf',
        mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType,
        base64Data,
      };
    };

    const GEMINI_INLINE_MIME_TYPES = new Set([
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
    ]);

    const buildGeminiPartsForAttachment = (
      label: string,
      att: { fileName: string; mimeType: string; base64Data: string },
    ): {
      parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>;
      plainText?: string;
    } => {
      if (GEMINI_INLINE_MIME_TYPES.has(att.mimeType)) {
        return {
          parts: [
            { text: `[${label}: ${att.fileName}]` },
            { inlineData: { mimeType: att.mimeType, data: att.base64Data } },
          ],
        };
      }
      const lower = att.fileName.toLowerCase();
      if (
        att.mimeType.startsWith('text/') ||
        att.mimeType === 'application/csv' ||
        lower.endsWith('.txt') ||
        lower.endsWith('.csv')
      ) {
        const decodedText = Buffer.from(att.base64Data, 'base64').toString('utf8').slice(0, 60_000);
        return {
          parts: [{ text: `[${label}: ${att.fileName}]\n${decodedText}` }],
          plainText: decodedText,
        };
      }
      return {
        parts: [
          {
            text: `[${label}: ${att.fileName} (${att.mimeType}) — binary spreadsheet/word format]`,
          },
        ],
      };
    };

    try {
      const body = (req.body || {}) as {
        attachment1?: unknown;
        attachment2?: unknown;
        fallbackDepartment?: unknown;
      };
      const att1 = parseAttachmentPayload(body.attachment1);
      const att2 = parseAttachmentPayload(body.attachment2);
      const fallbackDepartment =
        typeof body.fallbackDepartment === 'string' ? body.fallbackDepartment.trim() : '';

      if (!att1 && !att2) {
        res.status(400).json({
          ok: false,
          success: false,
          error: 'At least Attachment 1 or Attachment 2 content is required.',
        });
        return;
      }

      const built1 = att1
        ? buildGeminiPartsForAttachment('Attachment 1 - Tender Inviting Authority / NIT Document', att1)
        : null;
      const built2 = att2
        ? buildGeminiPartsForAttachment('Attachment 2 - BOQ / Specification Document', att2)
        : null;

      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        const fallbackItems = built2?.plainText ? parsePlainTextSpecItems(built2.plainText) : [];
        if (fallbackItems.length > 0) {
          res.status(200).json({
            ok: true,
            success: true,
            department: fallbackDepartment,
            items: fallbackItems,
            fallbackParserUsed: true,
          });
          return;
        }
        res.status(503).json({
          ok: false,
          success: false,
          retryable: false,
          error:
            'Gemini API key is not configured on the server to extract MAF items from PDF/image attachments.',
        });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        ...(built1?.parts ?? []),
        ...(built2?.parts ?? []),
        {
          text: [
            'Extract Tender Department & Individual Product/Item rows strictly according to these rules:',
            '1. department: Extract the exact Tender Inviting Authority / Department / Organisation Name from Attachment 1 (NIT / Tender Document). If Attachment 1 is absent or has no department, return "".',
            '2. items: Extract EVERY individual required product/equipment/item listed in Attachment 2 (Specification / BOQ Document). If the tender requires 5 distinct products (for example: Item 1, Item 2, Item 3, Item 4, Item 5), return 5 separate objects in the items array—never merge multiple products into one item.',
            '3. For each item object provide: itemName (concise product/equipment name without serial number prefix) and requiredQuantity (e.g. "10 Nos", "5 Sets", or "" if not specified).',
            '4. Do NOT guess or invent OEM names, brand names, emails, phone numbers, or contact persons.',
          ].join('\n'),
        },
      ];

      interface RawMafExtractResult {
        department?: string;
        items?: Array<{ itemName?: string; requiredQuantity?: string }>;
      }

      const mafSchema = {
        type: Type.OBJECT,
        properties: {
          department: {
            type: Type.STRING,
            description: 'Tender Inviting Authority / Department extracted from Attachment 1',
          },
          items: {
            type: Type.ARRAY,
            description: 'Individual required items extracted from Attachment 2',
            items: {
              type: Type.OBJECT,
              properties: {
                itemName: { type: Type.STRING, description: 'Product / equipment name' },
                requiredQuantity: { type: Type.STRING, description: 'Required quantity with unit or empty string' },
              },
              required: ['itemName', 'requiredQuantity'],
            },
          },
        },
        required: ['department', 'items'],
      };

      const outcome = await executeWithRetryAndFallback<RawMafExtractResult>({
        primaryModel: PRIMARY_PDF_MODEL,
        fallbackModel: FALLBACK_PDF_MODEL,
        skipPrimaryIfInCooldown: true,
        primaryRetryOptions: {
          maxRetries: 2,
          delaysMs: DEFAULT_RETRY_DELAYS_MS,
          deadlineAtMs: routeStartedAt + 30_000,
        },
        fallbackRetryOptions: {
          maxRetries: 2,
          delaysMs: [1500, 3000],
          deadlineAtMs: routeStartedAt + TOTAL_ROUTE_BUDGET_MS - 2_000,
        },
        runAttempt: async (model) => {
          const remainingBudgetMs = routeStartedAt + TOTAL_ROUTE_BUDGET_MS - Date.now();
          const capMs =
            model === PRIMARY_PDF_MODEL ? PRIMARY_ATTEMPT_TIMEOUT_MS : FALLBACK_ATTEMPT_TIMEOUT_MS;
          const attemptTimeoutMs = Math.max(4_000, Math.min(capMs, remainingBudgetMs));
          if (remainingBudgetMs <= 1_500) {
            throw new TimeoutError('Server time budget exceeded during MAF attachment extraction.');
          }

          const modelResponse = await withTimeout(
            ai.models.generateContent({
              model,
              contents: { parts },
              config: {
                abortSignal: AbortSignal.timeout(attemptTimeoutMs),
                systemInstruction:
                  'You are a tender specification parser. Extract the inviting department from Attachment 1 and every individual item from Attachment 2 as clean JSON.',
                ...(model === PRIMARY_PDF_MODEL
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : {}),
                responseMimeType: 'application/json',
                responseSchema: mafSchema,
              },
            }),
            attemptTimeoutMs,
            'Gemini MAF attachment extraction timed out.',
          );

          const rawText = (modelResponse.text ?? '').trim();
          const parsedJson = extractJsonObjectFromText<RawMafExtractResult>(rawText);
          if (!parsedJson) {
            throw new Error('Gemini returned empty or invalid structured JSON for MAF items.');
          }
          return parsedJson;
        },
      });

      const extractedDepartment =
        (typeof outcome.result.department === 'string' ? outcome.result.department.trim() : '') ||
        fallbackDepartment;

      const geminiItems = Array.isArray(outcome.result.items)
        ? outcome.result.items
            .map((it) => ({
              itemName: typeof it?.itemName === 'string' ? it.itemName.trim().slice(0, 220) : '',
              requiredQuantity:
                typeof it?.requiredQuantity === 'string'
                  ? it.requiredQuantity.trim().slice(0, 60)
                  : '',
            }))
            .filter((it) => it.itemName.length > 0)
            .slice(0, 50)
        : [];

      const items =
        geminiItems.length > 0
          ? geminiItems
          : built2?.plainText
            ? parsePlainTextSpecItems(built2.plainText)
            : [];

      res.status(200).json({
        ok: true,
        success: true,
        modelUsed: outcome.modelUsed,
        fallbackUsed: outcome.fallbackUsed,
        department: extractedDepartment,
        items,
      });
    } catch (err) {
      const inferredStatus = extractErrorStatus(err);
      const retryable = isRetryableGeminiError(err);
      const isAuthErr = isNonRetryableAuthOrConfigError(err);
      const httpStatus = isAuthErr
        ? 403
        : inferredStatus === 429
          ? 429
          : err instanceof TimeoutError || inferredStatus === 504
            ? 504
            : retryable || inferredStatus === 503 || inferredStatus === 502
              ? 503
              : 500;

      const friendlyError = sanitizeExtractErrorMessage(err, httpStatus);
      console.error('[maf/extract-from-attachments] Returning error JSON:', httpStatus, friendlyError);
      if (!res.headersSent) {
        res.status(httpStatus).json({
          ok: false,
          success: false,
          retryable,
          error: friendlyError,
        });
      }
    }
  });

  return router;
}

export function apiJsonErrorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCandidate = extractErrorStatus(err);
  const status =
    statusCandidate && statusCandidate >= 400 && statusCandidate <= 599
      ? statusCandidate
      : (err as { type?: string } | null)?.type === 'entity.too.large'
        ? 413
        : (err as { type?: string } | null)?.type === 'entity.parse.failed'
          ? 400
          : 500;

  if (!res.headersSent) {
    res.status(status).json({
      ok: false,
      success: false,
      retryable: status === 503 || status === 429 || status === 504,
      error: sanitizeExtractErrorMessage(err, status),
    });
  }
}


