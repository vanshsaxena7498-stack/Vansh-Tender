import type {
  CrmUserRole,
  CrmUserSession,
  EmdBgRecord,
  EmailAlertLog,
  EmailAlertSettings,
  FirmProfile,
  GoogleSheetSettings,
  MafTrackerRecord,
  OemRecord,
  SecondaryUserSummary,
  TeamRole,
  Tender,
  UserPreferences,
} from '../types/crm';

export const PRESENCE_HEARTBEAT_TTL_MS = 90_000;

export type CrmPermission =
  | 'tenders.read'
  | 'tenders.write'
  | 'tenders.delete'
  | 'oems.write'
  | 'maf.write'
  | 'emd.read'
  | 'emd.write'
  | 'ai.scan'
  | 'sheets.sync'
  | 'exports.download'
  | 'team.manage'
  | 'settings.manage';

const ROLE_PERMISSION_MAP: Record<TeamRole, ReadonlySet<CrmPermission>> = {
  owner: new Set<CrmPermission>([
    'tenders.read',
    'tenders.write',
    'tenders.delete',
    'oems.write',
    'maf.write',
    'emd.read',
    'emd.write',
    'ai.scan',
    'sheets.sync',
    'exports.download',
    'team.manage',
    'settings.manage',
  ]),
  admin: new Set<CrmPermission>([
    'tenders.read',
    'tenders.write',
    'tenders.delete',
    'oems.write',
    'maf.write',
    'emd.read',
    'emd.write',
    'ai.scan',
    'sheets.sync',
    'exports.download',
    'team.manage',
    'settings.manage',
  ]),
  manager: new Set<CrmPermission>([
    'tenders.read',
    'tenders.write',
    'tenders.delete',
    'oems.write',
    'maf.write',
    'emd.read',
    'emd.write',
    'ai.scan',
    'sheets.sync',
    'exports.download',
  ]),
  executive: new Set<CrmPermission>([
    'tenders.read',
    'tenders.write',
    'oems.write',
    'maf.write',
    'emd.read',
    'ai.scan',
    'sheets.sync',
    'exports.download',
  ]),
  finance: new Set<CrmPermission>([
    'tenders.read',
    'emd.read',
    'emd.write',
    'sheets.sync',
    'exports.download',
  ]),
  viewer: new Set<CrmPermission>(['tenders.read', 'emd.read']),
};

export const ROLE_LABELS: Record<TeamRole, string> = {
  owner: 'Workspace Owner',
  admin: 'Admin',
  manager: 'Bid Manager',
  executive: 'Tender Executive',
  finance: 'Finance / EMD Officer',
  viewer: 'Read-Only Viewer',
};

export function normalizeCrmRole(role?: CrmUserRole | string | null): TeamRole {
  if (role === 'owner') return 'owner';
  if (role === 'admin') return 'admin';
  if (role === 'manager') return 'manager';
  if (role === 'finance') return 'finance';
  if (role === 'viewer') return 'viewer';
  if (role === 'executive' || role === 'secondary') return 'executive';
  return 'viewer';
}

export function isWorkspaceAdminRole(role?: CrmUserRole | string | null): boolean {
  const normalized = normalizeCrmRole(role);
  return normalized === 'owner' || normalized === 'admin';
}

export function hasCrmPermission(
  role: CrmUserRole | string | null | undefined,
  permission: CrmPermission,
): boolean {
  const normalized = normalizeCrmRole(role);
  return ROLE_PERMISSION_MAP[normalized].has(permission);
}

export interface StoredCrmUserAccount {
  userId: string;
  username: string;
  email: string;
  role: CrmUserRole;
  companyId?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  isActive: boolean;
  isEnabled?: boolean;
  disabledAt?: string;
  presenceStatus?: 'active' | 'not_active';
  lastHeartbeatAt?: string;
  lastLogoutAt?: string;
  byocProjectId?: string;
}

export interface SecondaryWorkspaceSnapshot {
  firmProfile: FirmProfile;
  preferences: UserPreferences;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  mafTrackers: MafTrackerRecord[];
  oemRecords?: OemRecord[];
  emailSettings: EmailAlertSettings;
  emailLogs: EmailAlertLog[];
  sheetSettings: GoogleSheetSettings;
  updatedAt: string;
}

export function computeEffectivePresenceStatus(
  user: Pick<
    StoredCrmUserAccount,
    'isEnabled' | 'isActive' | 'presenceStatus' | 'lastHeartbeatAt'
  >,
  nowMs = Date.now(),
): 'active' | 'not_active' {
  const enabled = user.isEnabled !== undefined ? user.isEnabled !== false : user.isActive !== false;
  if (!enabled) return 'not_active';
  if (user.presenceStatus !== 'active') return 'not_active';
  if (!user.lastHeartbeatAt) return 'not_active';
  const hbMs = Date.parse(user.lastHeartbeatAt);
  if (Number.isNaN(hbMs)) return 'not_active';
  return nowMs - hbMs <= PRESENCE_HEARTBEAT_TTL_MS ? 'active' : 'not_active';
}

export function sanitizeUserIdSlug(username: string): string {
  const cleaned = username
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return cleaned || `user_${Date.now()}`;
}

export function deduplicateSecondaryUsers(items: SecondaryUserSummary[]): SecondaryUserSummary[] {
  const byEmail = new Map<string, SecondaryUserSummary>();
  const pickLatestIso = (a?: string, b?: string): string | undefined => {
    if (a && b) return a >= b ? a : b;
    return a || b;
  };
  const pickEarliestIso = (a?: string, b?: string): string => {
    if (a && b) return a <= b ? a : b;
    return a || b || new Date().toISOString();
  };
  const getRecencyIso = (u: SecondaryUserSummary): string =>
    [u.disabledAt, u.lastHeartbeatAt, u.lastLoginAt, u.lastLogoutAt, u.createdAt]
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .sort()
      .pop() || '';

  for (const item of items) {
    if (!item?.userId || !item.email) continue;
    const normEmail = item.email.trim().toLowerCase();
    const key = normEmail || item.userId.trim().toLowerCase();
    const prev = byEmail.get(key);
    const aliasSet = new Set<string>([
      item.userId,
      ...(item.aliasUserIds ?? []),
      ...(prev ? [prev.userId, ...(prev.aliasUserIds ?? [])] : []),
    ]);

    if (!prev) {
      byEmail.set(key, {
        ...item,
        email: normEmail,
        role: item.role || 'executive',
        isEnabled: item.isEnabled !== undefined ? item.isEnabled !== false : true,
        aliasUserIds: Array.from(aliasSet),
      });
      continue;
    }

    const incomingRecency = getRecencyIso(item);
    const prevRecency = getRecencyIso(prev);
    const preferIncoming =
      incomingRecency > prevRecency ||
      (incomingRecency === prevRecency &&
        Boolean(item.byocProjectId) &&
        !prev.byocProjectId);

    const primary = preferIncoming ? item : prev;
    const secondary = preferIncoming ? prev : item;

    const latestHeartbeat = pickLatestIso(item.lastHeartbeatAt, prev.lastHeartbeatAt);
    const latestLogin = pickLatestIso(item.lastLoginAt, prev.lastLoginAt);
    const latestLogout = pickLatestIso(item.lastLogoutAt, prev.lastLogoutAt);
    const latestDisabled = pickLatestIso(item.disabledAt, prev.disabledAt);
    const nextIsEnabled =
      primary.isEnabled !== undefined
        ? primary.isEnabled !== false
        : secondary.isEnabled !== undefined
          ? secondary.isEnabled !== false
          : true;

    const livePresence = computeEffectivePresenceStatus({
      isEnabled: nextIsEnabled,
      isActive: primary.isActive || secondary.isActive,
      presenceStatus:
        primary.presenceStatus === 'active' || secondary.presenceStatus === 'active'
          ? 'active'
          : 'not_active',
      lastHeartbeatAt: latestHeartbeat,
    });

    byEmail.set(key, {
      ...secondary,
      ...primary,
      userId: primary.userId,
      username: primary.username || secondary.username,
      email: normEmail,
      role: primary.role || secondary.role || 'executive',
      createdAt: pickEarliestIso(prev.createdAt, item.createdAt),
      lastLoginAt: latestLogin,
      lastHeartbeatAt: latestHeartbeat,
      lastLogoutAt: latestLogout,
      disabledAt: nextIsEnabled ? undefined : latestDisabled,
      isEnabled: nextIsEnabled,
      isActive: nextIsEnabled && livePresence === 'active',
      presenceStatus: nextIsEnabled ? livePresence : 'not_active',
      byocProjectId: primary.byocProjectId || secondary.byocProjectId,
      aliasUserIds: Array.from(aliasSet),
    });
  }

  return Array.from(byEmail.values()).sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || ''),
  );
}

export function buildEmptySecondaryWorkspace(
  session: Pick<CrmUserSession, 'userId' | 'username' | 'email' | 'companyName'>,
): SecondaryWorkspaceSnapshot {
  return {
    firmProfile: {
      firmName: session.companyName || `${session.username} Tender Desk`,
      gstin: '',
      udyamNumber: '',
      adminName: session.username,
      adminPhotoUrl: '',
    },
    preferences: {
      adminPin: '',
      darkMode: false,
    },
    tenders: [],
    emdRecords: [],
    mafTrackers: [],
    oemRecords: [],
    emailSettings: {
      enabled: true,
      recipientName: session.username,
      recipientEmail: session.email,
    },
    emailLogs: [],
    sheetSettings: {
      enabled: false,
      webhookUrl: '',
      sheetName: 'MIS Monthly Report',
    },
    updatedAt: new Date().toISOString(),
  };
}
