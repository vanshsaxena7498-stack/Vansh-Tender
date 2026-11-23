import type { MafTrackerRecord, OemRecord } from '../types/crm';

export const OEM_FIELD_LIMITS = {
  OEM_NAME_MAX: 150,
  COMPANY_NAME_MAX: 150,
  PERSON_NAME_MAX: 120,
  EMAIL_MAX: 160,
  PHONE_MAX: 40,
  REMARKS_MAX: 500,
} as const;

export interface OemDraftInput {
  oemName: string;
  companyName: string;
  concernedPersonName: string;
  email: string;
  phone: string;
  remarks: string;
}

export interface OemUsageSummary {
  tenderCount: number;
  itemCount: number;
}

export interface MafOemContactPatch {
  oemName: string;
  companyName: string;
  concernedPersonName: string;
  contactNo: string;
  mailId: string;
  oemContact: string;
}

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function createOemId(): string {
  return `oem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeOemNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function findOemById(
  oems: readonly OemRecord[],
  id: string | undefined | null,
): OemRecord | undefined {
  if (!id) return undefined;
  const trimmed = id.trim();
  if (!trimmed) return undefined;
  return oems.find((item) => item.id === trimmed);
}

export function findOemByName(
  oems: readonly OemRecord[],
  oemName: string | undefined | null,
): OemRecord | undefined {
  if (!oemName) return undefined;
  const key = normalizeOemNameKey(oemName);
  if (!key) return undefined;
  return oems.find((item) => normalizeOemNameKey(item.oemName) === key);
}

export function buildMafContactPatchFromOem(oem: OemRecord): MafOemContactPatch {
  const oemName = oem.oemName.trim();
  const companyName = (oem.companyName ?? '').trim();
  const concernedPersonName = (oem.concernedPersonName ?? '').trim();
  const contactNo = (oem.phone ?? '').trim();
  const mailId = (oem.email ?? '').trim();
  const oemContact = [concernedPersonName, contactNo].filter(Boolean).join(' · ');

  return {
    oemName,
    companyName,
    concernedPersonName,
    contactNo,
    mailId,
    oemContact,
  };
}

export function validateOemDraft(
  draft: OemDraftInput,
  existingOems: readonly OemRecord[],
  editingId?: string | null,
): string | null {
  const oemName = draft.oemName.trim();
  if (!oemName) {
    return 'OEM / Manufacturer Name is required.';
  }
  if (oemName.length > OEM_FIELD_LIMITS.OEM_NAME_MAX) {
    return `OEM / Manufacturer Name must be ${OEM_FIELD_LIMITS.OEM_NAME_MAX} characters or fewer.`;
  }

  const normalized = normalizeOemNameKey(oemName);
  const duplicate = existingOems.find(
    (item) => normalizeOemNameKey(item.oemName) === normalized && item.id !== (editingId ?? ''),
  );
  if (duplicate) {
    return `OEM "${duplicate.oemName}" already exists in the directory.`;
  }

  const companyName = draft.companyName.trim();
  if (companyName.length > OEM_FIELD_LIMITS.COMPANY_NAME_MAX) {
    return `Company Name must be ${OEM_FIELD_LIMITS.COMPANY_NAME_MAX} characters or fewer.`;
  }

  const concernedPersonName = draft.concernedPersonName.trim();
  if (concernedPersonName.length > OEM_FIELD_LIMITS.PERSON_NAME_MAX) {
    return `Concerned Person Name must be ${OEM_FIELD_LIMITS.PERSON_NAME_MAX} characters or fewer.`;
  }

  const email = draft.email.trim();
  if (email.length > OEM_FIELD_LIMITS.EMAIL_MAX) {
    return `Email ID must be ${OEM_FIELD_LIMITS.EMAIL_MAX} characters or fewer.`;
  }
  if (email && !SIMPLE_EMAIL_PATTERN.test(email)) {
    return 'Enter a valid Email ID (e.g. name@company.com).';
  }

  const phone = draft.phone.trim();
  if (phone.length > OEM_FIELD_LIMITS.PHONE_MAX) {
    return `Phone No. must be ${OEM_FIELD_LIMITS.PHONE_MAX} characters or fewer.`;
  }

  const remarks = draft.remarks.trim();
  if (remarks.length > OEM_FIELD_LIMITS.REMARKS_MAX) {
    return `Remarks must be ${OEM_FIELD_LIMITS.REMARKS_MAX} characters or fewer.`;
  }

  return null;
}

export function sanitizeOemDraft(draft: OemDraftInput): OemDraftInput {
  return {
    oemName: draft.oemName.trim().slice(0, OEM_FIELD_LIMITS.OEM_NAME_MAX),
    companyName: draft.companyName.trim().slice(0, OEM_FIELD_LIMITS.COMPANY_NAME_MAX),
    concernedPersonName: draft.concernedPersonName.trim().slice(0, OEM_FIELD_LIMITS.PERSON_NAME_MAX),
    email: draft.email.trim().slice(0, OEM_FIELD_LIMITS.EMAIL_MAX),
    phone: draft.phone.trim().slice(0, OEM_FIELD_LIMITS.PHONE_MAX),
    remarks: draft.remarks.trim().slice(0, OEM_FIELD_LIMITS.REMARKS_MAX),
  };
}

export function filterOemRecords(
  oems: readonly OemRecord[],
  query: string,
): OemRecord[] {
  const q = query.trim().toLowerCase();
  const sorted = [...oems].sort((a, b) => a.oemName.localeCompare(b.oemName));
  if (!q) return sorted;

  return sorted.filter(
    (oem) =>
      oem.oemName.toLowerCase().includes(q) ||
      oem.companyName.toLowerCase().includes(q) ||
      oem.concernedPersonName.toLowerCase().includes(q) ||
      oem.email.toLowerCase().includes(q) ||
      oem.phone.toLowerCase().includes(q) ||
      oem.remarks.toLowerCase().includes(q),
  );
}

export function computeOemUsageMap(
  oems: readonly OemRecord[],
  mafTrackers: readonly MafTrackerRecord[],
): Map<string, OemUsageSummary> {
  const byNameKey = new Map<string, OemRecord>();
  const usageMap = new Map<string, { tenderIds: Set<string>; itemCount: number }>();

  for (const oem of oems) {
    const key = normalizeOemNameKey(oem.oemName);
    if (key) byNameKey.set(key, oem);
    usageMap.set(oem.id, { tenderIds: new Set<string>(), itemCount: 0 });
  }

  for (const tracker of mafTrackers) {
    const tenderIdentity = tracker.tenderRefId || tracker.tenderId || tracker.id;
    for (const item of tracker.itemsMAF ?? []) {
      const key = normalizeOemNameKey(item.oemName || '');
      if (!key) continue;
      const matched = byNameKey.get(key);
      if (!matched) continue;
      const entry = usageMap.get(matched.id);
      if (!entry) continue;
      entry.itemCount += 1;
      if (tenderIdentity) {
        entry.tenderIds.add(tenderIdentity);
      }
    }
  }

  const result = new Map<string, OemUsageSummary>();
  for (const [id, entry] of usageMap.entries()) {
    result.set(id, {
      tenderCount: entry.tenderIds.size,
      itemCount: entry.itemCount,
    });
  }
  return result;
}
