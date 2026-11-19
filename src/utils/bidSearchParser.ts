import type {
  AttachmentItem,
  ChecklistItem,
  EmdSecurityType,
  ExtractedBidDraft,
  PortalType,
  Tender,
  TenderStage,
} from '../types/crm';

export const DEFAULT_TENDER_ATTACHMENT_1_LABEL = 'Attachment 1 · NIT / Tender Document';

const DEFAULT_CHECKLIST_LABELS: string[] = [
  'MSME / Udyam Certificate',
  'GST & PAN Registration',
  'Turnover & CA Certificate',
  'OEM Authorization / MAF',
  'Technical Compliance Sheet',
  'EMD / Exemption Document',
  'Signed BOQ & Price Bid',
];

const MONTH_MAP: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

function pad2(val: number): string {
  return String(val).padStart(2, '0');
}

function clampString(value: unknown, maxLen: number, fallback = ''): string {
  const str = typeof value === 'string' ? value.trim() : fallback;
  return str.slice(0, maxLen);
}

/**
 * Normalizes a location string into clean "District, State" format by stripping
 * PIN codes, citation markers, street prefixes, quotes, and "District" labels.
 */
export function sanitizeDistrictStateLocation(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return '';

  let cleaned = firstLine
    .replace(/[*`"'"]/g, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\bpin\s*code\b[:\-\s]*/gi, '')
    .replace(/[-–,\s]*\b\d{6}\b/g, '')
    .replace(/,\s*india\s*$/i, '')
    .replace(/\b(district|distt?\.?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/^[,.\s-]+|[,.\s-]+$/g, '')
    .trim();

  // Keep only the last 2 comma-separated parts if an accidental full address slipped through
  const parts = cleaned
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 2) {
    cleaned = `${parts[parts.length - 2]}, ${parts[parts.length - 1]}`;
  } else if (parts.length === 2) {
    cleaned = `${parts[0]}, ${parts[1]}`;
  }

  return clampString(cleaned, 120);
}

export function parseNumericAmount(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[₹,\s]|rs\.?|inr/gi, '').trim();
    if (!cleaned) return 0;
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!match) return 0;
    const num = Number(match[0]);
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : 0;
  }
  return 0;
}

function parseTimeParts(timeRaw: string | undefined): { hh: string; mm: string } {
  if (!timeRaw) return { hh: '17', mm: '00' };
  const match = timeRaw.trim().match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
  if (!match) return { hh: '17', mm: '00' };
  let hours = Number(match[1]);
  const mins = Number(match[2]);
  const meridiem = (match[3] || '').toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return { hh: '17', mm: '00' };
  return { hh: pad2(hours), mm: pad2(mins) };
}

/**
 * Parses common GeM / CPPP / ISO date strings into YYYY-MM-DD.
 */
export function normalizeToIsoDate(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw.trim();
  if (!text) return '';

  // 1. YYYY-MM-DD (optionally followed by T or space + time)
  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }
  }

  // 2. DD-MM-YYYY or DD/MM/YYYY
  const dmyNumeric = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyNumeric) {
    const d = Number(dmyNumeric[1]);
    const m = Number(dmyNumeric[2]);
    const y = Number(dmyNumeric[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }
  }

  // 3. DD MMM YYYY or DD-MMM-YYYY (e.g. "02 Nov 2026", "02-Nov-2026")
  const dmyAlpha = text.match(/^(\d{1,2})[\s\-/]+([a-zA-Z]+)[\s\-/,]+(\d{4})/);
  if (dmyAlpha) {
    const d = Number(dmyAlpha[1]);
    const monthStr = MONTH_MAP[dmyAlpha[2].toLowerCase()];
    const y = Number(dmyAlpha[3]);
    if (monthStr && d >= 1 && d <= 31) {
      return `${y}-${monthStr}-${pad2(d)}`;
    }
  }

  // 4. Native Date fallback for RFC / long dates
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
  }

  return '';
}

/**
 * Parses GeM Bid End Date/Time into YYYY-MM-DDTHH:mm for <input type="datetime-local">.
 */
export function normalizeToIsoDateTime(raw: unknown, fallbackDate?: string): string {
  if (typeof raw === 'string' && raw.trim()) {
    const text = raw.trim();
    const datePart = normalizeToIsoDate(text);
    if (datePart) {
      const timeMatch = text.match(/(?:T|\s+)(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)/i);
      const { hh, mm } = parseTimeParts(timeMatch?.[1]);
      return `${datePart}T${hh}:${mm}`;
    }
  }
  if (fallbackDate && /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate)) {
    return `${fallbackDate}T17:00`;
  }
  const today = new Date().toISOString().slice(0, 10);
  return `${today}T17:00`;
}

export function normalizePortal(rawPortal: unknown, tenderId = ''): PortalType {
  const raw = typeof rawPortal === 'string' ? rawPortal.trim().toLowerCase() : '';
  if (raw.includes('gem') || raw.includes('government e marketplace') || tenderId.toUpperCase().startsWith('GEM/')) {
    return 'GeM';
  }
  if (raw.includes('cppp') || raw.includes('eprocure') || raw.includes('nic') || tenderId.toUpperCase().startsWith('CPPP/')) {
    return 'CPPP / eProcure';
  }
  if (raw.includes('state') || raw.includes('pwd') || raw.includes('mahatenders')) {
    return 'State Portal';
  }
  if (raw.includes('psu') || raw.includes('direct')) {
    return 'PSU / Direct';
  }
  if (raw.includes('private')) {
    return 'Private';
  }
  return 'GeM';
}

export function detectMsmeEmdExemption(
  rawText: unknown,
  opts?: { includeBareMse?: boolean },
): boolean {
  if (typeof rawText !== 'string') return false;
  const text = rawText.trim();
  if (!text) return false;

  if (/\bmsme\b/i.test(text)) return true;
  if (/\budyam\b|\buam\b/i.test(text)) return true;
  if (/exempt(?:ed)?\s*[-–:]?\s*msme\/?startup/i.test(text)) return true;
  if (/\bemd\b[^\n.]{0,40}\bexempt(?:ed|ion)?\b|\bexempt(?:ed|ion)?\b[^\n.]{0,40}\bemd\b/i.test(text)) {
    return true;
  }
  if (/\bstartup\b(?=[^\n.]{0,50}\b(emd|exempt|exemption|relaxation|bid\s*security)\b)|\b(emd|exempt|exemption|relaxation|bid\s*security)\b(?=[^\n.]{0,50}\bstartup\b)/i.test(text)) {
    return true;
  }
  if (opts?.includeBareMse) {
    if (/\bmse\b/i.test(text)) return true;
  } else if (/\bmse\b(?=[^\n.]{0,50}\b(emd|exempt|exemption|relaxation|bid\s*security)\b)|\b(emd|exempt|exemption|relaxation|bid\s*security)\b(?=[^\n.]{0,50}\bmse\b)/i.test(text)) {
    return true;
  }
  return false;
}

export function normalizeEmdSecurity(
  rawRequired: unknown,
  emdAmount: number,
  msmeExemptHint = false,
): EmdSecurityType {
  const text = typeof rawRequired === 'string' ? rawRequired.trim().toLowerCase() : '';
  const hasExplicitExemption =
    msmeExemptHint ||
    detectMsmeEmdExemption(text, { includeBareMse: true }) ||
    text.includes('exempt');

  if (hasExplicitExemption && emdAmount === 0) {
    return 'Exempted - MSME/Startup';
  }

  if (emdAmount > 0) {
    if (hasExplicitExemption) {
      return 'Exempted - MSME/Startup';
    }
    if (text.includes('bg') || text.includes('bank guarantee') || text.includes('e-pbg')) {
      return 'BG Submitted';
    }
    return 'EMD Paid';
  }

  if (text.includes('no emd') || text.includes('not required') || text.includes('nil') || text === 'no') {
    return 'No EMD';
  }

  return 'Exempted - MSME/Startup';
}

export interface RawGeminiBidExtraction {
  tenderId?: unknown;
  portal?: unknown;
  stage?: unknown;
  department?: unknown;
  location?: unknown;
  consigneeAddressRaw?: unknown;
  title?: unknown;
  category?: unknown;
  publishDate?: unknown;
  submissionDueDate?: unknown;
  preBidDate?: unknown;
  completionDate?: unknown;
  estimatedValue?: unknown;
  quotedValue?: unknown;
  emdRequired?: unknown;
  emdStatus?: unknown;
  emdAmount?: unknown;
  msmeExempt?: unknown;
  resultInfo?: unknown;
}

export function normalizeExtractedBidDraft(
  raw: RawGeminiBidExtraction,
  fallbackFileName = '',
): ExtractedBidDraft {
  const baseName = fallbackFileName.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
  const tenderId = clampString(raw.tenderId, 120) || clampString(baseName, 120) || `GEM-${Date.now()}`;
  const portal = normalizePortal(raw.portal, tenderId);
  const stage: TenderStage = 'Identified / Reviewing';
  const department =
    clampString(raw.department, 200) || 'Government Department / Organisation';
  const location = sanitizeDistrictStateLocation(raw.location) || 'India';
  const title =
    clampString(raw.title, 300) || `GeM Bid ${tenderId}`;
  const category =
    clampString(raw.category, 120) || 'Goods & Services';

  const publishDate = normalizeToIsoDate(raw.publishDate);
  const submissionDueDate = normalizeToIsoDateTime(raw.submissionDueDate, publishDate || undefined);
  const preBidDate = normalizeToIsoDate(raw.preBidDate);

  const estimatedValue = parseNumericAmount(raw.estimatedValue);
  const rawEmdAmount = parseNumericAmount(raw.emdAmount);

  const explicitMsmeFlag =
    raw.msmeExempt === true ||
    (typeof raw.msmeExempt === 'string' && raw.msmeExempt.trim().toLowerCase() === 'true');
  const textSignals = [raw.emdRequired, raw.emdStatus, raw.title, raw.category, raw.resultInfo]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ');
  const emdFieldHasMse = detectMsmeEmdExemption(
    [raw.emdRequired, raw.emdStatus].filter((v): v is string => typeof v === 'string').join(' '),
    { includeBareMse: true },
  );
  const msmeExemptDetected =
    explicitMsmeFlag || emdFieldHasMse || detectMsmeEmdExemption(textSignals);

  const emdStatus = normalizeEmdSecurity(
    raw.emdRequired ?? raw.emdStatus,
    rawEmdAmount,
    msmeExemptDetected,
  );
  const emdAmount = emdStatus === 'Exempted - MSME/Startup' || emdStatus === 'No EMD' ? 0 : rawEmdAmount;

  return {
    tenderId,
    portal,
    stage,
    department,
    location,
    title,
    category,
    publishDate,
    submissionDueDate,
    preBidDate,
    completionDate: '',
    estimatedValue,
    quotedValue: 0,
    emdStatus,
    emdAmount,
    resultInfo: '',
  };
}

export function findDuplicateTender(
  tenders: ReadonlyArray<Tender>,
  candidateTenderId: string,
): Tender | undefined {
  const normalized = candidateTenderId.trim().toLowerCase();
  if (!normalized) return undefined;
  return tenders.find((t) => t.tenderId.trim().toLowerCase() === normalized);
}

export function buildTenderFromBidDraft(
  draft: ExtractedBidDraft,
  attachment1?: AttachmentItem | null,
): Tender {
  const nowIso = new Date().toISOString();
  const checklist: ChecklistItem[] = DEFAULT_CHECKLIST_LABELS.map((label, idx) => ({
    id: `chk-${idx + 1}`,
    label,
    checked: false,
  }));

  return {
    id: `tnd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tenderId: draft.tenderId.trim(),
    portal: draft.portal,
    department: draft.department.trim() || 'Government Department / Organisation',
    location: draft.location.trim() || 'India',
    category: draft.category.trim() || 'Goods & Services',
    title: draft.title.trim() || `GeM Bid ${draft.tenderId.trim()}`,
    publishDate: draft.publishDate,
    submissionDueDate: draft.submissionDueDate,
    preBidDate: draft.preBidDate || undefined,
    estimatedValue: Math.max(0, Number(draft.estimatedValue) || 0),
    quotedValue: Math.max(0, Number(draft.quotedValue) || 0),
    emdStatus: draft.emdStatus,
    emdAmount:
      draft.emdStatus === 'EMD Paid' || draft.emdStatus === 'BG Submitted'
        ? Math.max(0, Number(draft.emdAmount) || 0)
        : 0,
    stage: draft.stage,
    resultInfo: draft.resultInfo.trim(),
    completionDate: draft.completionDate || undefined,
    checklist,
    remarks: [],
    attachments: attachment1
      ? [
          {
            ...attachment1,
            slotLabel: DEFAULT_TENDER_ATTACHMENT_1_LABEL,
          },
        ]
      : [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
