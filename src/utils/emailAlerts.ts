import type { EmailAlertSettings, EmailReminderSlot, Tender } from '../types/crm';
import { sanitizeDocId } from './cloudSyncHelpers.ts';
import {
  formatDateTime,
  formatINR,
  formatShortDate,
  getHoursRemaining,
  getLatestRemarkText,
} from './formatters.ts';

export const ALERT_WINDOW_HOURS = 120; // 5 days
export const EMAIL_RETRY_COOLDOWN_MS = 15 * 60 * 1000;
export const EMAIL_RETRY_MAX_ATTEMPTS = 3;

export interface EmailRetryRecord {
  attempts: number;
  lastAttemptAt: number;
}

export function shouldAttemptEmailDispatch(
  retryMap: ReadonlyMap<string, EmailRetryRecord>,
  slotKey: string,
  nowMs: number = Date.now(),
): boolean {
  const entry = retryMap.get(slotKey);
  if (!entry) return true;
  if (entry.attempts >= EMAIL_RETRY_MAX_ATTEMPTS) return false;
  return nowMs - entry.lastAttemptAt >= EMAIL_RETRY_COOLDOWN_MS;
}

export function recordEmailDispatchFailure(
  retryMap: Map<string, EmailRetryRecord>,
  slotKey: string,
  nowMs: number = Date.now(),
): EmailRetryRecord {
  const prev = retryMap.get(slotKey);
  const next: EmailRetryRecord = {
    attempts: (prev?.attempts ?? 0) + 1,
    lastAttemptAt: nowMs,
  };
  retryMap.set(slotKey, next);
  return next;
}

export const DEFAULT_EMAIL_ALERT_SETTINGS: EmailAlertSettings = {
  enabled: true,
  recipientName: 'Vansh',
  recipientEmail: 'vanshsaxena7498@gmail.com',
};

export interface PendingEmailDispatch {
  tender: Tender;
  slot: EmailReminderSlot;
  slotKey: string;
  istDateKey: string;
  hoursRemaining: number;
}

export interface IstDateTimeParts {
  dateKey: string; // YYYY-MM-DD in IST
  hour: number; // 0..23 in IST
  minute: number; // 0..59 in IST
}

const IST_OFFSET_MS = 330 * 60 * 1000;

export function getIstDateTimeParts(now: Date = new Date()): IstDateTimeParts {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    dateKey: ist.toISOString().slice(0, 10),
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  };
}

/**
 * Returns the active daily email reminder slot in IST:
 *  - Morning Reminder: 11:00 AM to 3:59 PM IST ('slot_11am')
 *  - Evening Reminder: 4:00 PM to 11:59 PM IST ('slot_4pm')
 *  - Before 11:00 AM IST: null
 */
export function getActiveDailyEmailSlot(now: Date = new Date()): EmailReminderSlot | null {
  const { hour } = getIstDateTimeParts(now);
  if (hour >= 11 && hour < 16) {
    return 'slot_11am';
  }
  if (hour >= 16) {
    return 'slot_4pm';
  }
  return null;
}

export function formatEmailCountdown(hoursRemaining: number): string {
  if (!Number.isFinite(hoursRemaining) || hoursRemaining <= 0) {
    return 'Deadline Reached';
  }
  const totalMinutes = Math.max(1, Math.round(hoursRemaining * 60));
  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24);
    const remHrs = hrs % 24;
    return remHrs > 0 ? `${days}d ${remHrs}h left` : `${days}d left`;
  }
  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m left` : `${hrs}h left`;
  }
  return `${mins}m left`;
}

export function buildEmailSlotKey(
  tender: Pick<Tender, 'id'>,
  istDateKey: string,
  slot: EmailReminderSlot,
): string {
  return sanitizeDocId(`email_${tender.id}_${istDateKey}_${slot}`);
}

export function isValidNotificationEmail(raw: string): boolean {
  const trimmed = raw.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function formatSlotLabel(slot: EmailReminderSlot | 'manual' | 'test'): string {
  if (slot === 'slot_11am') return '11:00 AM IST Daily Reminder';
  if (slot === 'slot_4pm') return '4:00 PM IST Daily Reminder';
  if (slot === 'manual') return 'Manual Reminder';
  return 'Test Email Alert';
}

export function buildTenderEmailMessage(
  tender: Tender,
  slot: EmailReminderSlot | 'manual' | 'test',
  recipientName: string = DEFAULT_EMAIL_ALERT_SETTINGS.recipientName,
  now: Date = new Date(),
): {
  subject: string;
  text: string;
  html: string;
} {
  const safeRecipient = recipientName.trim() || DEFAULT_EMAIL_ALERT_SETTINGS.recipientName;
  const hoursLeft = getHoursRemaining(tender.submissionDueDate, now);
  const countdown = formatEmailCountdown(hoursLeft);
  const dueDisplay = formatDateTime(tender.submissionDueDate);
  const publishDisplay = tender.publishDate ? formatShortDate(tender.publishDate) : 'N/A';
  const preBidDisplay = tender.preBidDate ? formatDateTime(tender.preBidDate) : 'N/A';

  const checklistTotal = tender.checklist?.length ?? 0;
  const checklistDone = (tender.checklist ?? []).filter((c) => c.checked).length;
  const latestRemark = getLatestRemarkText(tender.remarks, 'None');

  const windowPhrase =
    Number.isFinite(hoursLeft) && hoursLeft > 0 && hoursLeft <= 48
      ? 'DUE WITHIN 48 HOURS'
      : 'DUE WITHIN 5 DAYS';

  const headerLine =
    slot === 'test'
      ? `TEST TENDER ALERT NOTIFICATION (${windowPhrase})`
      : `NEW TENDER ALERT NOTIFICATION (${windowPhrase})`;

  const lines = [
    headerLine,
    `Dear ${safeRecipient},`,
    '',
    `Tender ID: ${tender.tenderId}`,
    `Portal: ${tender.portal}`,
    `Department: ${tender.department}`,
    `Location: ${tender.location || 'N/A'}`,
    `Category: ${tender.category || 'N/A'}`,
    `Work / Title: ${tender.title}`,
    `Current Stage: ${tender.stage}`,
    `Publish Date: ${publishDisplay}`,
    `Last Date & Time of Filing: ${dueDisplay} (${countdown})`,
    `Pre-Bid Meeting: ${preBidDisplay}`,
    `Estimated Value: ${formatINR(tender.estimatedValue)}`,
    `Quoted Value: ${tender.quotedValue > 0 ? formatINR(tender.quotedValue) : 'Not Quoted Yet'}`,
    `EMD Status: ${tender.emdStatus} (${formatINR(tender.emdAmount)})`,
    `Checklist Progress: ${checklistDone}/${checklistTotal} completed`,
    `Latest Remark: ${latestRemark}`,
    '',
    '— Vansh Tender Software CRM',
  ];

  const text = lines.join('\n');

  const slotTag =
    slot === 'slot_11am'
      ? '11:00 AM Daily Reminder'
      : slot === 'slot_4pm'
        ? '4:00 PM Daily Reminder'
        : slot === 'manual'
          ? 'Manual Tender Reminder'
          : 'Test Alert';

  const subject = `${headerLine} · ${tender.tenderId} (${countdown})`;

  const escapeHtml = (val: string) =>
    val
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#f8fafc;color:#0f172a;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:#0B1E47;padding:18px 24px;color:#ffffff;">
          <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#93c5fd;">${escapeHtml(slotTag)}</p>
          <h2 style="margin:0;font-size:17px;font-weight:700;">${escapeHtml(headerLine)}</h2>
        </div>
        <div style="padding:20px 24px;">
          <p style="margin:0 0 14px;font-size:14px;">Dear <strong>${escapeHtml(safeRecipient)}</strong>,</p>
          <pre style="margin:0;padding:16px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;font-family:Segoe UI,Arial,sans-serif;font-size:13px;line-height:1.65;white-space:pre-wrap;color:#0f172a;">${escapeHtml(
            lines.slice(3, -2).join('\n'),
          )}</pre>
          <p style="margin:16px 0 0;font-size:12px;color:#64748b;">— Vansh Tender Software CRM</p>
        </div>
      </div>
    </div>
  `.trim();

  return { subject, text, html };
}

/**
 * Evaluates active pre-submission tenders due within 5 days (0 < hours <= 120)
 * and produces daily email dispatches at 11:00 AM IST and 4:00 PM IST.
 */
export function computePendingEmailAlerts(
  tenders: Tender[],
  sentSlotKeys: Set<string>,
  now: Date = new Date(),
): PendingEmailDispatch[] {
  const activeSlot = getActiveDailyEmailSlot(now);
  if (!activeSlot) return [];

  const { dateKey } = getIstDateTimeParts(now);
  const pending: PendingEmailDispatch[] = [];

  for (const tender of tenders) {
    if (
      tender.stage !== 'Identified / Reviewing' &&
      tender.stage !== 'Doc Preparation'
    ) {
      continue;
    }

    const hoursRemaining = getHoursRemaining(tender.submissionDueDate, now);
    if (!Number.isFinite(hoursRemaining) || hoursRemaining <= 0 || hoursRemaining > ALERT_WINDOW_HOURS) {
      continue;
    }

    const slotKey = buildEmailSlotKey(tender, dateKey, activeSlot);
    if (!sentSlotKeys.has(slotKey)) {
      pending.push({
        tender,
        slot: activeSlot,
        slotKey,
        istDateKey: dateKey,
        hoursRemaining,
      });
    }
  }

  return pending;
}
