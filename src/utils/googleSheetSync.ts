import type {
  EmdBgRecord,
  GoogleSheetSettings,
  SheetSyncAction,
  SheetSyncEntityType,
  Tender,
} from '../types/crm';
import { ACTIVE_LOCKED_STATUSES } from './calculations';
import { formatMonthLabel, getMonthKey } from './formatters';

export const DEFAULT_GOOGLE_SHEET_SETTINGS: GoogleSheetSettings = {
  enabled: true,
  webhookUrl: '',
  sheetName: 'MIS Monthly Report',
  lastSyncedAt: '',
};

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
  updatedAt: string;
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

  // Already DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;

  // ISO with timezone (Z or +/-HH:MM) -> convert accurately to IST
  if (/(?:Z|[+\-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateInIst(parsed, false);
    }
  }

  // Local YYYY-MM-DD or YYYY-MM-DDTHH:mm
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

  // Already DD/MM/YYYY HH:MM
  if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;

  // ISO with explicit UTC Z or timezone offset -> convert to Asia/Kolkata (IST)
  if (/(?:Z|[+\-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateInIst(parsed, true);
    }
  }

  // Local CRM input YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm (already Indian local wall time)
  const dtMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (dtMatch) {
    return `${dtMatch[3]}/${dtMatch[2]}/${dtMatch[1]} ${dtMatch[4]}:${dtMatch[5]}`;
  }

  // Date-only fallback -> DD/MM/YYYY
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

export function serializeTenderForSheet(
  t: Tender,
  opts?: { serialNo?: number; firmName?: string; assignedOwner?: string },
): SheetTenderRowPayload {
  const latestRemark =
    t.remarks && t.remarks.length > 0 ? t.remarks[t.remarks.length - 1]?.text?.trim() || '' : '';
  const combinedRemarks = [latestRemark, (t.resultInfo || '').trim()].filter(Boolean).join(' | ');
  const isWon = t.stage === 'L1 / Won';
  const isLost = t.stage === 'Lost (L2/L3)';
  const firmLabel = (opts?.firmName || '').trim() || 'Self';
  const ownerLabel = (opts?.assignedOwner || '').trim() || 'Vansh Saxena';
  const locationDepartment = [t.location?.trim(), t.department?.trim()].filter(Boolean).join(' / ');

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
    updatedAt: formatIndianDateTimeForSheet(t.updatedAt || new Date().toISOString()),
  };
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

    const monthKey = getMonthKey(t.submissionDueDate || t.publishDate) || 'Unspecified';
    const existing = monthlyMap.get(monthKey) ?? {
      monthKey,
      monthLabel: monthKey === 'Unspecified' ? 'Unspecified' : formatMonthLabel(monthKey),
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

  const monthlyBreakdown = Array.from(monthlyMap.values()).sort((a, b) =>
    a.monthKey.localeCompare(b.monthKey),
  );

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
  const assignedOwner = (params.assignedOwner || '').trim() || 'Vansh Saxena';
  const triggeredAt = formatIndianDateTimeForSheet(
    params.triggeredAt || new Date().toISOString(),
  );

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
    tenders: params.tenders.map((t, idx) =>
      serializeTenderForSheet(t, { serialNo: idx + 1, firmName, assignedOwner }),
    ),
    emdRecords: params.emdRecords.map(serializeEmdForSheet),
  };
}

export const GOOGLE_APPS_SCRIPT_CODE_GS = `/**
 * Tender Management CRM <-> Google Sheet ("MIS Monthly Report") Real-Time Sync
 * Paste this complete script into Extensions -> Apps Script -> Code.gs,
 * then Deploy -> New deployment -> Web app (Execute as: Me, Who has access: Anyone).
 */

var TAB_TENDERS = 'Daily Tender Data';
var TAB_SUMMARY = 'Monthly MIS Summary';
var TAB_EMD = 'EMD & BG Tracker';

var TENDER_HEADERS = [
  'S.No.',
  'Tender Ref / ID',
  'Client / Organization Name',
  'Location / Department',
  'Location',
  'Brief Description & Scope of Work',
  'Portal / Platform',
  'Publish / Tender Date',
  'Due Date & Time',
  'Pre-Bid Meeting Date',
  'Estimated Tender Value (INR)',
  'EMD Amount (INR)',
  'EMD Mode / Form',
  'Current Status',
  'Technical Opening Date',
  'Financial Opening Date',
  'L1 Bidder Name',
  'L1 Quoted Value (INR)',
  'Our Position / Rank',
  'Assigned Person / Owner',
  'Remarks / Next Action'
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

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var payload = JSON.parse(raw);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tenderSheet = ensureSheetWithHeaders_(ss, TAB_TENDERS, TENDER_HEADERS);
    var summarySheet = ensureSummarySheet_(ss);
    var emdSheet = ensureSheetWithHeaders_(ss, TAB_EMD, EMD_HEADERS);

    var action = String(payload.action || 'UPDATE').toUpperCase();
    var entityType = String(payload.entityType || 'TENDER').toUpperCase();
    var rowsAffected = 0;

    if (action === 'PING') {
      refreshMonthlySummary_(summarySheet, payload);
      return jsonResponse_({
        ok: true,
        ping: true,
        spreadsheetName: ss.getName(),
        message: 'Connected to "' + ss.getName() + '" successfully.'
      });
    }

    if (action === 'FULL_SYNC' || entityType === 'BULK') {
      replaceAllTenderRows_(tenderSheet, payload.tenders || [], payload);
      replaceAllEmdRows_(emdSheet, payload.emdRecords || []);
      rowsAffected = (payload.tenders || []).length + (payload.emdRecords || []).length;
    } else if (entityType === 'TENDER') {
      if (payload.tender) {
        if (action === 'DELETE') {
          rowsAffected += deleteTenderRow_(tenderSheet, payload.tender.tenderId);
        } else {
          upsertTenderRow_(tenderSheet, payload.tender, payload);
          rowsAffected += 1;
        }
      }
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
  var tenderSheet = ensureSheetWithHeaders_(ss, TAB_TENDERS, TENDER_HEADERS);
  var emdSheet = ensureSheetWithHeaders_(ss, TAB_EMD, EMD_HEADERS);
  return jsonResponse_({
    ok: true,
    spreadsheetName: ss.getName(),
    tenderRowCount: Math.max(0, tenderSheet.getLastRow() - 1),
    emdRowCount: Math.max(0, emdSheet.getLastRow() - 1)
  });
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

function ensureSheetWithHeaders_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var needsHeader = firstRow[0] !== headers[0] || firstRow[1] !== headers[1] || firstRow[headers.length - 1] !== headers[headers.length - 1];
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#0F172A')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureSummarySheet_(ss) {
  var sheet = ss.getSheetByName(TAB_SUMMARY);
  if (!sheet) {
    sheet = ss.insertSheet(TAB_SUMMARY);
  }
  return sheet;
}

function tenderToRow_(t, serialNo, payload) {
  var clientName = t.clientName || t.department || '';
  var locationDept = t.locationDepartment || [t.location, t.department].filter(Boolean).join(' / ');
  var owner = t.assignedOwner || (payload && payload.assignedOwner) || 'Vansh Saxena';
  return [
    Number(serialNo || t.serialNo || 1),
    t.tenderId || '',
    clientName,
    locationDept,
    t.location || '',
    t.title || '',
    t.portal || '',
    formatIstDate_(t.publishDate),
    formatIstDateTime_(t.submissionDueDate),
    formatIstDateTime_(t.preBidDate),
    Number(t.estimatedValue || 0),
    Number(t.emdAmount || 0),
    t.emdMode || t.emdStatus || '',
    t.stage || '',
    formatIstDate_(t.technicalOpeningDate),
    formatIstDate_(t.financialOpeningDate || t.completionDate),
    t.l1BidderName || '',
    Number(t.l1QuotedValue !== undefined ? t.l1QuotedValue : (t.quotedValue || 0)),
    t.ourPositionRank || '',
    owner,
    t.remarksNextAction || t.resultInfo || ''
  ];
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

function findTenderRowIndex_(sheet, tenderId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || !tenderId) return -1;
  var vals = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === String(tenderId).trim()) {
      return i + 2;
    }
  }
  return -1;
}

function renumberSerialNumbers_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var count = lastRow - 1;
  var nums = [];
  for (var i = 1; i <= count; i++) {
    nums.push([i]);
  }
  sheet.getRange(2, 1, count, 1).setValues(nums);
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

function upsertTenderRow_(sheet, t, payload) {
  var rowIdx = findTenderRowIndex_(sheet, t.tenderId);
  var serialNo = rowIdx > 1 ? rowIdx - 1 : Math.max(1, sheet.getLastRow());
  var row = tenderToRow_(t, serialNo, payload);
  if (rowIdx > 1) {
    sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    renumberSerialNumbers_(sheet);
  }
}

function upsertEmdRow_(sheet, r) {
  var row = emdToRow_(r);
  var rowIdx = findEmdRowIndex_(sheet, r.id, r.referenceNo);
  if (rowIdx > 1) {
    sheet.getRange(rowIdx, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function deleteTenderRow_(sheet, tenderId) {
  var rowIdx = findTenderRowIndex_(sheet, tenderId);
  if (rowIdx > 1) {
    sheet.deleteRow(rowIdx);
    renumberSerialNumbers_(sheet);
    return 1;
  }
  return 0;
}

function deleteEmdRowById_(sheet, idValue, secondaryCode) {
  var rowIdx = findEmdRowIndex_(sheet, idValue, secondaryCode);
  if (rowIdx > 1) {
    sheet.deleteRow(rowIdx);
    return 1;
  }
  return 0;
}

function replaceAllTenderRows_(sheet, tenders, payload) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, TENDER_HEADERS.length).clearContent();
  }
  if (!tenders || tenders.length === 0) return;
  var rows = tenders.map(function (t, idx) {
    return tenderToRow_(t, idx + 1, payload);
  });
  sheet.getRange(2, 1, rows.length, TENDER_HEADERS.length).setValues(rows);
}

function replaceAllEmdRows_(sheet, records) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, EMD_HEADERS.length).clearContent();
  }
  if (!records || records.length === 0) return;
  var rows = records.map(emdToRow_);
  sheet.getRange(2, 1, rows.length, EMD_HEADERS.length).setValues(rows);
}

function refreshMonthlySummary_(sheet, payload) {
  var s = payload.summary || {};
  sheet.clearContents();

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
    'Month',
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
