import type {
  EmdBgRecord,
  NotificationItem,
  PortalType,
  Tender,
  TenderStage,
} from '../types/crm';
import {
  formatMonthLabel,
  getDaysRemaining,
  getFinancialYear,
  getHoursRemaining,
  getMonthKey,
} from './formatters';

export interface DashboardFilter {
  financialYear: string; // 'ALL' | 'FY 2025-26' | 'FY 2026-27' ...
  month: string; // 'ALL' | 'YYYY-MM'
  portal: 'ALL' | PortalType;
}

export interface DashboardKpis {
  totalTracked: number;
  bidsSubmitted: number;
  submissionRatioPct: number;
  totalQuotedValue: number;
  tendersWonCount: number;
  totalWonValue: number;
  winSuccessRatePct: number;
  activeCapitalBlocked: number;
}

export interface MonthlyChartPoint {
  monthKey: string;
  label: string;
  submitted: number;
  won: number;
  quotedCr: number;
  wonCr: number;
}

export interface StatusSlice {
  name: string;
  value: number;
  color: string;
}

export interface EmdSummaryTotals {
  activeEmdLocked: number;
  activeBgTotal: number;
  pendingRefundOverdue: number;
  safelyReleased: number;
}

export const SUBMITTED_OR_BEYOND_STAGES: TenderStage[] = [
  'Submitted',
  'Technical Eval',
  'Financial / BOQ Eval',
  'L1 / Won',
  'Lost (L2/L3)',
];

export const COMPLETED_TENDER_STAGES: TenderStage[] = [
  'L1 / Won',
  'Lost (L2/L3)',
  'Cancelled / Retendered',
  'Tender Not Filled',
];

export const ACTIVE_LOCKED_STATUSES = [
  'Active / Locked',
  'Extension Requested',
  'Refund / Release Applied',
] as const;

export function isBgOrFdr(instrumentType: EmdBgRecord['instrumentType']): boolean {
  return (
    instrumentType === 'Bank Guarantee (PBG / Bid BG)' ||
    instrumentType === 'FDR / TDR' ||
    instrumentType === 'e-PBG'
  );
}

export function filterTendersForDashboard(tenders: Tender[], filter: DashboardFilter): Tender[] {
  return tenders.filter((t) => {
    if (filter.portal !== 'ALL' && t.portal !== filter.portal) return false;
    const refDate = t.submissionDueDate || t.publishDate;
    if (filter.financialYear !== 'ALL' && getFinancialYear(refDate) !== filter.financialYear) {
      return false;
    }
    if (filter.month !== 'ALL' && getMonthKey(refDate) !== filter.month) {
      return false;
    }
    return true;
  });
}

export function computeDashboardKpis(
  filteredTenders: Tender[],
  emdRecords: EmdBgRecord[],
): DashboardKpis {
  const totalTracked = filteredTenders.length;
  const submittedTenders = filteredTenders.filter((t) =>
    SUBMITTED_OR_BEYOND_STAGES.includes(t.stage),
  );
  const bidsSubmitted = submittedTenders.length;
  const submissionRatioPct =
    totalTracked > 0 ? Math.round((bidsSubmitted / totalTracked) * 1000) / 10 : 0;

  const totalQuotedValue = submittedTenders.reduce(
    (sum, t) => sum + (t.quotedValue > 0 ? t.quotedValue : t.estimatedValue),
    0,
  );

  const wonTenders = filteredTenders.filter((t) => t.stage === 'L1 / Won');
  const tendersWonCount = wonTenders.length;
  const totalWonValue = wonTenders.reduce(
    (sum, t) => sum + (t.quotedValue > 0 ? t.quotedValue : t.estimatedValue),
    0,
  );

  const decidedCount = filteredTenders.filter(
    (t) => t.stage === 'L1 / Won' || t.stage === 'Lost (L2/L3)',
  ).length;
  const winDenominator = decidedCount > 0 ? decidedCount : bidsSubmitted;
  const winSuccessRatePct =
    winDenominator > 0 ? Math.round((tendersWonCount / winDenominator) * 1000) / 10 : 0;

  const activeCapitalBlocked = emdRecords
    .filter((r) => (ACTIVE_LOCKED_STATUSES as readonly string[]).includes(r.status))
    .reduce((sum, r) => sum + (r.amount || 0), 0);

  return {
    totalTracked,
    bidsSubmitted,
    submissionRatioPct,
    totalQuotedValue,
    tendersWonCount,
    totalWonValue,
    winSuccessRatePct,
    activeCapitalBlocked,
  };
}

export function buildMonthlyChartSeries(tenders: Tender[]): MonthlyChartPoint[] {
  const map = new Map<
    string,
    { submitted: number; won: number; quotedVal: number; wonVal: number }
  >();

  for (const t of tenders) {
    const key = getMonthKey(t.submissionDueDate || t.publishDate);
    if (!key) continue;
    const entry = map.get(key) ?? { submitted: 0, won: 0, quotedVal: 0, wonVal: 0 };
    if (SUBMITTED_OR_BEYOND_STAGES.includes(t.stage)) {
      entry.submitted += 1;
      entry.quotedVal += t.quotedValue > 0 ? t.quotedValue : t.estimatedValue;
    }
    if (t.stage === 'L1 / Won') {
      entry.won += 1;
      entry.wonVal += t.quotedValue > 0 ? t.quotedValue : t.estimatedValue;
    }
    map.set(key, entry);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, v]) => ({
      monthKey,
      label: formatMonthLabel(monthKey),
      submitted: v.submitted,
      won: v.won,
      quotedCr: Math.round((v.quotedVal / 1_00_00_000) * 100) / 100,
      wonCr: Math.round((v.wonVal / 1_00_00_000) * 100) / 100,
    }));
}

export function buildStatusDistribution(tenders: Tender[]): StatusSlice[] {
  const buckets: { label: string; stages: TenderStage[]; color: string }[] = [
    { label: 'Identified', stages: ['Identified / Reviewing'], color: '#64748B' },
    { label: 'Preparing', stages: ['Doc Preparation'], color: '#0284C7' },
    { label: 'Submitted', stages: ['Submitted'], color: '#2563EB' },
    {
      label: 'Under Eval',
      stages: ['Technical Eval', 'Financial / BOQ Eval'],
      color: '#D97706',
    },
    { label: 'L1 / Won', stages: ['L1 / Won'], color: '#16A34A' },
    { label: 'Lost', stages: ['Lost (L2/L3)'], color: '#DC2626' },
    { label: 'Cancelled', stages: ['Cancelled / Retendered'], color: '#94A3B8' },
    { label: 'Not Filled', stages: ['Tender Not Filled'], color: '#475569' },
  ];

  return buckets
    .map((b) => ({
      name: b.label,
      value: tenders.filter((t) => b.stages.includes(t.stage)).length,
      color: b.color,
    }))
    .filter((s) => s.value > 0);
}

export function computeEmdBgSummary(
  records: EmdBgRecord[],
  tenders: Tender[],
  referenceNow: Date = new Date(),
): EmdSummaryTotals {
  let activeEmdLocked = 0;
  let activeBgTotal = 0;
  let pendingRefundOverdue = 0;
  let safelyReleased = 0;

  const tenderByCode = new Map(tenders.map((t) => [t.tenderId.toLowerCase(), t]));

  for (const r of records) {
    const amt = r.amount || 0;
    const isBg = isBgOrFdr(r.instrumentType);
    const isActive = (ACTIVE_LOCKED_STATUSES as readonly string[]).includes(r.status);

    if (r.status === 'Refunded / Released') {
      safelyReleased += amt;
      continue;
    }

    if (isActive) {
      if (isBg) {
        activeBgTotal += amt;
      } else {
        activeEmdLocked += amt;
      }

      const linkedTender = tenderByCode.get(r.tenderId.toLowerCase());
      const isAppliedOrLost =
        r.status === 'Refund / Release Applied' ||
        (linkedTender && COMPLETED_TENDER_STAGES.includes(linkedTender.stage));
      const daysSinceCompletion = linkedTender?.completionDate
        ? -getDaysRemaining(linkedTender.completionDate, referenceNow)
        : r.expiryDate
          ? -getDaysRemaining(r.expiryDate, referenceNow)
          : 0;

      if (r.status === 'Refund / Release Applied' || (isAppliedOrLost && daysSinceCompletion > 60)) {
        pendingRefundOverdue += amt;
      }
    }
  }

  return {
    activeEmdLocked,
    activeBgTotal,
    pendingRefundOverdue,
    safelyReleased,
  };
}

/**
 * Smart Notification Bell computation:
 * 1. Tenders with submission deadlines within next 48 hours (and not already submitted/closed)
 * 2. Bank Guarantees (BG) or FDRs expiring within next 30 days (including expired but still Active/Extension Requested)
 * 3. EMDs pending refund for > 60 days after tender completion
 */
export function computeNotifications(
  tenders: Tender[],
  emdRecords: EmdBgRecord[],
  referenceNow: Date = new Date(),
): NotificationItem[] {
  const items: NotificationItem[] = [];
  const tenderByCode = new Map(tenders.map((t) => [t.tenderId.toLowerCase(), t]));

  for (const t of tenders) {
    if (
      t.stage === 'Identified / Reviewing' ||
      t.stage === 'Doc Preparation'
    ) {
      const hours = getHoursRemaining(t.submissionDueDate, referenceNow);
      if (hours >= 0 && hours <= 48) {
        const hrsRounded = Math.max(1, Math.round(hours));
        items.push({
          id: `due-${t.id}`,
          category: 'deadline_48h',
          title: `Due in ${hrsRounded}h: ${t.tenderId}`,
          subtitle: `${t.department} · ${t.title}`,
          daysOrHoursLabel: hrsRounded <= 24 ? `${hrsRounded}h left` : `${Math.ceil(hrsRounded / 24)}d left`,
          targetTab: 'tenders',
          targetId: t.id,
        });
      }
    }
  }

  for (const r of emdRecords) {
    const isActive = (ACTIVE_LOCKED_STATUSES as readonly string[]).includes(r.status);
    if (!isActive) continue;

    if (isBgOrFdr(r.instrumentType) && r.expiryDate) {
      const daysLeft = getDaysRemaining(r.expiryDate, referenceNow);
      if (daysLeft <= 30) {
        items.push({
          id: `bg-${r.id}`,
          category: 'bg_expiry_30d',
          title:
            daysLeft < 0
              ? `BG Expired (${Math.abs(daysLeft)}d ago): ${r.referenceNo}`
              : `BG Expiring in ${daysLeft}d: ${r.referenceNo}`,
          subtitle: `${r.tenderId} · ${r.bankName}`,
          daysOrHoursLabel: daysLeft < 0 ? 'Expired' : `${daysLeft}d left`,
          targetTab: 'emdbg',
          targetId: r.id,
        });
      }
    }

    if (!isBgOrFdr(r.instrumentType)) {
      const linked = tenderByCode.get(r.tenderId.toLowerCase());
      if (linked && COMPLETED_TENDER_STAGES.includes(linked.stage)) {
        const refCompletion = linked.completionDate || linked.submissionDueDate;
        const daysPending = -getDaysRemaining(refCompletion, referenceNow);
        if (daysPending > 60) {
          items.push({
            id: `emd-${r.id}`,
            category: 'emd_refund_60d',
            title: `EMD Refund Overdue (${daysPending}d): ${r.tenderId}`,
            subtitle: `${r.department} · ${r.referenceNo}`,
            daysOrHoursLabel: `${daysPending}d pending`,
            targetTab: 'emdbg',
            targetId: r.id,
          });
        }
      }
    }
  }

  return items;
}

export function calculateBidQuote(
  baseCost: number,
  gstPercent: number,
  marginPercent: number,
): {
  marginAmount: number;
  subtotalWithMargin: number;
  gstAmount: number;
  finalBidQuote: number;
} {
  const safeBase = Number.isFinite(baseCost) && baseCost > 0 ? baseCost : 0;
  const safeMargin = Number.isFinite(marginPercent) ? marginPercent : 0;
  const safeGst = Number.isFinite(gstPercent) ? gstPercent : 0;

  const marginAmount = Math.round((safeBase * safeMargin) / 100);
  const subtotalWithMargin = safeBase + marginAmount;
  const gstAmount = Math.round((subtotalWithMargin * safeGst) / 100);
  const finalBidQuote = subtotalWithMargin + gstAmount;

  return {
    marginAmount,
    subtotalWithMargin,
    gstAmount,
    finalBidQuote,
  };
}
