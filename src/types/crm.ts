export type PortalType =
  | 'GeM'
  | 'CPPP / eProcure'
  | 'State Portal'
  | 'PSU / Direct'
  | 'Private';

export type EmdSecurityType =
  | 'Exempted - MSME/Startup'
  | 'EMD Paid'
  | 'BG Submitted'
  | 'No EMD';

export type TenderStage =
  | 'Identified / Reviewing'
  | 'Doc Preparation'
  | 'Submitted'
  | 'Technical Eval'
  | 'Financial / BOQ Eval'
  | 'L1 / Won'
  | 'Lost (L2/L3)'
  | 'Cancelled / Retendered'
  | 'Tender Not Filled';

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export interface RemarkEntry {
  id: string;
  timestamp: string;
  text: string;
}

export interface AttachmentItem {
  id: string;
  slotLabel: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  dataUrl: string;
}

export interface Tender {
  id: string;
  tenderId: string;
  portal: PortalType;
  clientName?: string;
  department: string;
  locationDepartment?: string;
  location: string;
  category: string;
  title: string;
  publishDate: string;
  submissionDueDate: string; // YYYY-MM-DDTHH:mm
  preBidDate?: string;
  technicalOpeningDate?: string;
  financialOpeningDate?: string;
  estimatedValue: number;
  quotedValue: number;
  l1BidderName?: string;
  l1QuotedValue?: number;
  ourPositionRank?: string;
  assignedOwner?: string;
  emdStatus: EmdSecurityType;
  emdAmount: number;
  stage: TenderStage;
  resultInfo: string;
  completionDate?: string;
  checklist: ChecklistItem[];
  remarks: RemarkEntry[];
  attachments?: AttachmentItem[];
  createdAt: string;
  updatedAt: string;
  lastUpdatedAt?: string;
}

export type InstrumentType =
  | 'Online / NEFT / RTGS'
  | 'Demand Draft (DD)'
  | 'Bank Guarantee (PBG / Bid BG)'
  | 'FDR / TDR'
  | 'e-PBG';

export type FinancialStatus =
  | 'Active / Locked'
  | 'Extension Requested'
  | 'Refund / Release Applied'
  | 'Refunded / Released'
  | 'Forfeited';

export interface EmdBgRecord {
  id: string;
  tenderRefId?: string;
  tenderId: string;
  department: string;
  instrumentType: InstrumentType;
  referenceNo: string;
  bankName: string;
  amount: number;
  issueDate: string;
  expiryDate: string;
  claimEndDate: string;
  status: FinancialStatus;
  refundDate?: string;
  refundRef?: string;
  remarks: string;
  attachments?: AttachmentItem[];
}

export interface FirmProfile {
  firmName: string;
  gstin: string;
  udyamNumber: string;
  adminName: string;
  adminPhotoUrl?: string;
}

export interface UserPreferences {
  adminPin: string;
  darkMode: boolean;
}

export type TabKey = 'dashboard' | 'bidsearch' | 'tenders' | 'maf' | 'emdbg' | 'settings';

export interface ExtractedBidDraft {
  tenderId: string;
  portal: PortalType;
  stage: TenderStage;
  clientName?: string;
  department: string;
  locationDepartment?: string;
  location: string;
  title: string;
  category: string;
  publishDate: string;
  submissionDueDate: string;
  preBidDate: string;
  technicalOpeningDate?: string;
  financialOpeningDate?: string;
  completionDate: string;
  estimatedValue: number;
  quotedValue: number;
  l1BidderName?: string;
  l1QuotedValue?: number;
  ourPositionRank?: string;
  assignedOwner?: string;
  emdStatus: EmdSecurityType;
  emdAmount: number;
  resultInfo: string;
}

export type MafItemStatus =
  | 'Pending'
  | 'Not Requested'
  | 'Requested / Follow-up'
  | 'Under Approval'
  | 'Received / Approved'
  | 'Rejected';

export interface MafLineItem {
  itemId: string;
  itemName: string;
  requiredQuantity: string;
  oemName: string;
  companyName?: string;
  concernedPersonName?: string;
  contactNo?: string;
  mailId?: string;
  oemContact?: string;
  mafStatus: MafItemStatus;
  mafRequestedDate: string;
  validityDate?: string;
  mafDocumentUrl: string;
  mafDocumentName?: string;
  mafAttachmentId?: string;
  remarks: string;
  updatedAt?: string;
}

export interface MafTrackerRecord {
  id: string;
  tenderRefId: string;
  tenderId: string;
  tenderTitle?: string;
  department?: string;
  tenderDueDate?: string;
  itemsMAF: MafLineItem[];
  createdAt: string;
  updatedAt: string;
}

export type NotificationCategory = 'deadline_5d' | 'bg_expiry_30d' | 'emd_refund_60d';

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  subtitle: string;
  daysOrHoursLabel: string;
  targetTab: TabKey;
  targetId: string;
}

export type EmailReminderSlot = 'slot_11am' | 'slot_4pm';

export interface EmailAlertSettings {
  enabled: boolean;
  recipientName: string;
  recipientEmail: string;
}

export interface EmailAlertLog {
  id: string;
  slotKey: string;
  tenderRefId: string;
  tenderId: string;
  slot: EmailReminderSlot | 'manual' | 'test';
  recipientName: string;
  recipientEmail: string;
  dueDateIso: string;
  status: 'sent' | 'failed';
  provider: string;
  subject: string;
  message: string;
  createdAt: string;
}

export type SheetSyncAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'FULL_SYNC' | 'PING';

export type SheetSyncEntityType = 'TENDER' | 'EMD_BG' | 'BULK' | 'SYSTEM';

export type SheetSyncStatus = 'unconfigured' | 'idle' | 'syncing' | 'synced' | 'error';

export interface GoogleSheetSettings {
  enabled: boolean;
  webhookUrl: string;
  sheetName: string;
  lastSyncedAt?: string;
}

export interface CrmBackupPayload {
  version: number;
  exportedAt: string;
  profile: FirmProfile;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  mafTrackers?: MafTrackerRecord[];
}

export type CrmUserRole = 'admin' | 'secondary';

export type PresenceStatus = 'active' | 'not_active';

export interface ByocFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  firestoreDatabaseId?: string;
  updatedAt?: string;
  verifiedAt?: string;
}

export type ByocConnectionStatus = 'pending' | 'auth_required' | 'connected' | 'error';

export interface ByocConnectionState {
  status: ByocConnectionStatus;
  message?: string;
  projectId?: string;
  databaseId?: string;
  verifiedAt?: string;
}

export interface CrmUserSession {
  userId: string;
  username: string;
  email: string;
  role: CrmUserRole;
  createdAt?: string;
  lastLoginAt?: string;
  isEnabled?: boolean;
  disabledAt?: string;
  presenceStatus?: PresenceStatus;
  lastHeartbeatAt?: string;
  lastLogoutAt?: string;
  byocProjectId?: string;
  byocDatabaseId?: string;
  byocConfig?: ByocFirebaseConfig | null;
}

export interface SecondaryUserSummary {
  userId: string;
  username: string;
  email: string;
  role: CrmUserRole;
  createdAt: string;
  lastLoginAt?: string;
  isActive: boolean;
  isEnabled?: boolean;
  disabledAt?: string;
  presenceStatus?: PresenceStatus;
  lastHeartbeatAt?: string;
  lastLogoutAt?: string;
  byocProjectId?: string;
}

