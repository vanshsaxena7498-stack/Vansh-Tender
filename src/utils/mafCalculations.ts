import type { MafItemStatus, MafLineItem, MafTrackerRecord, Tender } from '../types/crm';

export const MAF_STATUS_OPTIONS: MafItemStatus[] = [
  'Not Requested',
  'Requested / Follow-up',
  'Under Approval',
  'Received / Approved',
  'Rejected',
];

export const MAX_MAF_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB limit for MAF PDF/image uploads

export const ALLOWED_MAF_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

export interface MafSummaryMetrics {
  totalActiveTenders: number;
  totalItemsTracked: number;
  mafPending: number;
  mafReceived: number;
}

export interface MafFilterCriteria {
  tenderQuery: string;
  itemOrOemQuery: string;
  statusFilter: 'ALL' | MafItemStatus;
}

export interface ResolvedMafTracker extends MafTrackerRecord {
  resolvedTenderTitle: string;
  resolvedDepartment: string;
  resolvedDueDate: string;
  overallStatus: MafItemStatus;
  matchedItems: MafLineItem[];
}

export function calculateOverallMafStatus(items: MafLineItem[]): MafItemStatus {
  if (!items || items.length === 0) return 'Not Requested';

  const statuses = items.map((item) => item.mafStatus);
  if (statuses.every((s) => s === 'Received / Approved')) {
    return 'Received / Approved';
  }
  if (statuses.some((s) => s === 'Rejected')) {
    return 'Rejected';
  }
  if (statuses.some((s) => s === 'Under Approval')) {
    return 'Under Approval';
  }
  if (statuses.some((s) => s === 'Received / Approved')) {
    // Partially received with other items still open
    return 'Under Approval';
  }
  if (statuses.some((s) => s === 'Requested / Follow-up')) {
    return 'Requested / Follow-up';
  }
  return 'Not Requested';
}

export function computeMafSummaryMetrics(
  trackers: MafTrackerRecord[],
  tenders: Tender[],
): MafSummaryMetrics {
  const activeTenderIds = new Set(
    tenders
      .filter(
        (t) =>
          t.stage !== 'Lost (L2/L3)' &&
          t.stage !== 'Cancelled / Retendered' &&
          t.stage !== 'Tender Not Filled',
      )
      .map((t) => t.tenderId.toLowerCase()),
  );

  let totalItemsTracked = 0;
  let mafPending = 0;
  let mafReceived = 0;
  let trackedActiveTenders = 0;

  for (const tracker of trackers) {
    const items = tracker.itemsMAF ?? [];
    if (items.length > 0 || activeTenderIds.has(tracker.tenderId.toLowerCase())) {
      trackedActiveTenders += 1;
    }
    for (const item of items) {
      totalItemsTracked += 1;
      if (item.mafStatus === 'Received / Approved') {
        mafReceived += 1;
      } else {
        mafPending += 1;
      }
    }
  }

  return {
    totalActiveTenders: trackedActiveTenders,
    totalItemsTracked,
    mafPending,
    mafReceived,
  };
}

export function resolveAndFilterMafTrackers(
  trackers: MafTrackerRecord[],
  tenders: Tender[],
  filters: MafFilterCriteria,
): ResolvedMafTracker[] {
  const tenderById = new Map(tenders.map((t) => [t.id, t]));
  const tenderByCode = new Map(tenders.map((t) => [t.tenderId.toLowerCase(), t]));

  const tq = filters.tenderQuery.trim().toLowerCase();
  const iq = filters.itemOrOemQuery.trim().toLowerCase();

  const resolved: ResolvedMafTracker[] = [];

  for (const tracker of trackers) {
    const linked =
      (tracker.tenderRefId ? tenderById.get(tracker.tenderRefId) : undefined) ??
      tenderByCode.get(tracker.tenderId.toLowerCase());

    const resolvedTenderTitle = linked?.title || tracker.tenderTitle || 'Linked Tender Work';
    const resolvedDepartment = linked?.department || tracker.department || 'Department';
    const resolvedDueDate = linked?.submissionDueDate || tracker.tenderDueDate || '';
    const overallStatus = calculateOverallMafStatus(tracker.itemsMAF ?? []);

    if (tq) {
      const hitTender =
        tracker.tenderId.toLowerCase().includes(tq) ||
        resolvedTenderTitle.toLowerCase().includes(tq) ||
        resolvedDepartment.toLowerCase().includes(tq);
      if (!hitTender) continue;
    }

    if (filters.statusFilter !== 'ALL' && overallStatus !== filters.statusFilter) {
      continue;
    }

    const items = tracker.itemsMAF ?? [];
    const matchedItems = iq
      ? items.filter((item) => {
          const contact = getMafContactDetails(item);
          return (
            item.itemName.toLowerCase().includes(iq) ||
            item.oemName.toLowerCase().includes(iq) ||
            contact.concernedPersonName.toLowerCase().includes(iq) ||
            contact.contactNo.toLowerCase().includes(iq) ||
            contact.mailId.toLowerCase().includes(iq) ||
            (item.oemContact ?? '').toLowerCase().includes(iq)
          );
        })
      : items;

    if (iq && matchedItems.length === 0) {
      continue;
    }

    resolved.push({
      ...tracker,
      tenderId: linked?.tenderId || tracker.tenderId,
      resolvedTenderTitle,
      resolvedDepartment,
      resolvedDueDate,
      overallStatus,
      matchedItems,
    });
  }

  return resolved.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function validateMafItemDraft(draft: {
  itemName: string;
  oemName: string;
  requiredQuantity?: string;
}): string | null {
  if (!draft.itemName || !draft.itemName.trim()) {
    return 'Item Name is required.';
  }
  if (!draft.oemName || !draft.oemName.trim()) {
    return 'OEM Name is required.';
  }
  if (draft.itemName.trim().length > 220) {
    return 'Item Name must be 220 characters or fewer.';
  }
  if (draft.oemName.trim().length > 150) {
    return 'OEM Name must be 150 characters or fewer.';
  }
  return null;
}

export function validateMafUploadFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (file.size <= 0) {
    return 'Selected file is empty.';
  }
  if (file.size > MAX_MAF_UPLOAD_BYTES) {
    return 'File exceeds 5 MB maximum upload limit for MAF documents.';
  }
  const lowerName = file.name.toLowerCase();
  const extOk =
    lowerName.endsWith('.pdf') ||
    lowerName.endsWith('.png') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg') ||
    lowerName.endsWith('.webp');
  if (!ALLOWED_MAF_MIME_TYPES.has(file.type) && !extOk) {
    return 'Only PDF, PNG, JPG, JPEG, or WEBP files are allowed for signed MAF documents.';
  }
  return null;
}

export function findDailyTenderByCode(
  tenders: Tender[],
  tenderIdCode: string,
): Tender | undefined {
  const normalized = tenderIdCode.trim().toLowerCase();
  if (!normalized) return undefined;
  return tenders.find((t) => t.tenderId.trim().toLowerCase() === normalized);
}

export function findMatchingDailyTender(
  tenders: Tender[],
  tenderIdCode: string,
  tenderRefId?: string,
): Tender | undefined {
  const byCode = findDailyTenderByCode(tenders, tenderIdCode);
  if (byCode) return byCode;
  if (tenderRefId && !tenderIdCode.trim()) {
    return tenders.find((t) => t.id === tenderRefId);
  }
  return undefined;
}

export function createMafItemId(seedIndex = 0): string {
  return `mafitem-${Date.now()}-${seedIndex}-${Math.random().toString(36).slice(2, 6)}`;
}

export function getMafRequestedDate(
  item: Pick<MafLineItem, 'mafRequestedDate' | 'validityDate'>,
): string {
  return (item.mafRequestedDate?.trim() || item.validityDate?.trim() || '');
}

export function getMafContactDetails(
  item: Pick<MafLineItem, 'concernedPersonName' | 'contactNo' | 'mailId' | 'oemContact'>,
): {
  concernedPersonName: string;
  contactNo: string;
  mailId: string;
} {
  let concernedPersonName = (item.concernedPersonName ?? '').trim();
  let contactNo = (item.contactNo ?? '').trim();
  const mailId = (item.mailId ?? '').trim();

  if (!concernedPersonName && !contactNo && item.oemContact?.trim()) {
    const raw = item.oemContact.trim();
    const parts = raw
      .split('·')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      concernedPersonName = parts[0];
      contactNo = parts.slice(1).join(' · ');
    } else if (/^[\d+\s()-]{6,}$/.test(raw)) {
      contactNo = raw;
    } else {
      concernedPersonName = raw;
    }
  }

  return { concernedPersonName, contactNo, mailId };
}
