import crypto from 'node:crypto';
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
import {
  authenticateSessionToken,
  bootstrapEnvAdminIfConfigured,
  computeServerPresenceStatus,
  currentMonthKey,
  extractBearerTokenFromRequest,
  hashOtpSecret,
  hashPasswordBcrypt,
  hasServerPermission,
  IS_VERCEL,
  isValidAppsScriptUrl,
  isWorkspaceAdminRole,
  loadServerState,
  normalizeServerRole,
  PLAN_QUOTAS,
  safeFetchAppsScript,
  sanitizeServerUserForClient,
  saveServerState,
  signSessionToken,
  signSignedToken,
  slugifyCompanyId,
  slugifyUserId,
  verifyFirebaseIdToken,
  verifyOtpSecret,
  verifySignedToken,
  verifyUserPassword,
  type CompanyInviteRecord,
  type CompanyPlanTier,
  type CompanyServerRecord,
  type CrmServerUserRecord,
  type PendingOtpRecord,
  type ServerEmailAlertLogEntry,
  type ServerPermission,
  type SessionTokenPayload,
  type TeamRole,
} from './server-auth.ts';

export type { ServerEmailAlertLogEntry };

interface ResetOtpTokenPayload {
  kind?: string;
  userId: string;
  username: string;
  email: string;
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
    parsed.kind === 'reset_otp' &&
    typeof parsed.userId === 'string' &&
    typeof parsed.username === 'string' &&
    typeof parsed.email === 'string' &&
    typeof parsed.otpHash === 'string' &&
    typeof parsed.expiresAt === 'number'
  ) {
    return {
      kind: 'reset_otp',
      userId: parsed.userId,
      username: parsed.username,
      email: parsed.email,
      otpHash: parsed.otpHash,
      expiresAt: parsed.expiresAt,
    };
  }
  return null;
}

function signSignupOtpToken(payload: {
  email: string;
  otpHash: string;
  expiresAt: number;
}): string {
  return signSignedToken({ kind: 'signup_otp', ...payload });
}

function verifySignupOtpToken(token: string): {
  email: string;
  otpHash: string;
  expiresAt: number;
} | null {
  const parsed = verifySignedToken<{
    kind?: string;
    email?: string;
    otpHash?: string;
    expiresAt?: number;
  }>(token);
  if (
    parsed &&
    parsed.kind === 'signup_otp' &&
    typeof parsed.email === 'string' &&
    typeof parsed.otpHash === 'string' &&
    typeof parsed.expiresAt === 'number'
  ) {
    return {
      email: parsed.email.toLowerCase(),
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
    typeof parsed.userId === 'string' &&
    typeof parsed.username === 'string' &&
    typeof parsed.email === 'string' &&
    typeof parsed.expiresAt === 'number'
  ) {
    return {
      userId: parsed.userId,
      username: parsed.username,
      email: parsed.email,
      expiresAt: parsed.expiresAt,
    };
  }
  return null;
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

function isValidEmailAddress(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim());
}

function detectEmailProvider(): 'resend' | 'smtp' | 'none' {
  if (process.env.RESEND_API_KEY?.trim()) return 'resend';
  if (process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()) return 'smtp';
  return 'none';
}

const DEFAULT_MAIL_FROM = 'no-reply@vanshtender.in';

function resolveMailFromHeader(): string {
  const rawFrom =
    process.env.MAIL_FROM?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    DEFAULT_MAIL_FROM;
  if (!rawFrom) {
    return `Vansh Tender Software <${DEFAULT_MAIL_FROM}>`;
  }
  return rawFrom.includes('<') ? rawFrom : `Vansh Tender Software <${rawFrom}>`;
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
      const fromHeader = resolveMailFromHeader();
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY?.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromHeader,
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
  const subject = 'Vansh Tender Software — Email Verification Code';
  const textBody = [
    'Hello,',
    '',
    'Use the 6-digit verification code below to verify your email and create your CRM workspace account:',
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
      <p style="margin:0 0 16px;font-size:14px;color:#475569;">Email Verification for <strong>${targetEmail}</strong></p>
      <div style="padding:16px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;text-align:center;margin-bottom:16px;">
        <p style="margin:0 0 6px;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:1px;">Sign-Up OTP Code</p>
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:6px;color:#0B1E47;font-family:monospace;">${otpCode}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#475569;">Enter this code in the CRM sign-up form to set up your account. Expires in <strong>15 minutes</strong>.</p>
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
  const textBody = [
    `Hello ${target.username},`,
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

export function createApiRouter(): Router {
  const router = express.Router();
  let state = bootstrapEnvAdminIfConfigured(loadServerState());
  const rateBuckets = new Map<string, number[]>();

  function hasAnyWorkspaceAdmin(): boolean {
    return Object.values(state.users).some((u) => isWorkspaceAdminRole(u.role));
  }

  function checkRateLimit(
    req: Request,
    bucketKey: string,
    maxRequests = 15,
    windowMs = 60_000,
  ): boolean {
    const ip =
      (typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0]?.trim()
        : '') ||
      req.ip ||
      req.socket?.remoteAddress ||
      'local';
    const key = `${bucketKey}:${ip}`;
    const now = Date.now();
    const recent = (rateBuckets.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      rateBuckets.set(key, recent);
      return false;
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    if (rateBuckets.size > 500) {
      for (const [k, list] of rateBuckets.entries()) {
        if (list.every((ts) => now - ts >= windowMs)) {
          rateBuckets.delete(k);
        }
      }
    }
    return true;
  }

  function findUserInState(identifier: string, companyId?: string): CrmServerUserRecord | null {
    const trimmed = identifier.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    let best: CrmServerUserRecord | null = null;
    for (const user of Object.values(state.users)) {
      if (companyId && user.companyId !== companyId) continue;
      if (
        user.userId.toLowerCase() === lower ||
        user.username.toLowerCase() === lower ||
        user.email.toLowerCase() === lower
      ) {
        if (
          !best ||
          (user.updatedAt || '') > (best.updatedAt || '') ||
          ((user.updatedAt || '') === (best.updatedAt || '') && user.userId === trimmed)
        ) {
          best = user;
        }
      }
    }
    return best;
  }

  function getCompanySummary(companyId: string): CompanyServerRecord | null {
    const comp = state.companies[companyId];
    if (!comp) return null;
    const monthKey = currentMonthKey();
    const usage =
      comp.usage?.monthKey === monthKey
        ? comp.usage
        : { monthKey, aiScansUsed: 0 };
    return { ...comp, usage };
  }

  function ensureAiQuotaAvailable(companyId: string, res: Response): boolean {
    const comp = getCompanySummary(companyId);
    if (!comp) return true;
    const limit = PLAN_QUOTAS[comp.plan || 'starter'].maxAiScansPerMonth;
    if (comp.usage.aiScansUsed >= limit) {
      res.status(429).json({
        ok: false,
        success: false,
        retryable: false,
        code: 'PLAN_QUOTA_EXCEEDED',
        error: `Monthly AI scan quota (${limit}) reached for ${PLAN_QUOTAS[comp.plan].label} plan. Upgrade your plan in Company & Plan Settings to continue.`,
      });
      return false;
    }
    return true;
  }

  function checkAndIncrementAiQuota(
    companyId: string,
    res: Response,
  ): { allowed: boolean } {
    if (!ensureAiQuotaAvailable(companyId, res)) {
      return { allowed: false };
    }
    const comp = getCompanySummary(companyId);
    if (!comp) return { allowed: true };
    const nextUsage = {
      monthKey: comp.usage.monthKey,
      aiScansUsed: comp.usage.aiScansUsed + 1,
    };
    state = {
      ...state,
      companies: {
        ...state.companies,
        [companyId]: {
          ...comp,
          usage: nextUsage,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    saveServerState(state);
    return { allowed: true };
  }

  function requireAuth(
    req: Request,
    res: Response,
    bodyToken?: unknown,
  ): SessionTokenPayload | null {
    const token = extractBearerTokenFromRequest(req, bodyToken);
    if (!token) {
      res.status(401).json({
        ok: false,
        error: 'Authentication required. Please sign in to continue.',
      });
      return null;
    }
    const session = authenticateSessionToken(token, state);
    if (!session) {
      res.status(401).json({
        ok: false,
        error: 'Session expired, invalid, or revoked. Please sign in again.',
      });
      return null;
    }
    return session;
  }

  function requirePermission(
    caller: SessionTokenPayload,
    permission: ServerPermission,
    res: Response,
  ): boolean {
    if (!hasServerPermission(caller.role, permission)) {
      res.status(403).json({
        ok: false,
        error: `Insufficient permissions (${caller.role}) for action "${permission}".`,
      });
      return false;
    }
    return true;
  }

  function listCompanyTeamUsers(companyId: string) {
    return Object.values(state.users)
      .filter((u) => u.companyId === companyId)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .map((u) => sanitizeServerUserForClient(u, state.companies[companyId]?.companyName));
  }

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      emailProvider: detectEmailProvider(),
      needsSetup: !hasAnyWorkspaceAdmin(),
      runtime: IS_VERCEL ? 'vercel-serverless' : 'node-express',
    });
  });

  router.get('/auth/bootstrap-status', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      needsSetup: !hasAnyWorkspaceAdmin(),
    });
  });

  router.post('/auth/setup-admin', async (req: Request, res: Response) => {
    try {
      if (!checkRateLimit(req, 'setup-admin', 10, 60_000)) {
        res.status(429).json({ ok: false, error: 'Too many setup attempts. Please wait a minute.' });
        return;
      }
      if (hasAnyWorkspaceAdmin()) {
        res.status(409).json({
          ok: false,
          error: 'Initial workspace owner is already registered. Please log in or create a new company workspace.',
        });
        return;
      }

      const body = (req.body || {}) as {
        companyName?: unknown;
        username?: unknown;
        email?: unknown;
        password?: unknown;
        gstin?: unknown;
        udyamNumber?: unknown;
      };
      const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : '';
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const gstin = typeof body.gstin === 'string' ? body.gstin.trim().toUpperCase() : '';
      const udyamNumber = typeof body.udyamNumber === 'string' ? body.udyamNumber.trim().toUpperCase() : '';

      if (companyName.length < 2 || companyName.length > 120) {
        res.status(400).json({ ok: false, error: 'Company / Firm Name must be 2 to 120 characters.' });
        return;
      }
      if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
        res.status(400).json({
          ok: false,
          error: 'User ID must be 3 to 40 characters (letters, numbers, "_", ".", or "-").',
        });
        return;
      }
      if (!email || !isValidEmailAddress(email)) {
        res.status(400).json({ ok: false, error: 'A valid business Email ID is required.' });
        return;
      }
      if (password.length < 8 || password.length > 128) {
        res.status(400).json({ ok: false, error: 'Password must be 8 to 128 characters.' });
        return;
      }

      const nowIso = new Date().toISOString();
      const companyId = slugifyCompanyId(companyName);
      const userId = slugifyUserId('own', username);
      const passwordHash = await hashPasswordBcrypt(password);

      const company: CompanyServerRecord = {
        companyId,
        companyName,
        ...(gstin ? { gstin } : {}),
        ...(udyamNumber ? { udyamNumber } : {}),
        plan: 'professional',
        ownerUserId: userId,
        createdAt: nowIso,
        updatedAt: nowIso,
        usage: { monthKey: currentMonthKey(), aiScansUsed: 0 },
      };

      const ownerUser: CrmServerUserRecord = {
        userId,
        username,
        email,
        role: 'owner',
        companyId,
        companyName,
        passwordHash,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastLoginAt: nowIso,
        isActive: true,
        isEnabled: true,
        presenceStatus: 'active',
        lastHeartbeatAt: nowIso,
      };

      state = {
        ...state,
        companies: { ...state.companies, [companyId]: company },
        users: { ...state.users, [userId]: ownerUser },
      };
      saveServerState(state);

      const sessionToken = signSessionToken(ownerUser, companyName);
      res.status(201).json({
        ok: true,
        sessionToken,
        user: sanitizeServerUserForClient(ownerUser, companyName),
        company: getCompanySummary(companyId),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to register initial workspace.',
      });
    }
  });

  router.post('/auth/firebase-exchange', async (req: Request, res: Response) => {
    try {
      if (!checkRateLimit(req, 'firebase-exchange', 20, 60_000)) {
        res.status(429).json({ ok: false, error: 'Too many authentication requests.' });
        return;
      }
      const body = (req.body || {}) as {
        firebaseIdToken?: unknown;
        companyName?: unknown;
        inviteCode?: unknown;
      };
      const idToken = typeof body.firebaseIdToken === 'string' ? body.firebaseIdToken.trim() : '';
      if (!idToken) {
        res.status(400).json({ ok: false, error: 'Firebase ID token is required.' });
        return;
      }
      const verified = await verifyFirebaseIdToken(idToken);
      if (!verified.ok || !verified.email) {
        res.status(401).json({ ok: false, error: verified.error || 'Invalid Google/Firebase token.' });
        return;
      }

      const email = verified.email.toLowerCase();
      const nowIso = new Date().toISOString();
      let matched = findUserInState(email);

      if (matched) {
        const enabled =
          matched.isEnabled !== undefined ? matched.isEnabled !== false : matched.isActive !== false;
        if (!enabled) {
          res.status(403).json({
            ok: false,
            code: 'ACCOUNT_DISABLED',
            error: 'This CRM workspace account has been disabled by your company administrator.',
          });
          return;
        }
        matched = {
          ...matched,
          lastLoginAt: nowIso,
          isActive: true,
          presenceStatus: 'active',
          lastHeartbeatAt: nowIso,
          updatedAt: nowIso,
        };
        state = { ...state, users: { ...state.users, [matched.userId]: matched } };
        saveServerState(state);
        const company = getCompanySummary(matched.companyId);
        const sessionToken = signSessionToken(matched, company?.companyName || matched.companyName || 'Workspace');
        res.json({
          ok: true,
          sessionToken,
          user: sanitizeServerUserForClient(matched, company?.companyName),
          company,
        });
        return;
      }

      const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '';
      const requestedCompanyName =
        typeof body.companyName === 'string' ? body.companyName.trim() : '';

      let targetCompanyId = '';
      let targetCompanyName = '';
      let assignedRole: TeamRole = 'owner';

      if (inviteCode) {
        const invite = state.invites[inviteCode];
        if (!invite || invite.usedAt || Date.now() > invite.expiresAt) {
          res.status(403).json({ ok: false, error: 'Invite code is invalid or expired.' });
          return;
        }
        if (invite.email && invite.email.toLowerCase() !== email) {
          res.status(403).json({
            ok: false,
            error: `Invite code is issued exclusively for ${invite.email}.`,
          });
          return;
        }
        targetCompanyId = invite.companyId;
        targetCompanyName = invite.companyName;
        assignedRole = invite.role;
      } else {
        targetCompanyName =
          requestedCompanyName || `${verified.displayName || email.split('@')[0]}'s Workspace`;
        targetCompanyId = slugifyCompanyId(targetCompanyName);
        assignedRole = 'owner';
      }

      const baseSlug = (verified.displayName || email.split('@')[0] || 'member')
        .replace(/[^a-zA-Z0-9_.-]+/g, '')
        .slice(0, 32);
      const userId = slugifyUserId('usr', baseSlug || 'member');
      const newUser: CrmServerUserRecord = {
        userId,
        username: baseSlug || email.split('@')[0],
        email,
        role: assignedRole,
        companyId: targetCompanyId,
        companyName: targetCompanyName,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastLoginAt: nowIso,
        isActive: true,
        isEnabled: true,
        presenceStatus: 'active',
        lastHeartbeatAt: nowIso,
      };

      const nextCompanies = { ...state.companies };
      if (!nextCompanies[targetCompanyId]) {
        nextCompanies[targetCompanyId] = {
          companyId: targetCompanyId,
          companyName: targetCompanyName,
          plan: 'starter',
          ownerUserId: userId,
          createdAt: nowIso,
          updatedAt: nowIso,
          usage: { monthKey: currentMonthKey(), aiScansUsed: 0 },
        };
      }
      const nextInvites = { ...state.invites };
      if (inviteCode && nextInvites[inviteCode]) {
        nextInvites[inviteCode] = {
          ...nextInvites[inviteCode],
          usedAt: nowIso,
          usedByUserId: userId,
        };
      }

      state = {
        ...state,
        companies: nextCompanies,
        invites: nextInvites,
        users: { ...state.users, [userId]: newUser },
      };
      saveServerState(state);

      const sessionToken = signSessionToken(newUser, targetCompanyName);
      res.json({
        ok: true,
        sessionToken,
        user: sanitizeServerUserForClient(newUser, targetCompanyName),
        company: getCompanySummary(targetCompanyId),
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to exchange Firebase session.',
      });
    }
  });

  router.post('/auth/login', async (req: Request, res: Response) => {
    try {
      if (!checkRateLimit(req, 'login', 20, 60_000)) {
        res.status(429).json({
          ok: false,
          error: 'Too many login attempts. Please wait a minute and try again.',
        });
        return;
      }
      const body = (req.body || {}) as {
        username?: unknown;
        identifier?: unknown;
        password?: unknown;
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

      const matched = findUserInState(identifier);
      const isEmailInput = identifier.includes('@');
      const usernameMatches =
        matched &&
        (isEmailInput ||
          identifier.toLowerCase() === matched.username.toLowerCase() ||
          identifier === matched.userId);

      if (!matched || !usernameMatches) {
        res.status(401).json({
          ok: false,
          code: 'INVALID_CREDENTIALS',
          error: 'Invalid User ID or password. Please check your credentials and try again.',
        });
        return;
      }

      const pwResult = await verifyUserPassword(password, matched);
      if (!pwResult.valid) {
        res.status(401).json({
          ok: false,
          code: 'INVALID_CREDENTIALS',
          error: 'Invalid User ID or password. Please check your credentials and try again.',
        });
        return;
      }

      const accountEnabled =
        matched.isEnabled !== undefined ? matched.isEnabled !== false : matched.isActive !== false;
      if (!accountEnabled && normalizeServerRole(matched.role) !== 'owner') {
        res.status(403).json({
          ok: false,
          code: 'ACCOUNT_DISABLED',
          error:
            'Your CRM ID has been disabled by your Company Administrator. Please contact your administrator to regain access.',
        });
        return;
      }

      const nowIso = new Date().toISOString();
      const updatedPasswordHash = pwResult.needsRehash
        ? await hashPasswordBcrypt(password)
        : matched.passwordHash;
      const updatedUser: CrmServerUserRecord = {
        ...matched,
        role: normalizeServerRole(matched.role),
        passwordHash: updatedPasswordHash,
        salt: undefined,
        hash: undefined,
        lastLoginAt: nowIso,
        isActive: true,
        isEnabled: true,
        presenceStatus: 'active',
        lastHeartbeatAt: nowIso,
        updatedAt: nowIso,
      };

      state = {
        ...state,
        users: {
          ...state.users,
          [updatedUser.userId]: updatedUser,
        },
      };
      saveServerState(state);

      const company = getCompanySummary(updatedUser.companyId);
      const companyName = company?.companyName || updatedUser.companyName || 'Workspace';
      const sessionToken = signSessionToken(updatedUser, companyName);

      res.json({
        ok: true,
        username: updatedUser.username,
        sessionToken,
        user: sanitizeServerUserForClient(updatedUser, companyName),
        company,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to sign in.',
      });
    }
  });

  router.post('/auth/presence/heartbeat', (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      userId?: unknown;
      byocProjectId?: unknown;
      byocConfig?: unknown;
    };
    const caller = requireAuth(req, res);
    if (!caller) return;

    const requestedId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (requestedId && requestedId !== caller.userId) {
      res.status(403).json({ ok: false, error: 'Cannot send heartbeat for another user.' });
      return;
    }

    const matched = state.users[caller.userId];
    if (!matched) {
      res.status(404).json({ ok: false, error: 'User session not found.' });
      return;
    }

    const isEnabled =
      matched.isEnabled !== undefined ? matched.isEnabled !== false : matched.isActive !== false;
    if (!isEnabled && normalizeServerRole(matched.role) !== 'owner') {
      res.status(403).json({
        ok: false,
        code: 'ACCOUNT_DISABLED',
        disabled: true,
        error: 'Your CRM ID has been disabled by your Company Administrator. Session terminated.',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const nextByocProject =
      typeof body.byocProjectId === 'string' ? body.byocProjectId.trim() : matched.byocProjectId;
    const nextByocConfig =
      body.byocConfig && typeof body.byocConfig === 'object'
        ? (body.byocConfig as Record<string, unknown>)
        : matched.byocConfig;

    const updatedUser: CrmServerUserRecord = {
      ...matched,
      isActive: true,
      isEnabled: true,
      presenceStatus: 'active',
      lastHeartbeatAt: nowIso,
      updatedAt: nowIso,
      byocProjectId: nextByocProject,
      byocConfig: nextByocConfig,
    };

    state = {
      ...state,
      users: {
        ...state.users,
        [updatedUser.userId]: updatedUser,
      },
    };
    saveServerState(state);

    const company = getCompanySummary(updatedUser.companyId);
    res.json({
      ok: true,
      user: sanitizeServerUserForClient(updatedUser, company?.companyName),
      company,
      presenceStatus: 'active',
      isEnabled: true,
      lastHeartbeatAt: nowIso,
    });
  });

  router.post(
    '/auth/logout',
    express.text({ type: 'text/plain', limit: '64kb' }),
    (req: Request, res: Response) => {
      let body: Record<string, unknown> = {};
      if (typeof req.body === 'string' && req.body.trim()) {
        try {
          body = JSON.parse(req.body) as Record<string, unknown>;
        } catch {
          body = {};
        }
      } else if (req.body && typeof req.body === 'object') {
        body = req.body as Record<string, unknown>;
      }

      const token = extractBearerTokenFromRequest(req, body.beaconToken);
      const session = token ? authenticateSessionToken(token, state) : null;
      if (!session) {
        res.status(401).json({ ok: false, error: 'Valid session token is required to log out.' });
        return;
      }

      const nextRevoked = { ...state.revokedSessions, [session.sid]: session.exp };
      const matched = state.users[session.userId];
      const nowIso = new Date().toISOString();
      const nextUsers = { ...state.users };
      if (matched) {
        nextUsers[matched.userId] = {
          ...matched,
          presenceStatus: 'not_active',
          isActive: false,
          lastLogoutAt: nowIso,
          updatedAt: nowIso,
        };
      }
      state = {
        ...state,
        revokedSessions: nextRevoked,
        users: nextUsers,
      };
      saveServerState(state);

      res.json({ ok: true, presenceStatus: 'not_active' });
    },
  );

  router.post('/auth/signup/send-otp', async (req: Request, res: Response) => {
    try {
      if (!checkRateLimit(req, 'signup-otp', 10, 60_000)) {
        res.status(429).json({
          ok: false,
          error: 'Too many OTP requests. Please wait a minute before requesting another code.',
        });
        return;
      }
      const body = (req.body || {}) as { email?: unknown };
      const targetEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

      if (!targetEmail || !isValidEmailAddress(targetEmail)) {
        res.status(400).json({
          ok: false,
          error: 'Please enter a valid Email address to receive your verification OTP.',
        });
        return;
      }

      const existingByEmail = findUserInState(targetEmail);
      if (existingByEmail) {
        res.status(409).json({
          ok: false,
          error: 'An account is already registered with this email address. Please sign in or use Forgot Password.',
        });
        return;
      }

      const otpCode = String(crypto.randomInt(100000, 1000000));
      const otpHash = hashOtpSecret(otpCode);
      const expiresAt = Date.now() + 15 * 60 * 1000;
      const otpToken = signSignupOtpToken({
        email: targetEmail,
        otpHash,
        expiresAt,
      });

      state = {
        ...state,
        pendingOtps: {
          ...state.pendingOtps,
          [`signup:${targetEmail}`]: {
            purpose: 'signup',
            email: targetEmail,
            otpHash,
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
            'Email gateway (SMTP_USER/SMTP_PASS or RESEND_API_KEY) is not configured on the server to send email verification OTPs.',
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
      if (!checkRateLimit(req, 'signup-verify', 15, 60_000)) {
        res.status(429).json({ ok: false, error: 'Too many OTP verification attempts.' });
        return;
      }
      const body = (req.body || {}) as {
        email?: unknown;
        otp?: unknown;
        otpToken?: unknown;
      };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const otp = typeof body.otp === 'string' ? body.otp.trim() : '';

      if (!email || !isValidEmailAddress(email)) {
        res.status(400).json({ ok: false, error: 'Valid email address is required.' });
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
          error: 'OTP token does not match the entered email address. Please request a fresh OTP.',
        });
        return;
      }

      const stored = state.pendingOtps[`signup:${email}`] || null;
      const activeOtp = signed
        ? {
            ...signed,
            attempts: stored && stored.otpHash === signed.otpHash ? stored.attempts : 0,
            salt: undefined,
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

      if (!verifyOtpSecret(otp, activeOtp.otpHash, activeOtp.salt)) {
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
          error: 'Invalid 6-digit verification OTP. Please check your inbox and try again.',
        });
        return;
      }

      const verifiedToken = signSignupVerifiedToken(email, Date.now() + 20 * 60 * 1000);
      res.json({
        ok: true,
        email,
        verifiedToken,
        message: 'Email verified successfully! Choose your User ID and Password.',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to verify sign-up OTP.',
      });
    }
  });

  router.post('/auth/signup/complete', async (req: Request, res: Response) => {
    try {
      if (!checkRateLimit(req, 'signup-complete', 15, 60_000)) {
        res.status(429).json({ ok: false, error: 'Too many signup attempts.' });
        return;
      }
      const body = (req.body || {}) as {
        email?: unknown;
        username?: unknown;
        password?: unknown;
        companyName?: unknown;
        inviteCode?: unknown;
        verifiedToken?: unknown;
      };
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const companyNameInput = typeof body.companyName === 'string' ? body.companyName.trim() : '';
      const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '';
      const verifiedToken =
        typeof body.verifiedToken === 'string' ? body.verifiedToken.trim() : '';

      if (!email || !isValidEmailAddress(email)) {
        res.status(400).json({ ok: false, error: 'A verified email address is required.' });
        return;
      }

      const verifiedClaim = verifiedToken ? verifySignupVerifiedToken(verifiedToken) : null;
      if (!verifiedClaim || verifiedClaim.email !== email || Date.now() > verifiedClaim.expiresAt) {
        res.status(403).json({
          ok: false,
          error: 'Email OTP verification is missing or expired. Please verify your OTP again.',
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
      if (password.length < 8 || password.length > 128) {
        res.status(400).json({
          ok: false,
          error: 'Password must be between 8 and 128 characters.',
        });
        return;
      }

      if (findUserInState(username)) {
        res.status(409).json({
          ok: false,
          error: `User ID "${username}" is already taken. Please choose another User ID.`,
        });
        return;
      }
      if (findUserInState(email)) {
        res.status(409).json({
          ok: false,
          error: `Email "${email}" is already linked to an existing account.`,
        });
        return;
      }

      const nowIso = new Date().toISOString();
      let companyId = '';
      let companyName = '';
      let role: TeamRole = 'owner';

      if (inviteCode) {
        const invite = state.invites[inviteCode];
        if (!invite || invite.usedAt || Date.now() > invite.expiresAt) {
          res.status(403).json({ ok: false, error: 'Team invite code is invalid or expired.' });
          return;
        }
        if (invite.email && invite.email.toLowerCase() !== email) {
          res.status(403).json({
            ok: false,
            error: `This invite code belongs exclusively to ${invite.email}.`,
          });
          return;
        }
        companyId = invite.companyId;
        companyName = invite.companyName;
        role = normalizeServerRole(invite.role);
      } else {
        companyName = companyNameInput || `${username}'s Tender Desk`;
        companyId = slugifyCompanyId(companyName);
        role = 'owner';
      }

      const userId = slugifyUserId(role === 'owner' ? 'own' : 'usr', username);
      const passwordHash = await hashPasswordBcrypt(password);

      const newUser: CrmServerUserRecord = {
        userId,
        username,
        email,
        role,
        companyId,
        companyName,
        passwordHash,
        createdAt: nowIso,
        updatedAt: nowIso,
        isActive: true,
        isEnabled: true,
        presenceStatus: 'not_active',
      };

      const nextCompanies = { ...state.companies };
      if (!nextCompanies[companyId]) {
        nextCompanies[companyId] = {
          companyId,
          companyName,
          plan: 'starter',
          ownerUserId: userId,
          createdAt: nowIso,
          updatedAt: nowIso,
          usage: { monthKey: currentMonthKey(), aiScansUsed: 0 },
        };
      }
      const nextInvites = { ...state.invites };
      if (inviteCode && nextInvites[inviteCode]) {
        nextInvites[inviteCode] = {
          ...nextInvites[inviteCode],
          usedAt: nowIso,
          usedByUserId: userId,
        };
      }

      const nextOtps = { ...state.pendingOtps };
      delete nextOtps[`signup:${email}`];

      state = {
        ...state,
        companies: nextCompanies,
        invites: nextInvites,
        users: {
          ...state.users,
          [newUser.userId]: newUser,
        },
        pendingOtps: nextOtps,
      };
      saveServerState(state);

      res.status(201).json({
        ok: true,
        user: sanitizeServerUserForClient(newUser, companyName),
        company: getCompanySummary(companyId),
        message: 'Successful Account Creation! Redirecting to the Login screen.',
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
      if (!checkRateLimit(req, 'forgot-otp', 10, 60_000)) {
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
      };
      const rawIdentifier =
        (typeof body.identifier === 'string' && body.identifier.trim()) ||
        (typeof body.username === 'string' && body.username.trim()) ||
        (typeof body.targetEmail === 'string' && body.targetEmail.trim()) ||
        '';

      if (!rawIdentifier) {
        res.status(400).json({
          ok: false,
          error: 'Please enter your User ID or registered email address.',
        });
        return;
      }

      const targetUser = findUserInState(rawIdentifier);
      if (!targetUser) {
        res.status(404).json({
          ok: false,
          error: `No CRM account found matching "${rawIdentifier}". Enter your exact User ID or registered email address.`,
        });
        return;
      }

      const otpCode = String(crypto.randomInt(100000, 1000000));
      const otpHash = hashOtpSecret(otpCode);
      const expiresAt = Date.now() + 15 * 60 * 1000;
      const otpToken = signOtpToken({
        kind: 'reset_otp',
        userId: targetUser.userId,
        username: targetUser.username,
        email: targetUser.email,
        otpHash,
        expiresAt,
      });

      const otpRecord: PendingOtpRecord = {
        purpose: 'reset',
        userId: targetUser.userId,
        username: targetUser.username,
        email: targetUser.email,
        otpHash,
        expiresAt,
        attempts: 0,
        requestedAt: new Date().toISOString(),
      };

      state = {
        ...state,
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

      const masked = maskEmailAddress(targetUser.email);

      if (!delivery.sent && delivery.provider !== 'none') {
        res.status(502).json({
          ok: false,
          emailSent: false,
          userId: targetUser.userId,
          username: targetUser.username,
          maskedEmail: masked,
          error:
            delivery.error ||
            `Failed to deliver password reset email to ${masked}. Please check SMTP/Resend settings.`,
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
          maskedEmail: masked,
          message: `Email gateway (SMTP_USER/SMTP_PASS or RESEND_API_KEY) is not configured yet. Verify account ownership with Google Sign-In (${masked}) below.`,
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
        maskedEmail: masked,
        expiresInMinutes: 15,
        otpToken,
        message: `A 6-digit password reset code has been sent to ${masked}.`,
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
      if (!checkRateLimit(req, 'reset-verify', 15, 60_000)) {
        res.status(429).json({ ok: false, error: 'Too many verification attempts.' });
        return;
      }
      const body = (req.body || {}) as {
        otp?: unknown;
        otpToken?: unknown;
        userId?: unknown;
      };
      const otp = typeof body.otp === 'string' ? body.otp.trim() : '';

      const signedPayload =
        typeof body.otpToken === 'string' && body.otpToken ? verifyOtpToken(body.otpToken) : null;
      const targetUserId =
        signedPayload?.userId ||
        (typeof body.userId === 'string' && body.userId.trim()) ||
        '';
      const storedForUser = targetUserId ? state.pendingOtps[`reset:${targetUserId}`] || null : null;

      const targetEmail = signedPayload?.email || storedForUser?.email || '';
      const targetUsername = signedPayload?.username || storedForUser?.username || '';

      if (!/^\d{6}$/.test(otp)) {
        res.status(400).json({
          ok: false,
          error: 'Please enter the 6-digit verification code sent to your email.',
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
            salt: undefined,
          }
        : storedForUser;

      if (!activeOtp || !targetUserId) {
        res.status(400).json({
          ok: false,
          error: 'No active reset code found. Please request a fresh code first.',
        });
        return;
      }
      if (Date.now() > activeOtp.expiresAt) {
        const nextOtps = { ...state.pendingOtps };
        delete nextOtps[`reset:${targetUserId}`];
        state = { ...state, pendingOtps: nextOtps };
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
        state = { ...state, pendingOtps: nextOtps };
        saveServerState(state);
        res.status(429).json({
          ok: false,
          error: 'Too many invalid code attempts. Please request a new reset code.',
        });
        return;
      }

      const matches = verifyOtpSecret(otp, activeOtp.otpHash, activeOtp.salt);
      if (!matches) {
        if (storedForUser) {
          const bumped = { ...storedForUser, attempts: storedForUser.attempts + 1 };
          state = {
            ...state,
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
        maskedEmail: maskEmailAddress(targetEmail),
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

  router.post('/auth/reset/verify-google', async (req: Request, res: Response) => {
    try {
      if (!checkRateLimit(req, 'reset-verify-google', 10, 60_000)) {
        res.status(429).json({ ok: false, error: 'Too many Google verification attempts.' });
        return;
      }
      const body = (req.body || {}) as {
        identifier?: string;
        userId?: string;
        firebaseIdToken?: string;
      };
      const lookupKey =
        (typeof body.userId === 'string' && body.userId.trim()) ||
        (typeof body.identifier === 'string' && body.identifier.trim()) ||
        '';
      const targetUser = lookupKey ? findUserInState(lookupKey) : null;
      if (!targetUser) {
        res.status(404).json({
          ok: false,
          error: 'Target CRM account not found for password reset.',
        });
        return;
      }
      const accountEnabled =
        targetUser.isEnabled !== undefined ? targetUser.isEnabled !== false : targetUser.isActive !== false;
      if (!accountEnabled && normalizeServerRole(targetUser.role) !== 'owner') {
        res.status(403).json({
          ok: false,
          error: 'This account is disabled. Contact your company administrator.',
        });
        return;
      }
      const token = typeof body.firebaseIdToken === 'string' ? body.firebaseIdToken.trim() : '';
      if (!token) {
        res.status(400).json({ ok: false, error: 'Google ID token is required.' });
        return;
      }
      const verified = await verifyFirebaseIdToken(token, targetUser.email);
      if (!verified.ok) {
        res.status(403).json({
          ok: false,
          error: verified.error || 'Google verification does not match this account.',
        });
        return;
      }
      const verifiedToken = signVerifiedResetToken({
        userId: targetUser.userId,
        username: targetUser.username,
        email: targetUser.email,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });
      res.json({
        ok: true,
        verifiedToken,
        userId: targetUser.userId,
        username: targetUser.username,
        maskedEmail: maskEmailAddress(targetUser.email),
        message: 'Google account verified. Enter your new password below.',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to verify Google identity.',
      });
    }
  });

  router.post('/auth/reset-password', async (req: Request, res: Response) => {
    try {
      if (!checkRateLimit(req, 'reset-password', 10, 60_000)) {
        res.status(429).json({ ok: false, error: 'Too many password reset attempts.' });
        return;
      }
      const body = (req.body || {}) as {
        mode?: 'otp' | 'google';
        identifier?: string;
        userId?: string;
        otp?: string;
        otpToken?: string;
        verifiedToken?: string;
        firebaseIdToken?: string;
        newPassword?: string;
      };
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (newPassword.length < 8 || newPassword.length > 128) {
        res.status(400).json({
          ok: false,
          error: 'New password must be between 8 and 128 characters.',
        });
        return;
      }

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
        '';

      const targetUser = lookupKey ? findUserInState(lookupKey) : null;
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
        const verified = await verifyFirebaseIdToken(token, targetUser.email);
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
          const storedForUser = state.pendingOtps[`reset:${targetUser.userId}`] || null;
          const activeOtp = signedOtpPayload
            ? {
                ...signedOtpPayload,
                attempts:
                  storedForUser && storedForUser.otpHash === signedOtpPayload.otpHash
                    ? storedForUser.attempts
                    : 0,
                salt: undefined,
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
            state = { ...state, pendingOtps: nextOtps };
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
            state = { ...state, pendingOtps: nextOtps };
            saveServerState(state);
            res.status(429).json({
              ok: false,
              error: 'Too many invalid code attempts. Please request a new reset code.',
            });
            return;
          }
          if (!verifyOtpSecret(otp, activeOtp.otpHash, activeOtp.salt)) {
            if (storedForUser) {
              const bumped = { ...storedForUser, attempts: storedForUser.attempts + 1 };
              state = {
                ...state,
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

      const passwordHash = await hashPasswordBcrypt(newPassword);
      const updatedAt = new Date().toISOString();
      const updatedUser: CrmServerUserRecord = {
        ...targetUser,
        passwordHash,
        salt: undefined,
        hash: undefined,
        passwordChangedAt: updatedAt,
        updatedAt,
      };

      const nextOtps = { ...state.pendingOtps };
      delete nextOtps[`reset:${targetUser.userId}`];

      state = {
        ...state,
        users: {
          ...state.users,
          [updatedUser.userId]: updatedUser,
        },
        pendingOtps: nextOtps,
      };
      saveServerState(state);

      const company = getCompanySummary(updatedUser.companyId);
      res.json({
        ok: true,
        username: updatedUser.username,
        user: sanitizeServerUserForClient(updatedUser, company?.companyName),
        message: 'Password has been reset successfully. You can now log in with your new password.',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to reset password.',
      });
    }
  });

  // Company Workspace Profile & Plan Management (Strictly company-isolated & authenticated)
  router.get('/company/profile', (req: Request, res: Response) => {
    const caller = requireAuth(req, res);
    if (!caller) return;
    const company = getCompanySummary(caller.companyId);
    if (!company) {
      res.status(404).json({ ok: false, error: 'Company workspace not found.' });
      return;
    }
    const membersCount = Object.values(state.users).filter(
      (u) => u.companyId === caller.companyId,
    ).length;
    res.json({
      ok: true,
      company,
      quotas: PLAN_QUOTAS[company.plan || 'starter'],
      usage: {
        usersCount: membersCount,
        aiScansUsed: company.usage.aiScansUsed,
        monthKey: company.usage.monthKey,
      },
    });
  });

  router.put('/company/profile', (req: Request, res: Response) => {
    const caller = requireAuth(req, res);
    if (!caller) return;
    if (!requirePermission(caller, 'billing.manage', res)) return;
    const existing = getCompanySummary(caller.companyId);
    if (!existing) {
      res.status(404).json({ ok: false, error: 'Company workspace not found.' });
      return;
    }

    const body = (req.body || {}) as {
      companyName?: unknown;
      gstin?: unknown;
      udyamNumber?: unknown;
      plan?: unknown;
    };
    const nextName =
      typeof body.companyName === 'string' && body.companyName.trim().length >= 2
        ? body.companyName.trim().slice(0, 120)
        : existing.companyName;
    const nextGstin =
      typeof body.gstin === 'string' ? body.gstin.trim().toUpperCase().slice(0, 32) : existing.gstin;
    const nextUdyam =
      typeof body.udyamNumber === 'string'
        ? body.udyamNumber.trim().toUpperCase().slice(0, 40)
        : existing.udyamNumber;
    const nextPlan: CompanyPlanTier =
      body.plan === 'starter' || body.plan === 'professional' || body.plan === 'business'
        ? body.plan
        : existing.plan;

    const updated: CompanyServerRecord = {
      ...existing,
      companyName: nextName,
      gstin: nextGstin,
      udyamNumber: nextUdyam,
      plan: nextPlan,
      updatedAt: new Date().toISOString(),
    };
    const nextUsers = { ...state.users };
    for (const [uid, u] of Object.entries(nextUsers)) {
      if (u.companyId === caller.companyId) {
        nextUsers[uid] = { ...u, companyName: nextName };
      }
    }
    state = {
      ...state,
      companies: { ...state.companies, [caller.companyId]: updated },
      users: nextUsers,
    };
    saveServerState(state);

    res.json({
      ok: true,
      company: updated,
      quotas: PLAN_QUOTAS[updated.plan],
    });
  });

  router.get('/company/team', (req: Request, res: Response) => {
    const caller = requireAuth(req, res);
    if (!caller) return;
    if (!requirePermission(caller, 'team.manage', res)) return;
    const company = getCompanySummary(caller.companyId);
    const members = listCompanyTeamUsers(caller.companyId);
    const invites = Object.values(state.invites)
      .filter((inv) => inv.companyId === caller.companyId && !inv.usedAt && Date.now() < inv.expiresAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json({
      ok: true,
      company,
      members,
      invites,
    });
  });

  router.post('/company/team/invite', (req: Request, res: Response) => {
    const caller = requireAuth(req, res);
    if (!caller) return;
    if (!requirePermission(caller, 'team.manage', res)) return;
    const company = getCompanySummary(caller.companyId);
    if (!company) {
      res.status(404).json({ ok: false, error: 'Company workspace not found.' });
      return;
    }

    const body = (req.body || {}) as { email?: unknown; role?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = normalizeServerRole(typeof body.role === 'string' ? body.role : 'executive');
    if (role === 'owner') {
      res.status(403).json({ ok: false, error: 'Cannot invite another company owner directly.' });
      return;
    }
    if (!email || !isValidEmailAddress(email)) {
      res.status(400).json({ ok: false, error: 'Valid team member email address is required.' });
      return;
    }

    const currentUsers = Object.values(state.users).filter((u) => u.companyId === caller.companyId);
    const quota = PLAN_QUOTAS[company.plan || 'starter'];
    if (currentUsers.length >= quota.maxUsers) {
      res.status(403).json({
        ok: false,
        code: 'PLAN_USER_LIMIT',
        error: `User limit (${quota.maxUsers}) reached for ${quota.label} plan. Upgrade plan to invite more members.`,
      });
      return;
    }

    const inviteCode = `INV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const invite: CompanyInviteRecord = {
      inviteCode,
      companyId: caller.companyId,
      companyName: company.companyName,
      email,
      role,
      invitedByUserId: caller.userId,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    };

    state = {
      ...state,
      invites: { ...state.invites, [inviteCode]: invite },
    };
    saveServerState(state);

    res.status(201).json({ ok: true, invite });
  });

  router.post('/company/team/role', (req: Request, res: Response) => {
    const caller = requireAuth(req, res);
    if (!caller) return;
    if (!requirePermission(caller, 'team.manage', res)) return;

    const body = (req.body || {}) as { userId?: unknown; role?: unknown; isEnabled?: unknown };
    const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!targetUserId) {
      res.status(400).json({ ok: false, error: 'target userId is required.' });
      return;
    }
    const target = state.users[targetUserId];
    if (!target) {
      res.status(404).json({ ok: false, error: 'Team member not found.' });
      return;
    }
    if (target.companyId !== caller.companyId) {
      res.status(403).json({
        ok: false,
        error: 'Cross-company access denied. Cannot manage users from another company.',
      });
      return;
    }
    if (normalizeServerRole(target.role) === 'owner') {
      res.status(403).json({ ok: false, error: 'Workspace Owner role cannot be modified or disabled.' });
      return;
    }

    const nextRole =
      typeof body.role === 'string' ? normalizeServerRole(body.role) : normalizeServerRole(target.role);
    if (nextRole === 'owner') {
      res.status(403).json({ ok: false, error: 'Cannot promote a member to owner directly.' });
      return;
    }
    const nextEnabled =
      typeof body.isEnabled === 'boolean'
        ? body.isEnabled
        : target.isEnabled !== undefined
          ? target.isEnabled !== false
          : target.isActive !== false;

    const nowIso = new Date().toISOString();
    const updated: CrmServerUserRecord = {
      ...target,
      role: nextRole,
      isEnabled: nextEnabled,
      isActive: nextEnabled ? computeServerPresenceStatus(target) === 'active' : false,
      disabledAt: nextEnabled ? undefined : nowIso,
      presenceStatus: nextEnabled ? target.presenceStatus ?? 'not_active' : 'not_active',
      updatedAt: nowIso,
    };

    state = {
      ...state,
      users: { ...state.users, [updated.userId]: updated },
    };
    saveServerState(state);

    res.json({
      ok: true,
      member: sanitizeServerUserForClient(updated, state.companies[caller.companyId]?.companyName),
    });
  });

  // Backwards-compatible team directory routes (strictly authenticated & company-scoped)
  router.get('/auth/secondary-users', (req: Request, res: Response) => {
    const caller = requireAuth(req, res);
    if (!caller) return;
    if (!isWorkspaceAdminRole(caller.role)) {
      res.status(403).json({
        ok: false,
        error: 'Workspace administrator authorization is required to view team accounts.',
      });
      return;
    }
    const companyUsers = listCompanyTeamUsers(caller.companyId).filter(
      (u) => u.userId !== caller.userId,
    );
    res.json({
      ok: true,
      users: companyUsers,
    });
  });

  router.post('/auth/secondary-users/status', (req: Request, res: Response) => {
    const caller = requireAuth(req, res);
    if (!caller) return;
    if (!isWorkspaceAdminRole(caller.role)) {
      res.status(403).json({
        ok: false,
        error: 'Workspace administrator authorization is required to update team member access.',
      });
      return;
    }

    const body = (req.body || {}) as {
      userId?: unknown;
      username?: unknown;
      email?: unknown;
      isEnabled?: unknown;
    };

    const rawUserId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const rawUsername = typeof body.username === 'string' ? body.username.trim() : '';
    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const targetIdentifier = rawUserId || rawUsername || rawEmail;
    if (!targetIdentifier || typeof body.isEnabled !== 'boolean') {
      res.status(400).json({ ok: false, error: 'userId and boolean isEnabled are required.' });
      return;
    }

    const target =
      state.users[targetIdentifier] ||
      findUserInState(targetIdentifier, caller.companyId) ||
      (rawEmail ? findUserInState(rawEmail, caller.companyId) : null) ||
      (rawUsername ? findUserInState(rawUsername, caller.companyId) : null);

    if (!target) {
      res.status(404).json({ ok: false, error: 'Team member account not found in your company.' });
      return;
    }
    if (target.companyId !== caller.companyId) {
      res.status(403).json({
        ok: false,
        error: 'Cross-company access denied.',
      });
      return;
    }
    if (normalizeServerRole(target.role) === 'owner') {
      res.status(403).json({ ok: false, error: 'Workspace Owner account cannot be disabled.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const isEnabled = body.isEnabled;
    const updatedUser: CrmServerUserRecord = {
      ...target,
      isEnabled,
      isActive: isEnabled ? computeServerPresenceStatus(target) === 'active' : false,
      disabledAt: isEnabled ? undefined : nowIso,
      presenceStatus: isEnabled ? target.presenceStatus ?? 'not_active' : 'not_active',
      updatedAt: nowIso,
    };

    state = {
      ...state,
      users: { ...state.users, [updatedUser.userId]: updatedUser },
    };
    saveServerState(state);

    res.json({
      ok: true,
      user: sanitizeServerUserForClient(updatedUser, state.companies[caller.companyId]?.companyName),
      message: isEnabled
        ? `Re-enabled access for ${updatedUser.username}.`
        : `Disabled access for ${updatedUser.username}. Active sessions will be locked out.`,
    });
  });

  router.get('/notifications/email/status', (req: Request, res: Response) => {
    const caller = requireAuth(req, res);
    if (!caller) return;

    const requestedTenant =
      typeof req.query.tenantId === 'string' && req.query.tenantId.trim()
        ? req.query.tenantId.trim()
        : caller.companyId;
    if (
      requestedTenant !== caller.companyId &&
      requestedTenant !== caller.userId
    ) {
      res.status(403).json({ ok: false, error: 'Cross-company notification access denied.' });
      return;
    }

    const provider = detectEmailProvider();
    const scopedLogs = state.emailLogs.filter(
      (entry) =>
        entry.companyId === caller.companyId ||
        entry.tenantId === caller.companyId ||
        entry.tenantId === caller.userId,
    );
    res.json({
      ok: true,
      provider,
      automatedConfigured: provider !== 'none',
      defaultRecipientName: caller.username,
      defaultRecipientEmail: caller.email,
      scheduleLabels: ['11:00 AM IST', '4:00 PM IST'],
      logs: scopedLogs,
    });
  });

  router.post('/notifications/email', async (req: Request, res: Response) => {
    try {
      const caller = requireAuth(req, res);
      if (!caller) return;
      if (!requirePermission(caller, 'alerts.send', res)) return;

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

      const requestedTenant =
        typeof body.tenantId === 'string' && body.tenantId.trim()
          ? body.tenantId.trim()
          : caller.companyId;
      if (requestedTenant !== caller.companyId && requestedTenant !== caller.userId) {
        res.status(403).json({ ok: false, error: 'Cross-company notification dispatch denied.' });
        return;
      }

      const slot = body.slot || 'slot_11am';
      const tenderId = String(body.tenderId || '').trim();
      const tenderRefId = String(body.tenderRefId || tenderId).trim();
      const recipientName = String(body.recipientName || caller.username).trim();
      const recipientEmail = String(body.recipientEmail || caller.email).trim();
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
      const scopedSlotKey = `${caller.companyId}::${rawSlotKey}`;

      if (slot !== 'test' && slot !== 'manual') {
        const existingLog = state.emailLogs.find((l) => {
          const sameCompany =
            l.companyId === caller.companyId ||
            l.tenantId === caller.companyId ||
            l.tenantId === caller.userId;
          return (
            sameCompany &&
            (l.slotKey === scopedSlotKey || l.slotKey === rawSlotKey) &&
            l.status === 'sent'
          );
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
        tenantId: requestedTenant,
        companyId: caller.companyId,
        slotKey: scopedSlotKey,
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
    const caller = requireAuth(req, res);
    if (!caller) return;
    if (!requirePermission(caller, 'ai.scan', res)) return;

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

      if (!ensureAiQuotaAvailable(caller.companyId, res)) {
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

      checkAndIncrementAiQuota(caller.companyId, res);
      if (res.headersSent) return;

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

  router.post('/sheet-sync', async (req: Request, res: Response) => {
    const caller = requireAuth(req, res);
    if (!caller) return;
    if (!requirePermission(caller, 'sheets.sync', res)) return;

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
      const upstream = await safeFetchAppsScript(webhookUrl, {
        method: 'POST',
        body: JSON.stringify(body.payload),
        timeoutMs: 15000,
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
    const caller = requireAuth(req, res);
    if (!caller) return;
    if (!requirePermission(caller, 'sheets.sync', res)) return;

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
      const upstream = await safeFetchAppsScript(webhookUrl, {
        method: 'GET',
        timeoutMs: 15000,
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
    const caller = requireAuth(req, res);
    if (!caller) return;
    if (!requirePermission(caller, 'ai.scan', res)) return;

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

      if (!att1 || !att2) {
        res.status(400).json({
          ok: false,
          success: false,
          error: 'Both Attachment 1 (Bid Document) and Attachment 2 (Specification Document) are required before auto-generating MAF entries.',
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

      if (!ensureAiQuotaAvailable(caller.companyId, res)) {
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

      checkAndIncrementAiQuota(caller.companyId, res);
      if (res.headersSent) return;

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


