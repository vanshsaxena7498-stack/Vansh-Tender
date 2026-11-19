import type { RemarkEntry } from '../types/crm';

/**
 * Parses YYYY-MM-DD date-only strings in local calendar coordinates to avoid UTC off-by-one shifts.
 */
export function parseCalendarDate(dateStr?: string): Date | null {
  const trimmed = (dateStr || '').trim();
  if (!trimmed) return null;
  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    const local = new Date(year, month, day);
    if (
      local.getFullYear() === year &&
      local.getMonth() === month &&
      local.getDate() === day
    ) {
      return local;
    }
    return null;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Returns local YYYY-MM-DD string suitable for HTML <input type="date"> values.
 */
export function getLocalDateInputValue(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseRemarkEpoch(rawTimestamp?: string): number {
  const trimmed = (rawTimestamp || '').trim();
  if (!trimmed) return Number.NEGATIVE_INFINITY;
  const dmy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (dmy) {
    const [, dd, mm, yyyy, hh = '00', min = '00'] = dmy;
    const parsed = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
    ).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  const ymdTime = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (ymdTime) {
    const [, yyyy, mm, dd, hh = '00', min = '00'] = ymdTime;
    const parsed = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
    ).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  const direct = Date.parse(trimmed);
  return Number.isNaN(direct) ? Number.NEGATIVE_INFINITY : direct;
}

/**
 * Returns the newest remark text across prepended or appended remark arrays.
 */
export function getLatestRemarkText(remarks?: RemarkEntry[], fallback = ''): string {
  if (!remarks || remarks.length === 0) return fallback;
  let best = remarks[0];
  let bestEpoch = parseRemarkEpoch(best?.timestamp);
  for (let i = 1; i < remarks.length; i++) {
    const candidate = remarks[i];
    const epoch = parseRemarkEpoch(candidate?.timestamp);
    if (epoch > bestEpoch) {
      best = candidate;
      bestEpoch = epoch;
    }
  }
  const text = (best?.text || '').trim();
  return text || fallback;
}

/**
 * Format Indian Rupee amount in exact en-IN comma grouping (e.g., ₹ 1,45,00,000)
 */
export function formatINR(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return '₹ ' + safe.toLocaleString('en-IN');
}

/**
 * Format Indian Rupee amount in compact Lakhs / Crores readable format (e.g., ₹ 2.45 Cr, ₹ 18.50 L)
 */
export function formatINRCompact(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const abs = Math.abs(safe);
  const sign = safe < 0 ? '-' : '';
  if (abs >= 1_00_00_000) {
    return `${sign}₹ ${(abs / 1_00_00_000).toFixed(2)} Cr`;
  }
  if (abs >= 1_00_000) {
    return `${sign}₹ ${(abs / 1_00_000).toFixed(2)} L`;
  }
  if (abs >= 1_000) {
    return `${sign}₹ ${(abs / 1_000).toFixed(1)} K`;
  }
  return `${sign}₹ ${Math.round(abs).toLocaleString('en-IN')}`;
}

export function formatShortDate(dateStr?: string): string {
  if (!dateStr) return '—';
  const d = parseCalendarDate(dateStr);
  if (!d) return dateStr;
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(dateStr?: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Returns Indian Financial Year string for a date, e.g. 'FY 2026-27'
 * Indian FY runs April 1 to March 31.
 */
export function getFinancialYear(dateStr: string): string {
  const d = parseCalendarDate(dateStr);
  if (!d) return 'Unknown';
  const month = d.getMonth(); // 0 = Jan, 3 = Apr
  const year = d.getFullYear();
  const startYear = month >= 3 ? year : year - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return `FY ${startYear}-${endShort}`;
}

/**
 * Returns YYYY-MM key from a date string.
 */
export function getMonthKey(dateStr: string): string {
  const d = parseCalendarDate(dateStr);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return monthKey;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

/**
 * Difference in full days (positive = future, negative = past)
 */
export function getDaysRemaining(targetDateStr: string, referenceNow: Date = new Date()): number {
  if (!targetDateStr) return 0;
  const target = parseCalendarDate(targetDateStr);
  if (!target) return 0;
  const refStart = new Date(
    referenceNow.getFullYear(),
    referenceNow.getMonth(),
    referenceNow.getDate(),
  );
  const tgtStart = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((tgtStart.getTime() - refStart.getTime()) / (1000 * 60 * 60 * 24));
}

export function getHoursRemaining(targetDateStr: string, referenceNow: Date = new Date()): number {
  const target = new Date(targetDateStr);
  if (Number.isNaN(target.getTime())) return 0;
  return (target.getTime() - referenceNow.getTime()) / (1000 * 60 * 60);
}

/**
 * Safely escape CSV cells and trigger browser download.
 */
export function escapeCsvCell(value: string | number | undefined | null): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvContent(headers: string[], rows: (string | number | undefined | null)[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const bodyLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  return '\uFEFF' + [headerLine, ...bodyLines].join('\r\n');
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
