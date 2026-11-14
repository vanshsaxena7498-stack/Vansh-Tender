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
  | 'Cancelled / Retendered';

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
  department: string;
  location: string;
  category: string;
  title: string;
  publishDate: string;
  submissionDueDate: string; // YYYY-MM-DDTHH:mm
  preBidDate?: string;
  estimatedValue: number;
  quotedValue: number;
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

export type TabKey = 'dashboard' | 'tenders' | 'emdbg' | 'settings';

export type NotificationCategory = 'deadline_48h' | 'bg_expiry_30d' | 'emd_refund_60d';

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  subtitle: string;
  daysOrHoursLabel: string;
  targetTab: TabKey;
  targetId: string;
}

export interface CrmBackupPayload {
  version: number;
  exportedAt: string;
  profile: FirmProfile;
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
}
