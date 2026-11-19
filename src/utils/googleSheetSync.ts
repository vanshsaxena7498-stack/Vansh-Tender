import type {
  EmdBgRecord,
  GoogleSheetSettings,
  SheetSyncAction,
  SheetSyncEntityType,
  Tender,
} from '../types/crm';
import { ACTIVE_LOCKED_STATUSES } from './calculations';
import { getLatestRemarkText } from './formatters';

export const DEFAULT_GOOGLE_SHEET_SETTINGS: GoogleSheetSettings = {
  enabled: true,
  webhookUrl: '',
  sheetName: 'MIS Monthly Report',
  lastSyncedAt: '',
};

export const MIS_MONTHLY_TENDER_HEADERS = [
  'S.No.',
  'Tender ID / Bid No.',
  'Portal / Source',
  'Department / Organization',
  'District / State',
  'Item Category',
  'Work / Supply Title',
  'Publish Date',
  'Submission Due Date',
] as const;

export const MIS_MONTH_GAP_ROWS = 3;

const FULL_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface SheetMonthlyBreakdownRow {
  monthKey: string;
  monthLabel: string;
  total: number;
  inPreparation: number;
  submitted: number;
  awarded: number;
  rejectedLost: number;
  estimatedValue: number;
  quotedValue: number;
}

export interface SheetMonthlySummaryMetrics {
  totalTenders: number;
  inPreparationCount: number;
  submittedCount: number;
  awardedCount: number;
  rejectedLostCount: number;
  totalEstimatedValue: number;
  totalQuotedValue: number;
  awardedValue: number;
  totalEmdRecords: number;
  activeEmdLockedAmount: number;
  refundAppliedAmount: number;
  releasedAmount: number;
  monthlyBreakdown: SheetMonthlyBreakdownRow[];
}

export interface SheetTenderRowPayload {
  serialNo?: number;
  id: string;
  tenderId: string;
  portal: string;
  department: string;
  clientName: string;
  locationDepartment: string;
  location: string;
  category: string;
  title: string;
  publishDate: string;
  submissionDueDate: string;
  preBidDate: string;
  completionDate: string;
  stage: string;
  estimatedValue: number;
  quotedValue: number;
  emdStatus: string;
  emdMode: string;
  emdAmount: number;
  technicalOpeningDate: string;
  financialOpeningDate: string;
  l1BidderName: string;
  l1QuotedValue: number;
  ourPositionRank: string;
  assignedOwner: string;
  remarksNextAction: string;
  resultInfo: string;
  lastUpdatedAt: string;
  updatedAt: string;
}

export interface SheetMonthlyMisBlock {
  monthKey: string;
  monthLabel: string;
  rows: SheetTenderRowPayload[];
}

export interface SheetEmdRowPayload {
  id: string;
  tenderRefId: string;
  tenderId: string;
  department: string;
  instrumentType: string;
  referenceNo: string;
  bankName: string;
  amount: number;
  issueDate: string;
  expiryDate: string;
  claimEndDate: string;
  status: string;
  refundDate: string;
  refundRef: string;
  remarks: string;
}

export interface GoogleSheetSyncPayload {
  action: SheetSyncAction;
  entityType: SheetSyncEntityType;
  sheetName: string;
  firmName: string;
  assignedOwner: string;
  triggeredAt: string;
  tender: SheetTenderRowPayload | null;
  emdRecord: SheetEmdRowPayload | null;
  summary: SheetMonthlySummaryMetrics;
  monthlyBlocks: SheetMonthlyMisBlock[];
  tenders: SheetTenderRowPayload[];
  emdRecords: SheetEmdRowPayload[];
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateInIst(date: Date, includeTime: boolean): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(includeTime
      ? {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }
      : {}),
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  const ddmmyyyy = `${map.day || '01'}/${map.month || '01'}/${map.year || '2026'}`;
  if (!includeTime) return ddmmyyyy;
  const hh = map.hour === '24' ? '00' : map.hour || '00';
  const mm = map.minute || '00';
  return `${ddmmyyyy} ${hh}:${mm}`;
}

/**
 * Formats YYYY-MM-DD, YYYY-MM-DDTHH:mm, or ISO UTC string into Indian DD/MM/YYYY format.
 */
export function formatIndianDateForSheet(rawDate?: string | null): string {
  const trimmed = (rawDate || '').trim();
  if (!trimmed) return '';

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;

  if (/(?:Z|[+\-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateInIst(parsed, false);
    }
  }

  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateInIst(parsed, false);
  }
  return trimmed;
}

/**
 * Formats datetime into Indian DD/MM/YYYY HH:MM (24-hour IST) format.
 */
export function formatIndianDateTimeForSheet(rawDateTime?: string | null): string {
  const trimmed = (rawDateTime || '').trim();
  if (!trimmed) return '';

  if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;

  if (/(?:Z|[+\-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateInIst(parsed, true);
    }
  }

  const dtMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (dtMatch) {
    return `${dtMatch[3]}/${dtMatch[2]}/${dtMatch[1]} ${dtMatch[4]}:${dtMatch[5]}`;
  }

  const dMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dMatch) {
    return `${dMatch[3]}/${dMatch[2]}/${dMatch[1]}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const hh = pad2(parsed.getHours());
    const mm = pad2(parsed.getMinutes());
    return `${formatDateInIst(parsed, false)} ${hh}:${mm}`;
  }

  return trimmed;
}

/**
 * Validates that a Webhook URL points to an HTTPS Google Apps Script web app endpoint.
 */
export function isValidAppsScriptWebhookUrl(rawUrl: string): boolean {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed || trimmed.length > 500) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'script.google.com') {
      return parsed.pathname.startsWith('/macros/');
    }
    if (host === 'script.googleusercontent.com') {
      return parsed.pathname.startsWith('/macros/');
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Prioritizes `lastUpdatedAt` / `updatedAt` interaction timestamp, falling back to `publishDate`.
 */
export function getTenderInteractionTimestamp(
  t: Pick<Tender, 'publishDate'> & { lastUpdatedAt?: string; updatedAt?: string },
): string {
  const lastUpdated = (t.lastUpdatedAt || '').trim();
  if (lastUpdated) return lastUpdated;
  const updated = (t.updatedAt || '').trim();
  if (updated) return updated;
  return (t.publishDate || '').trim();
}

/**
 * Extracts chronological `YYYY-MM` key in IST (`Asia/Kolkata`) from a timestamp or date string.
 */
export function getMonthKeyInIst(rawTimestamp?: string | null): string {
  const trimmed = (rawTimestamp || '').trim();
  if (!trimmed) return 'Unspecified';

  // ISO timestamp with timezone offset or Z -> convert to Asia/Kolkata
  if (/(?:Z|[+\-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
      }).formatToParts(parsed);
      const year = parts.find((p) => p.type === 'year')?.value;
      const month = parts.find((p) => p.type === 'month')?.value;
      if (year && month) return `${year}-${month}`;
    }
  }

  // ISO/local YYYY-MM or YYYY-MM-DD
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2]}`;
  }

  // Indian DD/MM/YYYY
  const dmyMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2]}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(parsed);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    if (year && month) return `${year}-${month}`;
  }

  return 'Unspecified';
}

export function getTenderInteractionMonthKey(
  t: Pick<Tender, 'publishDate'> & { lastUpdatedAt?: string; updatedAt?: string },
): string {
  return getMonthKeyInIst(getTenderInteractionTimestamp(t));
}

/**
 * Converts `2026-11` into `November 2026`.
 */
export function formatFullMonthYearLabel(monthKey: string): string {
  const match = (monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey || 'Unspecified';
  const year = match[1];
  const monthIdx = Number(match[2]) - 1;
  const monthName = FULL_MONTH_NAMES[monthIdx];
  return monthName ? `${monthName} ${year}` : monthKey;
}

function getTimestampSortEpoch(rawTimestamp?: string | null): number {
  const trimmed = (rawTimestamp || '').trim();
  if (!trimmed) return Number.MAX_SAFE_INTEGER;
  const dmyMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (dmyMatch) {
    const [, dd, mm, yyyy, hh = '00', min = '00'] = dmyMatch;
    const parsed = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

export function serializeTenderForSheet(
  t: Tender,
  opts?: { serialNo?: number; firmName?: string; assignedOwner?: string },
): SheetTenderRowPayload {
  const latestRemark = getLatestRemarkText(t.remarks);
  const combinedRemarks = [latestRemark, (t.resultInfo || '').trim()].filter(Boolean).join(' | ');
  const isWon = t.stage === 'L1 / Won';
  const isLost = t.stage === 'Lost (L2/L3)';
  const firmLabel = (opts?.firmName || '').trim() || 'Self';
  const ownerLabel = (opts?.assignedOwner || '').trim() || 'Tender Owner';
  const locationDepartment = [t.location?.trim(), t.department?.trim()].filter(Boolean).join(' / ');
  const rawInteractionTimestamp = getTenderInteractionTimestamp(t);

  return {
    ...(typeof opts?.serialNo === 'number' ? { serialNo: opts.serialNo } : {}),
    id: t.id,
    tenderId: t.tenderId,
    portal: t.portal,
    department: t.department,
    clientName: t.department,
    locationDepartment,
    location: t.location || '',
    category: t.category || '',
    title: t.title,
    publishDate: formatIndianDateForSheet(t.publishDate),
    submissionDueDate: formatIndianDateTimeForSheet(t.submissionDueDate),
    preBidDate: formatIndianDateTimeForSheet(t.preBidDate),
    completionDate: formatIndianDateForSheet(t.completionDate),
    stage: t.stage,
    estimatedValue: Number.isFinite(t.estimatedValue) ? t.estimatedValue : 0,
    quotedValue: Number.isFinite(t.quotedValue) ? t.quotedValue : 0,
    emdStatus: t.emdStatus,
    emdMode: t.emdStatus,
    emdAmount: Number.isFinite(t.emdAmount) ? t.emdAmount : 0,
    technicalOpeningDate:
      t.stage === 'Technical Eval' && t.completionDate
        ? formatIndianDateForSheet(t.completionDate)
        : '',
    financialOpeningDate: t.completionDate ? formatIndianDateForSheet(t.completionDate) : '',
    l1BidderName: isWon ? firmLabel : '',
    l1QuotedValue: Number.isFinite(t.quotedValue) ? t.quotedValue : 0,
    ourPositionRank: isWon ? 'L1' : isLost ? 'L2 / L3' : '',
    assignedOwner: ownerLabel,
    remarksNextAction: combinedRemarks,
    resultInfo: t.resultInfo || '',
    lastUpdatedAt: rawInteractionTimestamp,
    updatedAt: formatIndianDateTimeForSheet(rawInteractionTimestamp),
  };
}

/**
 * Groups all tenders chronologically by Month & Year of their last interaction/update timestamp
 * (`lastUpdatedAt` / `updatedAt`, falling back to `publishDate`), numbering S.No. from 1 freshly per month.
 */
export function groupTendersByInteractionMonth(
  tenders: Tender[],
  opts?: { firmName?: string; assignedOwner?: string },
): SheetMonthlyMisBlock[] {
  const bucketMap = new Map<string, Tender[]>();

  for (const t of tenders) {
    const monthKey = getTenderInteractionMonthKey(t);
    const list = bucketMap.get(monthKey);
    if (list) {
      list.push(t);
    } else {
      bucketMap.set(monthKey, [t]);
    }
  }

  const sortedMonthKeys = Array.from(bucketMap.keys()).sort((a, b) => {
    if (a === 'Unspecified') return 1;
    if (b === 'Unspecified') return -1;
    return a.localeCompare(b);
  });

  return sortedMonthKeys.map((monthKey) => {
    const items = [...(bucketMap.get(monthKey) ?? [])].sort((a, b) => {
      const epochDiff =
        getTimestampSortEpoch(getTenderInteractionTimestamp(a)) -
        getTimestampSortEpoch(getTenderInteractionTimestamp(b));
      if (epochDiff !== 0) return epochDiff;
      return a.tenderId.localeCompare(b.tenderId);
    });

    const rows = items.map((item, idx) =>
      serializeTenderForSheet(item, {
        serialNo: idx + 1,
        firmName: opts?.firmName,
        assignedOwner: opts?.assignedOwner,
      }),
    );

    return {
      monthKey,
      monthLabel: formatFullMonthYearLabel(monthKey),
      rows,
    };
  });
}

export function serializeEmdForSheet(r: EmdBgRecord): SheetEmdRowPayload {
  return {
    id: r.id,
    tenderRefId: r.tenderRefId || '',
    tenderId: r.tenderId,
    department: r.department,
    instrumentType: r.instrumentType,
    referenceNo: r.referenceNo,
    bankName: r.bankName,
    amount: Number.isFinite(r.amount) ? r.amount : 0,
    issueDate: formatIndianDateForSheet(r.issueDate),
    expiryDate: formatIndianDateForSheet(r.expiryDate),
    claimEndDate: formatIndianDateForSheet(r.claimEndDate),
    status: r.status,
    refundDate: formatIndianDateForSheet(r.refundDate),
    refundRef: r.refundRef || '',
    remarks: r.remarks || '',
  };
}

export function classifyStageForSheetSummary(
  stage: Tender['stage'],
): 'inPreparation' | 'submitted' | 'awarded' | 'rejectedLost' {
  if (stage === 'Identified / Reviewing' || stage === 'Doc Preparation') {
    return 'inPreparation';
  }
  if (
    stage === 'Submitted' ||
    stage === 'Technical Eval' ||
    stage === 'Financial / BOQ Eval'
  ) {
    return 'submitted';
  }
  if (stage === 'L1 / Won') {
    return 'awarded';
  }
  return 'rejectedLost';
}

export function computeMonthlySummaryForSheet(
  tenders: Tender[],
  emdRecords: EmdBgRecord[],
): SheetMonthlySummaryMetrics {
  let inPreparationCount = 0;
  let submittedCount = 0;
  let awardedCount = 0;
  let rejectedLostCount = 0;
  let totalEstimatedValue = 0;
  let totalQuotedValue = 0;
  let awardedValue = 0;

  const monthlyMap = new Map<string, SheetMonthlyBreakdownRow>();

  for (const t of tenders) {
    const bucket = classifyStageForSheetSummary(t.stage);
    const est = Number.isFinite(t.estimatedValue) ? t.estimatedValue : 0;
    const quoted = Number.isFinite(t.quotedValue) ? t.quotedValue : 0;

    if (bucket === 'inPreparation') inPreparationCount += 1;
    else if (bucket === 'submitted') submittedCount += 1;
    else if (bucket === 'awarded') {
      awardedCount += 1;
      awardedValue += quoted > 0 ? quoted : est;
    } else {
      rejectedLostCount += 1;
    }

    totalEstimatedValue += est;
    totalQuotedValue += quoted;

    const monthKey = getTenderInteractionMonthKey(t);
    const existing = monthlyMap.get(monthKey) ?? {
      monthKey,
      monthLabel: formatFullMonthYearLabel(monthKey),
      total: 0,
      inPreparation: 0,
      submitted: 0,
      awarded: 0,
      rejectedLost: 0,
      estimatedValue: 0,
      quotedValue: 0,
    };

    existing.total += 1;
    existing[bucket] += 1;
    existing.estimatedValue += est;
    existing.quotedValue += quoted;
    monthlyMap.set(monthKey, existing);
  }

  let activeEmdLockedAmount = 0;
  let refundAppliedAmount = 0;
  let releasedAmount = 0;

  for (const r of emdRecords) {
    const amt = Number.isFinite(r.amount) ? r.amount : 0;
    if ((ACTIVE_LOCKED_STATUSES as readonly string[]).includes(r.status)) {
      activeEmdLockedAmount += amt;
    }
    if (r.status === 'Refund / Release Applied') {
      refundAppliedAmount += amt;
    }
    if (r.status === 'Refunded / Released') {
      releasedAmount += amt;
    }
  }

  const monthlyBreakdown = Array.from(monthlyMap.values()).sort((a, b) => {
    if (a.monthKey === 'Unspecified') return 1;
    if (b.monthKey === 'Unspecified') return -1;
    return a.monthKey.localeCompare(b.monthKey);
  });

  return {
    totalTenders: tenders.length,
    inPreparationCount,
    submittedCount,
    awardedCount,
    rejectedLostCount,
    totalEstimatedValue,
    totalQuotedValue,
    awardedValue,
    totalEmdRecords: emdRecords.length,
    activeEmdLockedAmount,
    refundAppliedAmount,
    releasedAmount,
    monthlyBreakdown,
  };
}

export function buildSheetSyncPayload(params: {
  action: SheetSyncAction;
  entityType: SheetSyncEntityType;
  sheetName?: string;
  firmName?: string;
  assignedOwner?: string;
  tender?: Tender | null;
  emdRecord?: EmdBgRecord | null;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  triggeredAt?: string;
}): GoogleSheetSyncPayload {
  const firmName = (params.firmName || '').trim() || 'Corporate Tender Desk';
  const assignedOwner = (params.assignedOwner || '').trim() || 'Tender Owner';
  const triggeredAt = formatIndianDateTimeForSheet(
    params.triggeredAt || new Date().toISOString(),
  );
  const monthlyBlocks = groupTendersByInteractionMonth(params.tenders, {
    firmName,
    assignedOwner,
  });

  const flattenedTenders = monthlyBlocks.flatMap((block) => block.rows);

  return {
    action: params.action,
    entityType: params.entityType,
    sheetName: (params.sheetName || '').trim() || 'MIS Monthly Report',
    firmName,
    assignedOwner,
    triggeredAt,
    tender: params.tender
      ? serializeTenderForSheet(params.tender, { firmName, assignedOwner })
      : null,
    emdRecord: params.emdRecord ? serializeEmdForSheet(params.emdRecord) : null,
    summary: computeMonthlySummaryForSheet(params.tenders, params.emdRecords),
    monthlyBlocks,
    tenders: flattenedTenders,
    emdRecords: params.emdRecords.map(serializeEmdForSheet),
  };
}

export const GOOGLE_APPS_SCRIPT_CODE_GS = `/**
 * Tender Management CRM <-> Google Sheet ("MIS Monthly Report") Real-Time Sync
 * Paste this complete script into Extensions -> Apps Script -> Code.gs,
 * then Deploy -> New deployment -> Web app (Execute as: Me, Who has access: Anyone).
 *
 * Features:
 * - Zero frozen rows (frozenRowCount = 0 / setFrozenRows(0)). No stuck top header row.
 * - Groups all CRM tenders chronologically by Month & Year of their lastUpdatedAt / updatedAt timestamp
 *   (falling back to Publish Date only when no update timestamp is present).
 * - Renders clean Monthly MIS Blocks:
 *   1) Merged Banner Row (Column A to Column I, #000000 background, centered bold white Month & Year)
 *   2) Dark Navy/Black Header Row directly below Banner
 *   3) Data Rows with S.No. freshly starting at 1, 2, 3... inside each month
 *   4) Leaves 3 blank rows between different monthly blocks
 */

var TAB_TENDERS = 'Daily Tender Data';
var TAB_SUMMARY = 'Monthly MIS Summary';
var TAB_EMD = 'EMD & BG Tracker';
var BLANK_GAP_ROWS_BETWEEN_MONTHS = 3;

var MIS_MONTHLY_HEADERS = [
  'S.No.',
  'Tender ID / Bid No.',
  'Portal / Source',
  'Department / Organization',
  'District / State',
  'Item Category',
  'Work / Supply Title',
  'Publish Date',
  'Submission Due Date'
];

var EMD_HEADERS = [
  'Record ID',
  'Linked Tender ID',
  'Department',
  'Instrument Type',
  'Reference / BG No.',
  'Bank Name',
  'Amount (INR)',
  'Issue Date (DD/MM/YYYY)',
  'Expiry Date (DD/MM/YYYY)',
  'Claim End Date (DD/MM/YYYY)',
  'Status',
  'Refund Date (DD/MM/YYYY)',
  'Refund Ref',
  'Remarks'
];

var FULL_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var payload = JSON.parse(raw);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tenderSheet = getOrCreateSheet_(ss, TAB_TENDERS);
    var summarySheet = getOrCreateSheet_(ss, TAB_SUMMARY);
    var emdSheet = getOrCreateSheet_(ss, TAB_EMD);

    // Explicitly enforce zero frozen rows across sheets
    tenderSheet.setFrozenRows(0);
    summarySheet.setFrozenRows(0);
    emdSheet.setFrozenRows(0);

    var action = String(payload.action || 'UPDATE').toUpperCase();
    var entityType = String(payload.entityType || 'TENDER').toUpperCase();
    var rowsAffected = 0;

    if (action === 'PING') {
      if ((payload.monthlyBlocks && payload.monthlyBlocks.length > 0) || (payload.tenders && payload.tenders.length > 0)) {
        rewriteMonthlyMisSheet_(tenderSheet, payload);
      }
      refreshMonthlySummary_(summarySheet, payload);
      return jsonResponse_({
        ok: true,
        ping: true,
        spreadsheetName: ss.getName(),
        message: 'Connected to "' + ss.getName() + '" successfully.'
      });
    }

    // Rewrite clean Monthly MIS Blocks whenever tenders are synced (CREATE, UPDATE, DELETE, FULL_SYNC, BULK)
    if (action === 'FULL_SYNC' || entityType === 'BULK' || entityType === 'TENDER') {
      rowsAffected += rewriteMonthlyMisSheet_(tenderSheet, payload);
    }

    if (action === 'FULL_SYNC' || entityType === 'BULK') {
      replaceAllEmdRows_(emdSheet, payload.emdRecords || []);
      rowsAffected += (payload.emdRecords || []).length;
    } else if (entityType === 'TENDER') {
      if (payload.emdRecord) {
        upsertEmdRow_(emdSheet, payload.emdRecord);
        rowsAffected += 1;
      }
    } else if (entityType === 'EMD_BG') {
      if (payload.emdRecord) {
        if (action === 'DELETE') {
          rowsAffected += deleteEmdRowById_(emdSheet, payload.emdRecord.id, payload.emdRecord.referenceNo);
        } else {
          upsertEmdRow_(emdSheet, payload.emdRecord);
          rowsAffected += 1;
        }
      }
    }

    refreshMonthlySummary_(summarySheet, payload);

    return jsonResponse_({
      ok: true,
      action: action,
      entityType: entityType,
      rowsAffected: rowsAffected,
      spreadsheetName: ss.getName(),
      syncedAt: new Date().toISOString()
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tenderSheet = getOrCreateSheet_(ss, TAB_TENDERS);
  var emdSheet = getOrCreateSheet_(ss, TAB_EMD);
  tenderSheet.setFrozenRows(0);
  emdSheet.setFrozenRows(0);
  return jsonResponse_({
    ok: true,
    spreadsheetName: ss.getName(),
    tenderRowCount: tenderSheet.getLastRow(),
    emdRowCount: Math.max(0, emdSheet.getLastRow() - 1)
  });
}

function getOrCreateSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function formatIstDate_(val) {
  if (!val) return '';
  var s = String(val).trim();
  if (/^\\d{2}\\/\\d{2}\\/\\d{4}/.test(s)) return s;
  if (/(?:Z|[+\\-]\\d{2}:?\\d{2})$/i.test(s)) {
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'Asia/Kolkata', 'dd/MM/yyyy');
    }
  }
  var m = s.match(/^(\\d{4})-(\\d{2})-(\\d{2})/);
  if (m) return m[3] + '/' + m[2] + '/' + m[1];
  return s;
}

function formatIstDateTime_(val) {
  if (!val) return '';
  var s = String(val).trim();
  if (/^\\d{2}\\/\\d{2}\\/\\d{4}/.test(s)) return s;
  if (/(?:Z|[+\\-]\\d{2}:?\\d{2})$/i.test(s)) {
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'Asia/Kolkata', 'dd/MM/yyyy HH:mm');
    }
  }
  var dt = s.match(/^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})/);
  if (dt) return dt[3] + '/' + dt[2] + '/' + dt[1] + ' ' + dt[4] + ':' + dt[5];
  var dOnly = s.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (dOnly) return dOnly[3] + '/' + dOnly[2] + '/' + dOnly[1];
  return s;
}

function getInteractionTimestamp_(t) {
  if (t.lastUpdatedAt && String(t.lastUpdatedAt).trim()) {
    return String(t.lastUpdatedAt).trim();
  }
  if (t.updatedAt && String(t.updatedAt).trim()) {
    return String(t.updatedAt).trim();
  }
  if (t.publishDate && String(t.publishDate).trim()) {
    return String(t.publishDate).trim();
  }
  return '';
}

function getInteractionMonthKey_(rawVal) {
  var s = String(rawVal || '').trim();
  if (!s) return 'Unspecified';

  if (/(?:Z|[+\\-]\\d{2}:?\\d{2})$/i.test(s)) {
    var isoDate = new Date(s);
    if (!isNaN(isoDate.getTime())) {
      return Utilities.formatDate(isoDate, 'Asia/Kolkata', 'yyyy-MM');
    }
  }

  var ymd = s.match(/^(\\d{4})-(\\d{2})/);
  if (ymd) return ymd[1] + '-' + ymd[2];

  var dmy = s.match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})/);
  if (dmy) return dmy[3] + '-' + dmy[2];

  var fallback = new Date(s);
  if (!isNaN(fallback.getTime())) {
    return Utilities.formatDate(fallback, 'Asia/Kolkata', 'yyyy-MM');
  }
  return 'Unspecified';
}

function formatFullMonthLabel_(monthKey) {
  var m = String(monthKey || '').match(/^(\\d{4})-(\\d{2})$/);
  if (!m) return monthKey || 'Unspecified';
  var idx = Number(m[2]) - 1;
  var name = FULL_MONTH_NAMES[idx];
  return name ? name + ' ' + m[1] : monthKey;
}

function timestampEpoch_(rawVal) {
  var s = String(rawVal || '').trim();
  if (!s) return 9e15;
  var dmy = s.match(/^(\\d{2})\\/(\\d{2})\\/(\\d{4})(?:\\s+(\\d{2}):(\\d{2}))?/);
  if (dmy) {
    var isoLike = dmy[3] + '-' + dmy[2] + '-' + dmy[1] + 'T' + (dmy[4] || '00') + ':' + (dmy[5] || '00') + ':00+05:30';
    var parsedDmy = Date.parse(isoLike);
    if (!isNaN(parsedDmy)) return parsedDmy;
  }
  var parsed = Date.parse(s);
  return isNaN(parsed) ? 9e15 : parsed;
}

function buildMonthlyBlocksFromPayload_(payload) {
  if (payload && Array.isArray(payload.monthlyBlocks) && payload.monthlyBlocks.length > 0) {
    return payload.monthlyBlocks;
  }

  var tenders = (payload && Array.isArray(payload.tenders)) ? payload.tenders : [];
  if (tenders.length === 0) return [];

  var grouped = {};
  for (var i = 0; i < tenders.length; i++) {
    var t = tenders[i];
    var ts = getInteractionTimestamp_(t);
    var monthKey = getInteractionMonthKey_(ts);
    if (!grouped[monthKey]) grouped[monthKey] = [];
    grouped[monthKey].push(t);
  }

  var keys = Object.keys(grouped).sort(function (a, b) {
    if (a === 'Unspecified') return 1;
    if (b === 'Unspecified') return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  return keys.map(function (monthKey) {
    var items = grouped[monthKey].slice().sort(function (a, b) {
      var diff = timestampEpoch_(getInteractionTimestamp_(a)) - timestampEpoch_(getInteractionTimestamp_(b));
      if (diff !== 0) return diff;
      return String(a.tenderId || '').localeCompare(String(b.tenderId || ''));
    });

    return {
      monthKey: monthKey,
      monthLabel: formatFullMonthLabel_(monthKey),
      rows: items
    };
  });
}

function rewriteMonthlyMisSheet_(sheet, payload) {
  var totalCols = MIS_MONTHLY_HEADERS.length; // 9 columns (Column A to Column I)
  var existingLastRow = sheet.getLastRow();
  var existingLastCol = Math.max(sheet.getLastColumn(), totalCols);

  // Break any previously merged month banners and clear all content & formatting
  if (existingLastRow > 0 && existingLastCol > 0) {
    sheet.getRange(1, 1, existingLastRow, existingLastCol).breakApart();
  }
  sheet.clear();
  sheet.setFrozenRows(0);

  var blocks = buildMonthlyBlocksFromPayload_(payload);
  if (!blocks || blocks.length === 0) {
    return 0;
  }

  var currentRow = 1;
  var totalWritten = 0;

  for (var b = 0; b < blocks.length; b++) {
    var block = blocks[b];
    var items = block.rows || [];
    if (items.length === 0) continue;

    // 1. Month Banner Row: Merged Column A to Column I, solid black (#000000), centered bold white text
    var bannerRange = sheet.getRange(currentRow, 1, 1, totalCols);
    bannerRange.merge();
    bannerRange
      .setValue(block.monthLabel || formatFullMonthLabel_(block.monthKey))
      .setBackground('#000000')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold')
      .setFontSize(12)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setRowHeight(currentRow, 30);
    currentRow += 1;

    // 2. Column Header Row directly below banner: Dark navy/black with bold white text
    var headerRange = sheet.getRange(currentRow, 1, 1, totalCols);
    headerRange
      .setValues([MIS_MONTHLY_HEADERS])
      .setBackground('#0F172A')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold')
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle');
    headerRange.setBorder(true, true, true, true, true, true, '#334155', SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(currentRow, 1, 1, 1).setHorizontalAlignment('center');
    sheet.setRowHeight(currentRow, 26);
    currentRow += 1;

    // 3. Data Rows: Fresh S.No. (1, 2, 3...) per month
    var dataRows = [];
    for (var r = 0; r < items.length; r++) {
      var t = items[r];
      dataRows.push([
        r + 1,
        t.tenderId || '',
        t.portal || '',
        t.department || t.clientName || '',
        t.location || '',
        t.category || '',
        t.title || '',
        formatIstDate_(t.publishDate),
        formatIstDateTime_(t.submissionDueDate)
      ]);
    }

    var dataRange = sheet.getRange(currentRow, 1, dataRows.length, totalCols);
    dataRange
      .setValues(dataRows)
      .setBackground('#FFFFFF')
      .setFontColor('#0F172A')
      .setFontWeight('normal')
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle')
      .setWrap(true);
    dataRange.setBorder(true, true, true, true, true, true, '#CBD5E1', SpreadsheetApp.BorderStyle.SOLID);
    sheet.getRange(currentRow, 1, dataRows.length, 1).setHorizontalAlignment('center');

    totalWritten += dataRows.length;
    currentRow += dataRows.length;

    // 4. Leave 3 blank rows between different monthly blocks
    if (b < blocks.length - 1) {
      currentRow += BLANK_GAP_ROWS_BETWEEN_MONTHS;
    }
  }

  sheet.autoResizeColumns(1, totalCols);
  return totalWritten;
}

function ensureEmdHeaders_(sheet) {
  sheet.setFrozenRows(0);
  var firstRow = sheet.getRange(1, 1, 1, EMD_HEADERS.length).getValues()[0];
  var needsHeader =
    firstRow[0] !== EMD_HEADERS[0] ||
    firstRow[1] !== EMD_HEADERS[1] ||
    firstRow[EMD_HEADERS.length - 1] !== EMD_HEADERS[EMD_HEADERS.length - 1];

  if (needsHeader) {
    sheet.getRange(1, 1, 1, EMD_HEADERS.length)
      .setValues([EMD_HEADERS])
      .setBackground('#0F172A')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
  }
}

function emdToRow_(r) {
  return [
    r.id || '',
    r.tenderId || '',
    r.department || '',
    r.instrumentType || '',
    r.referenceNo || '',
    r.bankName || '',
    Number(r.amount || 0),
    formatIstDate_(r.issueDate),
    formatIstDate_(r.expiryDate),
    formatIstDate_(r.claimEndDate),
    r.status || '',
    formatIstDate_(r.refundDate),
    r.refundRef || '',
    r.remarks || ''
  ];
}

function findEmdRowIndex_(sheet, idValue, secondaryCode) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var vals = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (idValue && String(vals[i][0]) === String(idValue)) {
      return i + 2;
    }
  }
  if (secondaryCode) {
    for (var j = 0; j < vals.length; j++) {
      if (String(vals[j][4]) === String(secondaryCode)) {
        return j + 2;
      }
    }
  }
  return -1;
}

function upsertEmdRow_(sheet, r) {
  ensureEmdHeaders_(sheet);
  var row = emdToRow_(r);
  var rowIdx = findEmdRowIndex_(sheet, r.id, r.referenceNo);
  if (rowIdx > 1) {
    sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function deleteEmdRowById_(sheet, idValue, secondaryCode) {
  ensureEmdHeaders_(sheet);
  var rowIdx = findEmdRowIndex_(sheet, idValue, secondaryCode);
  if (rowIdx > 1) {
    sheet.deleteRow(rowIdx);
    return 1;
  }
  return 0;
}

function replaceAllEmdRows_(sheet, records) {
  sheet.clear();
  sheet.setFrozenRows(0);
  sheet.getRange(1, 1, 1, EMD_HEADERS.length)
    .setValues([EMD_HEADERS])
    .setBackground('#0F172A')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');

  if (!records || records.length === 0) return;
  var rows = records.map(emdToRow_);
  sheet.getRange(2, 1, rows.length, EMD_HEADERS.length).setValues(rows);
}

function refreshMonthlySummary_(sheet, payload) {
  var s = payload.summary || {};
  sheet.clear();
  sheet.setFrozenRows(0);

  var kpiRows = [
    ['MIS Monthly Report - Executive Summary', payload.firmName || 'Corporate Tender Desk'],
    ['', ''],
    ['Pipeline Metric', 'Value'],
    ['Total Tracked Tenders', Number(s.totalTenders || 0)],
    ['In Preparation (Identified + Doc Prep)', Number(s.inPreparationCount || 0)],
    ['Submitted / Under Evaluation', Number(s.submittedCount || 0)],
    ['Awarded (L1 / Won)', Number(s.awardedCount || 0)],
    ['Rejected / Lost / Not Filled', Number(s.rejectedLostCount || 0)],
    ['Total Estimated Value (INR)', Number(s.totalEstimatedValue || 0)],
    ['Total Quoted Bid Value (INR)', Number(s.totalQuotedValue || 0)],
    ['Awarded Won Value (INR)', Number(s.awardedValue || 0)],
    ['', ''],
    ['EMD & BG Summary', 'Amount / Count'],
    ['Total EMD / BG Instruments', Number(s.totalEmdRecords || 0)],
    ['Active Locked Capital (INR)', Number(s.activeEmdLockedAmount || 0)],
    ['Refund Applied / Pending (INR)', Number(s.refundAppliedAmount || 0)],
    ['Safely Released / Refunded (INR)', Number(s.releasedAmount || 0)]
  ];

  sheet.getRange(1, 1, kpiRows.length, 2).setValues(kpiRows);
  sheet.getRange(1, 1, 1, 2).setBackground('#1E3A8A').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange(3, 1, 1, 2).setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.getRange(13, 1, 1, 2).setBackground('#0F172A').setFontColor('#FFFFFF').setFontWeight('bold');

  var breakdownStart = kpiRows.length + 2;
  var monthlyHeaders = [
    'Last Interaction Month',
    'Total Tenders',
    'In Preparation',
    'Submitted',
    'Awarded',
    'Rejected / Lost',
    'Estimated Value (INR)',
    'Quoted Value (INR)'
  ];
  sheet.getRange(breakdownStart, 1, 1, monthlyHeaders.length)
    .setValues([monthlyHeaders])
    .setBackground('#0F172A')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');

  var months = s.monthlyBreakdown || [];
  if (months.length > 0) {
    var mRows = months.map(function (m) {
      return [
        m.monthLabel || m.monthKey || '',
        Number(m.total || 0),
        Number(m.inPreparation || 0),
        Number(m.submitted || 0),
        Number(m.awarded || 0),
        Number(m.rejectedLost || 0),
        Number(m.estimatedValue || 0),
        Number(m.quotedValue || 0)
      ];
    });
    sheet.getRange(breakdownStart + 1, 1, mRows.length, monthlyHeaders.length).setValues(mRows);
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
