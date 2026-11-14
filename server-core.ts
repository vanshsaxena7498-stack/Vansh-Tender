import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express, { type Request, type Response, type Router } from 'express';
import nodemailer from 'nodemailer';

const ADMIN_USERNAME = 'VanshSales';
const DEFAULT_ADMIN_PASSWORD = process.env.CRM_INITIAL_PASSWORD || 'Vansh@2027';
const RECOVERY_EMAIL = 'vanshsaxena7498@gmail.com';
const DEFAULT_WHATSAPP_NAME = 'Vansh';
const DEFAULT_WHATSAPP_PHONE = '9717690890';

const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'vansh-crm-data')
  : path.resolve(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'crm-server-state.json');

interface PasswordRecord {
  salt: string;
  hash: string;
  updatedAt: string;
}

interface PendingOtpRecord {
  salt: string;
  otpHash: string;
  expiresAt: number;
  attempts: number;
  requestedAt: string;
}

export interface ServerWhatsAppLogEntry {
  id: string;
  milestoneKey: string;
  tenderRefId: string;
  tenderId: string;
  milestone: 'alert_48h' | 'urgent_4h' | 'test';
  recipientName: string;
  recipientPhone: string;
  dueDateIso: string;
  status: 'sent' | 'manual_ready' | 'failed';
  provider: string;
  message: string;
  errorDetail?: string;
  createdAt: string;
}

interface PersistedServerState {
  passwordRecord: PasswordRecord;
  pendingOtp: PendingOtpRecord | null;
  whatsappLogs: ServerWhatsAppLogEntry[];
}

function getHmacSecret(): string {
  return (
    process.env.CRM_TOKEN_SECRET ||
    process.env.SMTP_PASS ||
    process.env.RESEND_API_KEY ||
    'vansh-tender-software-otp-hmac-v1'
  );
}

function signOtpToken(payload: { salt: string; otpHash: string; expiresAt: number }): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getHmacSecret()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyOtpToken(token: string): { salt: string; otpHash: string; expiresAt: number } | null {
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
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      salt?: string;
      otpHash?: string;
      expiresAt?: number;
    };
    if (
      typeof parsed.salt === 'string' &&
      typeof parsed.otpHash === 'string' &&
      typeof parsed.expiresAt === 'number'
    ) {
      return { salt: parsed.salt, otpHash: parsed.otpHash, expiresAt: parsed.expiresAt };
    }
  } catch {
    return null;
  }
  return null;
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
  return {
    passwordRecord: {
      salt,
      hash,
      updatedAt: new Date().toISOString(),
    },
    pendingOtp: null,
    whatsappLogs: [],
  };
}

function loadServerState(): PersistedServerState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PersistedServerState>;
      if (parsed.passwordRecord?.salt && parsed.passwordRecord?.hash) {
        return {
          passwordRecord: parsed.passwordRecord,
          pendingOtp: parsed.pendingOtp ?? null,
          whatsappLogs: Array.isArray(parsed.whatsappLogs) ? parsed.whatsappLogs.slice(0, 200) : [],
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

function normalizeWhatsAppPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

function detectEmailProvider(): 'resend' | 'smtp' | 'none' {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return 'none';
}

function detectWhatsAppProvider(): 'meta_cloud' | 'twilio' | 'webhook' | 'none' {
  if (process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return 'meta_cloud';
  }
  if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_WHATSAPP_FROM
  ) {
    return 'twilio';
  }
  if (process.env.WHATSAPP_WEBHOOK_URL) {
    return 'webhook';
  }
  return 'none';
}

async function sendRecoveryOtpEmail(otpCode: string): Promise<{
  sent: boolean;
  provider: 'resend' | 'smtp' | 'none';
  error?: string;
}> {
  const provider = detectEmailProvider();
  const subject = 'Vansh Tender Software — Password Reset Verification Code';
  const textBody = [
    'Hello Vansh,',
    '',
    'We received a password reset request for your Vansh Tender Software CRM account (Username: VanshSales).',
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
      <p style="margin:0 0 16px;font-size:14px;color:#475569;">Password Reset Request for <strong>VanshSales</strong></p>
      <div style="padding:16px;border-radius:10px;background:#eff6ff;border:1px solid #bfdbfe;text-align:center;margin-bottom:16px;">
        <p style="margin:0 0 6px;font-size:12px;color:#1e3a8a;text-transform:uppercase;letter-spacing:1px;">Verification Code</p>
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:6px;color:#0B1E47;font-family:monospace;">${otpCode}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#475569;">Enter this code on the Login screen to choose a new password. The code expires in <strong>15 minutes</strong>.</p>
    </div>
  `;

  if (provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'Vansh Tender Software <onboarding@resend.dev>',
        to: [RECOVERY_EMAIL],
        subject,
        text: textBody,
        html: htmlBody,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { sent: false, provider, error: `Resend API error (${res.status}): ${errText}` };
    }
    return { sent: true, provider };
  }

  if (provider === 'smtp') {
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = Number(process.env.SMTP_PORT || 465);
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    await transporter.sendMail({
      from: `"Vansh Tender Software" <${process.env.SMTP_USER}>`,
      to: RECOVERY_EMAIL,
      subject,
      text: textBody,
      html: htmlBody,
    });
    return { sent: true, provider };
  }

  return { sent: false, provider: 'none' };
}

async function verifyGoogleIdTokenForAdmin(idToken: string): Promise<{
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
  if (!resp.ok) {
    return { ok: false, error: 'Google token verification failed.' };
  }
  const data = (await resp.json()) as {
    users?: Array<{ email?: string; emailVerified?: boolean }>;
  };
  const user = data.users?.[0];
  if (!user || !user.emailVerified) {
    return { ok: false, error: 'Google account email is not verified.' };
  }
  if ((user.email || '').toLowerCase() !== RECOVERY_EMAIL.toLowerCase()) {
    return {
      ok: false,
      error: `Only ${RECOVERY_EMAIL} is authorized to reset the CRM password.`,
    };
  }
  return { ok: true, email: user.email };
}

async function dispatchWhatsAppThroughGateway(
  normalizedPhone: string,
  message: string,
  metaPayload: {
    recipientName: string;
    tenderId: string;
    milestone: string;
    dueDateIso: string;
  },
): Promise<{
  delivered: boolean;
  provider: string;
  errorDetail?: string;
}> {
  const provider = detectWhatsAppProvider();

  if (provider === 'meta_cloud') {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
    const token = process.env.WHATSAPP_CLOUD_TOKEN!;
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedPhone,
        type: 'text',
        text: { body: message },
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { delivered: false, provider, errorDetail: `Meta API ${res.status}: ${errBody}` };
    }
    return { delivered: true, provider };
  }

  if (provider === 'twilio') {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const authToken = process.env.TWILIO_AUTH_TOKEN!;
    const fromNumber = process.env.TWILIO_WHATSAPP_FROM!;
    const toNumber = normalizedPhone.startsWith('whatsapp:')
      ? normalizedPhone
      : `whatsapp:+${normalizedPhone}`;
    const formattedFrom = fromNumber.startsWith('whatsapp:')
      ? fromNumber
      : `whatsapp:${fromNumber}`;

    const form = new URLSearchParams({
      From: formattedFrom,
      To: toNumber,
      Body: message,
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { delivered: false, provider, errorDetail: `Twilio API ${res.status}: ${errBody}` };
    }
    return { delivered: true, provider };
  }

  if (provider === 'webhook') {
    const webhookUrl = process.env.WHATSAPP_WEBHOOK_URL!;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: normalizedPhone,
        recipientName: metaPayload.recipientName,
        tenderId: metaPayload.tenderId,
        milestone: metaPayload.milestone,
        dueDateIso: metaPayload.dueDateIso,
        message,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return { delivered: false, provider, errorDetail: `Webhook ${res.status}: ${errBody}` };
    }
    return { delivered: true, provider };
  }

  return { delivered: false, provider: 'manual_ready' };
}

export function createApiRouter(): Router {
  const router = express.Router();
  let state = loadServerState();

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      emailProvider: detectEmailProvider(),
      whatsappProvider: detectWhatsAppProvider(),
      recoveryEmail: RECOVERY_EMAIL,
      runtime: IS_VERCEL ? 'vercel-serverless' : 'node-express',
    });
  });

  router.post('/auth/login', (req: Request, res: Response) => {
    const body = (req.body || {}) as { username?: unknown; password?: unknown };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!username) {
      res.status(400).json({ ok: false, error: 'Please enter your Username or Email ID.' });
      return;
    }
    if (!password) {
      res.status(400).json({ ok: false, error: 'Please enter your Password.' });
      return;
    }
    if (
      username !== ADMIN_USERNAME ||
      !verifyHashedSecret(password, state.passwordRecord.salt, state.passwordRecord.hash)
    ) {
      res.status(401).json({
        ok: false,
        error: 'Invalid username or password. Please check your credentials and try again.',
      });
      return;
    }

    res.json({ ok: true, username: ADMIN_USERNAME });
  });

  router.post('/auth/forgot-password', async (_req: Request, res: Response) => {
    try {
      const otpCode = String(crypto.randomInt(100000, 1000000));
      const { salt, hash } = hashSecret(otpCode);
      const expiresAt = Date.now() + 15 * 60 * 1000;
      const otpToken = signOtpToken({ salt, otpHash: hash, expiresAt });

      state = {
        ...state,
        pendingOtp: {
          salt,
          otpHash: hash,
          expiresAt,
          attempts: 0,
          requestedAt: new Date().toISOString(),
        },
      };
      saveServerState(state);

      const delivery = await sendRecoveryOtpEmail(otpCode);
      if (!delivery.sent && delivery.provider !== 'none') {
        res.status(502).json({
          ok: false,
          emailSent: false,
          recipient: RECOVERY_EMAIL,
          error:
            delivery.error ||
            `Failed to deliver password reset email to ${RECOVERY_EMAIL}. Please check SMTP/Resend settings.`,
        });
        return;
      }

      if (!delivery.sent) {
        res.json({
          ok: true,
          emailSent: false,
          providerConfigured: false,
          recipient: RECOVERY_EMAIL,
          message: `Email gateway (SMTP_USER/SMTP_PASS or RESEND_API_KEY) is not configured yet. Configure it in server environment variables to send OTP emails to ${RECOVERY_EMAIL}, or verify ownership directly with Google (${RECOVERY_EMAIL}) below.`,
        });
        return;
      }

      res.json({
        ok: true,
        emailSent: true,
        providerConfigured: true,
        provider: delivery.provider,
        recipient: RECOVERY_EMAIL,
        expiresInMinutes: 15,
        otpToken,
        message: `A 6-digit password reset code has been sent to ${RECOVERY_EMAIL}.`,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to process password reset request.',
      });
    }
  });

  router.post('/auth/reset-password', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        mode?: 'otp' | 'google';
        otp?: string;
        otpToken?: string;
        firebaseIdToken?: string;
        newPassword?: string;
      };
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      if (newPassword.length < 6 || newPassword.length > 128) {
        res.status(400).json({
          ok: false,
          error: 'New password must be between 6 and 128 characters.',
        });
        return;
      }

      if (body.mode === 'google') {
        const token = typeof body.firebaseIdToken === 'string' ? body.firebaseIdToken : '';
        if (!token) {
          res.status(400).json({ ok: false, error: 'Google verification token is required.' });
          return;
        }
        const verified = await verifyGoogleIdTokenForAdmin(token);
        if (!verified.ok) {
          res.status(403).json({ ok: false, error: verified.error || 'Google verification failed.' });
          return;
        }
      } else {
        const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
        const signedPayload =
          typeof body.otpToken === 'string' && body.otpToken
            ? verifyOtpToken(body.otpToken)
            : null;
        const activeOtp = state.pendingOtp ?? (signedPayload ? { ...signedPayload, attempts: 0 } : null);

        if (!activeOtp) {
          res.status(400).json({
            ok: false,
            error: 'No active reset code found. Please request a fresh code first.',
          });
          return;
        }
        if (Date.now() > activeOtp.expiresAt) {
          state = { ...state, pendingOtp: null };
          saveServerState(state);
          res.status(400).json({
            ok: false,
            error: 'Verification code has expired. Please request a new code.',
          });
          return;
        }
        if (activeOtp.attempts >= 5) {
          state = { ...state, pendingOtp: null };
          saveServerState(state);
          res.status(429).json({
            ok: false,
            error: 'Too many invalid code attempts. Please request a new reset code.',
          });
          return;
        }
        const matches = verifyHashedSecret(otp, activeOtp.salt, activeOtp.otpHash);
        if (!matches) {
          if (state.pendingOtp) {
            state = {
              ...state,
              pendingOtp: {
                ...state.pendingOtp,
                attempts: state.pendingOtp.attempts + 1,
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

      const nextHash = hashSecret(newPassword);
      state = {
        ...state,
        passwordRecord: {
          salt: nextHash.salt,
          hash: nextHash.hash,
          updatedAt: new Date().toISOString(),
        },
        pendingOtp: null,
      };
      saveServerState(state);

      res.json({
        ok: true,
        message: 'Password has been reset successfully. You can now log in with your new password.',
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to reset password.',
      });
    }
  });

  router.get('/notifications/whatsapp/status', (_req: Request, res: Response) => {
    const provider = detectWhatsAppProvider();
    res.json({
      ok: true,
      provider,
      automatedConfigured: provider !== 'none',
      defaultRecipientName: DEFAULT_WHATSAPP_NAME,
      defaultRecipientPhone: DEFAULT_WHATSAPP_PHONE,
      logs: state.whatsappLogs,
    });
  });

  router.post('/notifications/whatsapp', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        milestoneKey?: string;
        tenderRefId?: string;
        tenderId?: string;
        milestone?: 'alert_48h' | 'urgent_4h' | 'test';
        recipientName?: string;
        recipientPhone?: string;
        dueDateIso?: string;
        message?: string;
      };

      const milestone = body.milestone || 'alert_48h';
      const tenderId = String(body.tenderId || '').trim();
      const tenderRefId = String(body.tenderRefId || tenderId).trim();
      const recipientName = String(body.recipientName || DEFAULT_WHATSAPP_NAME).trim();
      const rawPhone = String(body.recipientPhone || DEFAULT_WHATSAPP_PHONE).trim();
      const normalizedPhone = normalizeWhatsAppPhone(rawPhone);
      const dueDateIso = String(body.dueDateIso || '').trim();
      const message = String(body.message || '').trim();

      if (!tenderId || !message || normalizedPhone.length < 10) {
        res.status(400).json({
          ok: false,
          error: 'Valid tender details, message content, and 10+ digit phone number are required.',
        });
        return;
      }

      const milestoneKey =
        body.milestoneKey ||
        `${tenderRefId}__${dueDateIso || 'none'}__${milestone}`;

      if (milestone !== 'test') {
        const existingLog = state.whatsappLogs.find((l) => l.milestoneKey === milestoneKey);
        if (existingLog) {
          res.json({
            ok: true,
            deduplicated: true,
            delivered: existingLog.status === 'sent',
            provider: existingLog.provider,
            logEntry: existingLog,
          });
          return;
        }
      }

      const dispatchResult = await dispatchWhatsAppThroughGateway(normalizedPhone, message, {
        recipientName,
        tenderId,
        milestone,
        dueDateIso,
      });

      const entry: ServerWhatsAppLogEntry = {
        id: `walog-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        milestoneKey,
        tenderRefId,
        tenderId,
        milestone,
        recipientName,
        recipientPhone: normalizedPhone,
        dueDateIso,
        status: dispatchResult.delivered
          ? 'sent'
          : dispatchResult.errorDetail
            ? 'failed'
            : 'manual_ready',
        provider: dispatchResult.provider,
        message,
        ...(dispatchResult.errorDetail ? { errorDetail: dispatchResult.errorDetail } : {}),
        createdAt: new Date().toISOString(),
      };

      state = {
        ...state,
        whatsappLogs: [entry, ...state.whatsappLogs].slice(0, 200),
      };
      saveServerState(state);

      res.json({
        ok: true,
        deduplicated: false,
        delivered: dispatchResult.delivered,
        provider: dispatchResult.provider,
        logEntry: entry,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to dispatch WhatsApp notification.',
      });
    }
  });

  return router;
}
