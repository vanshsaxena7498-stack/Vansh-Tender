import type {
  FinancialRaStatus,
  TechnicalEvalStatus,
  Tender,
} from '../types/crm';

export const TECHNICAL_STATUS_OPTIONS: readonly TechnicalEvalStatus[] = [
  'Pending',
  'Technically Qualified',
  'Technically Disqualified / Rejected',
  'Clarification Sought',
] as const;

export const FINANCIAL_RA_STATUS_OPTIONS: readonly FinancialRaStatus[] = [
  'Not Opened',
  'Financial Opened',
  'RA Scheduled / Live',
  'RA Completed',
  'L1 / Awarded',
  'L2 / Runner-up',
  'Not L1 / Lost',
] as const;

export const BID_RA_RANK_OPTIONS = ['L1', 'L2', 'L3', 'L4+', 'Not Open'] as const;

/**
 * Parses a tender submission due date & time string into UTC epoch milliseconds
 * standardized on India Standard Time (+05:30) for naive GeM/CPPP local inputs.
 * Returns null when the input is blank or unparseable.
 */
export function parseDueDateTimeMs(rawDueDate?: string): number | null {
  const trimmed = (rawDueDate || '').trim();
  if (!trimmed) return null;

  // 1. Explicit timezone offset or UTC 'Z'
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }

  // 2. ISO-like YYYY-MM-DDTHH:mm(:ss)? or YYYY-MM-DD HH:mm(:ss)? -> interpret in IST (+05:30)
  const ymdTime = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (ymdTime) {
    const [, yyyy, mm, dd, hh, min, sec = '00'] = ymdTime;
    const parsed = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}+05:30`);
    return Number.isNaN(parsed) ? null : parsed;
  }

  // 3. Indian sheet/PDF format DD/MM/YYYY HH:mm(:ss)? -> interpret in IST (+05:30)
  const dmyTime = trimmed.match(
    /^(\d{2})[\/\-](\d{2})[\/\-](\d{4})(?:\s+|T)(\d{2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i,
  );
  if (dmyTime) {
    const [, dd, mm, yyyy, rawHh, min, sec = '00', ampm] = dmyTime;
    let hhNum = Number(rawHh);
    if (ampm) {
      const upper = ampm.toUpperCase();
      if (upper === 'PM' && hhNum < 12) hhNum += 12;
      if (upper === 'AM' && hhNum === 12) hhNum = 0;
    }
    const hh = String(hhNum).padStart(2, '0');
    const parsed = Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}+05:30`);
    return Number.isNaN(parsed) ? null : parsed;
  }

  // 4. Date-only formats (YYYY-MM-DD or DD/MM/YYYY) -> end of business day in IST
  const ymdOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdOnly) {
    const [, yyyy, mm, dd] = ymdOnly;
    const parsed = Date.parse(`${yyyy}-${mm}-${dd}T23:59:59+05:30`);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const dmyOnly = trimmed.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (dmyOnly) {
    const [, dd, mm, yyyy] = dmyOnly;
    const parsed = Date.parse(`${yyyy}-${mm}-${dd}T23:59:59+05:30`);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const fallback = Date.parse(trimmed);
  return Number.isNaN(fallback) ? null : fallback;
}

/**
 * Returns true once a tender's submissionDueDate is at or before referenceNow.
 */
export function isTenderDuePassed(
  tender: Pick<Tender, 'submissionDueDate'>,
  referenceNow: Date | number = new Date(),
): boolean {
  const dueMs = parseDueDateTimeMs(tender.submissionDueDate);
  if (dueMs === null) return false;
  const nowMs =
    typeof referenceNow === 'number' ? referenceNow : referenceNow.getTime();
  return dueMs <= nowMs;
}

/**
 * Splits tenders into active Daily Tender Data (upcoming/unparsed due dates)
 * and due-passed BID/RA Status tenders.
 */
export function partitionTendersByDueDate(
  tenders: Tender[],
  referenceNow: Date | number = new Date(),
): { dailyTenders: Tender[]; bidRaTenders: Tender[] } {
  const dailyTenders: Tender[] = [];
  const bidRaTenders: Tender[] = [];

  for (const tender of tenders) {
    if (isTenderDuePassed(tender, referenceNow)) {
      bidRaTenders.push(tender);
    } else {
      dailyTenders.push(tender);
    }
  }

  return { dailyTenders, bidRaTenders };
}

/**
 * Normalizes a date-time string into HTML <input type="datetime-local"> format (YYYY-MM-DDTHH:mm).
 */
export function toDateTimeLocalInput(dateTimeStr?: string): string {
  const trimmed = (dateTimeStr || '').trim();
  if (!trimmed) return '';
  const ymdTime = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (ymdTime) return `${ymdTime[1]}T${ymdTime[2]}`;
  const dmyTime = trimmed.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})\s+(\d{2}:\d{2})/);
  if (dmyTime) return `${dmyTime[3]}-${dmyTime[2]}-${dmyTime[1]}T${dmyTime[4]}`;
  const ymdOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (ymdOnly) return `${ymdOnly[1]}T00:00`;
  return '';
}
