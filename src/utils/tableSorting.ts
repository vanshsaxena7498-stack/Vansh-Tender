import type { MafItemStatus, MafTrackerRecord, OemRecord, Tender } from '../types/crm';
import { parseDueDateTimeMs } from './bidRaStatus';
import { normalizeOemNameKey } from './oemDirectory';

export type DateSortDirection = 'asc' | 'desc';

export interface OemLinkedItemSummary {
  tenderId: string;
  tenderRefId: string;
  department: string;
  location: string;
  dueDate: string;
  itemName: string;
  requiredQuantity: string;
  mafStatus: MafItemStatus;
}

export interface OemLinkedContext {
  primaryTenderId: string;
  tenderNosLabel: string;
  locationLabel: string;
  linkedTenderCount: number;
  linkedItems: OemLinkedItemSummary[];
}

export function parseSortableDateMs(dateStr?: string): number | null {
  const trimmed = (dateStr || '').trim();
  if (!trimmed) return null;
  const dueMs = parseDueDateTimeMs(trimmed);
  if (dueMs !== null) return dueMs;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function sortRecordsByDate<T>(
  records: readonly T[],
  getDate: (item: T) => string | undefined,
  direction: DateSortDirection,
): T[] {
  const mapped = records.map((item, index) => ({
    item,
    index,
    ms: parseSortableDateMs(getDate(item)),
  }));

  mapped.sort((a, b) => {
    if (a.ms !== null && b.ms !== null) {
      if (a.ms !== b.ms) {
        return direction === 'asc' ? a.ms - b.ms : b.ms - a.ms;
      }
      return direction === 'asc' ? a.index - b.index : b.index - a.index;
    }
    if (a.ms === null && b.ms === null) {
      return direction === 'asc' ? a.index - b.index : b.index - a.index;
    }
    // Keep entries with missing dates at the bottom regardless of sort direction
    return a.ms === null ? 1 : -1;
  });

  return mapped.map((entry) => entry.item);
}

export function resolveOemLinkedContexts(
  oemRecords: readonly OemRecord[],
  mafTrackers: readonly MafTrackerRecord[],
  tenders: readonly Tender[],
): Map<string, OemLinkedContext> {
  const tenderById = new Map(tenders.map((t) => [t.id, t]));
  const tenderByCode = new Map(
    tenders.map((t) => [t.tenderId.trim().toLowerCase(), t]),
  );

  const oemByKey = new Map<string, OemRecord>();
  const collector = new Map<
    string,
    {
      tenderIds: string[];
      seenTenderKeys: Set<string>;
      locations: string[];
      seenLocationKeys: Set<string>;
      linkedItems: OemLinkedItemSummary[];
    }
  >();

  for (const oem of oemRecords) {
    const key = normalizeOemNameKey(oem.oemName);
    if (key) oemByKey.set(key, oem);
    collector.set(oem.id, {
      tenderIds: [],
      seenTenderKeys: new Set<string>(),
      locations: [],
      seenLocationKeys: new Set<string>(),
      linkedItems: [],
    });
  }

  for (const tracker of mafTrackers) {
    const linkedTender =
      (tracker.tenderRefId ? tenderById.get(tracker.tenderRefId) : undefined) ??
      tenderByCode.get(tracker.tenderId.trim().toLowerCase());

    const resolvedTenderId = linkedTender?.tenderId || tracker.tenderId;
    const resolvedDepartment =
      tracker.department || linkedTender?.department || '—';
    const resolvedLocation = linkedTender?.location || '';
    const resolvedDueDate =
      linkedTender?.submissionDueDate || tracker.tenderDueDate || '';

    for (const item of tracker.itemsMAF ?? []) {
      const oemKey = normalizeOemNameKey(item.oemName || '');
      if (!oemKey) continue;
      const matchedOem = oemByKey.get(oemKey);
      if (!matchedOem) continue;
      const bucket = collector.get(matchedOem.id);
      if (!bucket) continue;

      const tKey = resolvedTenderId.trim().toLowerCase();
      if (tKey && !bucket.seenTenderKeys.has(tKey)) {
        bucket.seenTenderKeys.add(tKey);
        bucket.tenderIds.push(resolvedTenderId);
      }

      const locKey = resolvedLocation.trim().toLowerCase();
      if (locKey && !bucket.seenLocationKeys.has(locKey)) {
        bucket.seenLocationKeys.add(locKey);
        bucket.locations.push(resolvedLocation);
      }

      bucket.linkedItems.push({
        tenderId: resolvedTenderId,
        tenderRefId: linkedTender?.id || tracker.tenderRefId || '',
        department: resolvedDepartment,
        location: resolvedLocation || '—',
        dueDate: resolvedDueDate,
        itemName: item.itemName,
        requiredQuantity: item.requiredQuantity,
        mafStatus: item.mafStatus,
      });
    }
  }

  const result = new Map<string, OemLinkedContext>();
  for (const [id, bucket] of collector.entries()) {
    const primaryTenderId = bucket.tenderIds[0] ?? '';
    const extraCount = bucket.tenderIds.length > 1 ? bucket.tenderIds.length - 1 : 0;
    const tenderNosLabel = primaryTenderId
      ? extraCount > 0
        ? `${primaryTenderId} (+${extraCount})`
        : primaryTenderId
      : '—';
    const locationLabel = bucket.locations[0] || '—';

    result.set(id, {
      primaryTenderId,
      tenderNosLabel,
      locationLabel,
      linkedTenderCount: bucket.tenderIds.length,
      linkedItems: bucket.linkedItems,
    });
  }
  return result;
}
