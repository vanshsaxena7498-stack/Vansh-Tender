import type { Tender, WhatsAppMilestone, WhatsAppSettings } from '../types/crm';
import { sanitizeDocId } from './cloudSyncHelpers';
import { formatDateTime, formatINR, formatShortDate, getHoursRemaining } from './formatters';

export const DEFAULT_WHATSAPP_SETTINGS: WhatsAppSettings = {
  enabled: true,
  recipientName: 'Vansh',
  recipientPhone: '9717690890',
};

export interface PendingWhatsAppDispatch {
  tender: Tender;
  milestone: WhatsAppMilestone;
  milestoneKey: string;
  hoursRemaining: number;
}

export function normalizeIndianWhatsAppPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

export function formatWhatsAppCountdown(hoursRemaining: number): string {
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

export function buildWhatsAppMilestoneKey(
  tender: Pick<Tender, 'id' | 'submissionDueDate'>,
  milestone: WhatsAppMilestone,
): string {
  return sanitizeDocId(`wa_${tender.id}_${tender.submissionDueDate || 'nodate'}_${milestone}`);
}

export function buildTenderWhatsAppMessage(
  tender: Tender,
  milestone: WhatsAppMilestone | 'test',
  recipientName: string = DEFAULT_WHATSAPP_SETTINGS.recipientName,
  now: Date = new Date(),
): string {
  const safeRecipient = recipientName.trim() || DEFAULT_WHATSAPP_SETTINGS.recipientName;
  const hoursLeft = getHoursRemaining(tender.submissionDueDate, now);
  const countdown = formatWhatsAppCountdown(hoursLeft);
  const dueDisplay = formatDateTime(tender.submissionDueDate);
  const publishDisplay = tender.publishDate ? formatShortDate(tender.publishDate) : 'N/A';
  const preBidDisplay = tender.preBidDate ? formatDateTime(tender.preBidDate) : 'N/A';

  const checklistTotal = tender.checklist?.length ?? 0;
  const checklistDone = (tender.checklist ?? []).filter((c) => c.checked).length;
  const latestRemark =
    tender.remarks && tender.remarks.length > 0
      ? tender.remarks[tender.remarks.length - 1].text
      : 'None';

  const header =
    milestone === 'urgent_4h'
      ? 'URGENT TENDER REMINDER (ONLY <= 4 HOURS LEFT TO FILE!)'
      : milestone === 'test'
        ? 'TEST WHATSAPP TENDER ALERT'
        : 'NEW TENDER ALERT NOTIFICATION (DUE WITHIN 48 HOURS)';

  const lines = [
    `*${header}*`,
    `Dear ${safeRecipient},`,
    '',
    `*Tender ID:* ${tender.tenderId}`,
    `*Portal:* ${tender.portal}`,
    `*Department:* ${tender.department}`,
    `*Location:* ${tender.location || 'N/A'}`,
    `*Category:* ${tender.category || 'N/A'}`,
    `*Work / Title:* ${tender.title}`,
    `*Current Stage:* ${tender.stage}`,
    `*Publish Date:* ${publishDisplay}`,
    `*Last Date & Time of Filing:* ${dueDisplay} (${countdown})`,
    `*Pre-Bid Meeting:* ${preBidDisplay}`,
    `*Estimated Value:* ${formatINR(tender.estimatedValue)}`,
    `*Quoted Value:* ${tender.quotedValue > 0 ? formatINR(tender.quotedValue) : 'Not Quoted Yet'}`,
    `*EMD Status:* ${tender.emdStatus} (${formatINR(tender.emdAmount)})`,
    `*Checklist Progress:* ${checklistDone}/${checklistTotal} completed`,
    `*Latest Remark:* ${latestRemark}`,
    '',
    '— Vansh Tender Software CRM',
  ];

  return lines.join('\n');
}

export function buildWhatsAppWebUrl(phone: string, message: string): string {
  const normalized = normalizeIndianWhatsAppPhone(phone);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

/**
 * Evaluates all active pre-submission tenders that qualify for the Alerts Bell (<= 48h due)
 * and produces WhatsApp dispatches for:
 *  1) `alert_48h`: First time when tender enters Alerts (4h < hoursRemaining <= 48h)
 *  2) `urgent_4h`: Second time when <= 4 hours remain before filing deadline (0 < hoursRemaining <= 4h)
 */
export function computePendingWhatsAppAlerts(
  tenders: Tender[],
  sentMilestoneKeys: Set<string>,
  now: Date = new Date(),
): PendingWhatsAppDispatch[] {
  const pending: PendingWhatsAppDispatch[] = [];

  for (const tender of tenders) {
    if (
      tender.stage !== 'Identified / Reviewing' &&
      tender.stage !== 'Doc Preparation'
    ) {
      continue;
    }

    const hoursRemaining = getHoursRemaining(tender.submissionDueDate, now);
    if (!Number.isFinite(hoursRemaining) || hoursRemaining <= 0 || hoursRemaining > 48) {
      continue;
    }

    if (hoursRemaining <= 4) {
      const urgentKey = buildWhatsAppMilestoneKey(tender, 'urgent_4h');
      if (!sentMilestoneKeys.has(urgentKey)) {
        pending.push({
          tender,
          milestone: 'urgent_4h',
          milestoneKey: urgentKey,
          hoursRemaining,
        });
      }
      continue;
    }

    const alertKey = buildWhatsAppMilestoneKey(tender, 'alert_48h');
    if (!sentMilestoneKeys.has(alertKey)) {
      pending.push({
        tender,
        milestone: 'alert_48h',
        milestoneKey: alertKey,
        hoursRemaining,
      });
    }
  }

  return pending;
}
