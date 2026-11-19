import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test, { after, before } from 'node:test';
import express from 'express';
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

async function withApiServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createApiRouter());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    server.close();
    throw new Error('Failed to bind ephemeral port');
  }
  try {
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('WhatsApp notification endpoints are removed and /api/notifications/email dispatches & deduplicates cleanly', async () => {
  const prevResend = process.env.RESEND_API_KEY;
  const prevFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = 're_test_email_alert_key';

  let sentCount = 0;
  let lastPayload: { to?: string[]; subject?: string; text?: string; html?: string } = {};

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === 'https://api.resend.com/emails') {
      sentCount += 1;
      lastPayload = JSON.parse(String(init?.body || '{}')) as typeof lastPayload;
      return new Response(JSON.stringify({ id: `em_${sentCount}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return prevFetch(input, init);
  };

  try {
    await withApiServer(async (baseUrl) => {
      // Legacy WhatsApp routes should no longer exist
      const waStatus = await prevFetch(`${baseUrl}/api/notifications/whatsapp/status`);
      assert.equal(waStatus.status, 404);

      const waPost = await prevFetch(`${baseUrl}/api/notifications/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenderId: 'GEM/2026/B/8153995' }),
      });
      assert.equal(waPost.status, 404);

      // Email status route exposes 11:00 AM IST & 4:00 PM IST schedule
      const statusRes = await prevFetch(`${baseUrl}/api/notifications/email/status`);
      assert.equal(statusRes.status, 200);
      const statusJson = (await statusRes.json()) as {
        ok: boolean;
        automatedConfigured: boolean;
        defaultRecipientEmail: string;
        scheduleLabels: string[];
      };
      assert.equal(statusJson.ok, true);
      assert.equal(statusJson.automatedConfigured, true);
      assert.equal(statusJson.defaultRecipientEmail, 'vanshsaxena7498@gmail.com');
      assert.deepEqual(statusJson.scheduleLabels, ['11:00 AM IST', '4:00 PM IST']);

      // First dispatch for slotKey sends real email
      const payload = {
        slotKey: 'email_tnd-1_2026-11-18_slot_11am',
        tenderRefId: 'tnd-1',
        tenderId: 'GEM/2026/B/8153995',
        slot: 'slot_11am',
        recipientName: 'Vansh',
        recipientEmail: 'vanshsaxena7498@gmail.com',
        dueDateIso: '2026-11-20T13:00',
        subject: 'NEW TENDER ALERT NOTIFICATION (DUE WITHIN 48 HOURS) · GEM/2026/B/8153995',
        message: 'NEW TENDER ALERT NOTIFICATION (DUE WITHIN 48 HOURS)\nDear Vansh,\n\nTender ID: GEM/2026/B/8153995',
        html: '<p>Test</p>',
      };

      const firstRes = await prevFetch(`${baseUrl}/api/notifications/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(firstRes.status, 200);
      const firstJson = (await firstRes.json()) as {
        ok: boolean;
        deduplicated: boolean;
        delivered: boolean;
        logEntry: { status: string; slotKey: string };
      };
      assert.equal(firstJson.ok, true);
      assert.equal(firstJson.deduplicated, false);
      assert.equal(firstJson.delivered, true);
      assert.equal(firstJson.logEntry.status, 'sent');
      assert.equal(sentCount, 1);
      assert.equal(lastPayload.to?.[0], 'vanshsaxena7498@gmail.com');

      // Duplicate dispatch for same slotKey is deduplicated cleanly
      const dupRes = await prevFetch(`${baseUrl}/api/notifications/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(dupRes.status, 200);
      const dupJson = (await dupRes.json()) as {
        ok: boolean;
        deduplicated: boolean;
        delivered: boolean;
      };
      assert.equal(dupJson.ok, true);
      assert.equal(dupJson.deduplicated, true);
      assert.equal(dupJson.delivered, true);
      assert.equal(sentCount, 1);
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
