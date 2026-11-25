import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  Check,
  Clock,
  FileText,
  Gavel,
  Search,
} from 'lucide-react';
import type {
  EmdSecurityType,
  FinancialRaStatus,
  PortalType,
  TechnicalEvalStatus,
  Tender,
  TenderStage,
} from '../types/crm';
import {
  BID_RA_RANK_OPTIONS,
  FINANCIAL_RA_STATUS_OPTIONS,
  TECHNICAL_STATUS_OPTIONS,
  toDateTimeLocalInput,
} from '../utils/bidRaStatus';
import {
  formatDateTime,
  formatINR,
  formatShortDate,
  getLatestRemarkText,
  getLocalDateInputValue,
} from '../utils/formatters';
import { isSafeAttachmentHref } from '../utils/attachments';
import { sortRecordsByDate, type DateSortDirection } from '../utils/tableSorting';
import {
  CrmCompactTable,
  DeleteConfirmModal,
  PreviewField,
  RecordPreviewModal,
} from './CompactTableKit';

interface BidRaStatusTabProps {
  tenders: Tender[];
  allTenders: Tender[];
  selectedTenderId?: string | null;
  onSelectTenderId?: (id: string | null) => void;
  onSaveTenderUpdate: (updatedTender: Tender) => void;
  onDeleteTender: (id: string) => void;
}

const PORTAL_OPTIONS: PortalType[] = [
  'GeM',
  'CPPP / eProcure',
  'State Portal',
  'PSU / Direct',
  'Private',
];

const EMD_OPTIONS: EmdSecurityType[] = [
  'Exempted - MSME/Startup',
  'EMD Paid',
  'BG Submitted',
  'No EMD',
];

const STAGE_OPTIONS: TenderStage[] = [
  'Identified / Reviewing',
  'Doc Preparation',
  'Submitted',
  'Technical Eval',
  'Financial / BOQ Eval',
  'L1 / Won',
  'Lost (L2/L3)',
  'Cancelled / Retendered',
  'Tender Not Filled',
];

function getStageBadgeClass(stage: TenderStage): string {
  switch (stage) {
    case 'L1 / Won':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400';
    case 'Lost (L2/L3)':
      return 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400';
    case 'Technical Eval':
    case 'Financial / BOQ Eval':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400';
    case 'Submitted':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400';
    case 'Tender Not Filled':
      return 'bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800/70';
    case 'Cancelled / Retendered':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

function getTechStatusBadgeClass(status: TechnicalEvalStatus): string {
  switch (status) {
    case 'Technically Qualified':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400';
    case 'Technically Disqualified / Rejected':
      return 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400';
    case 'Clarification Sought':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

function getFinancialStatusBadgeClass(status: FinancialRaStatus): string {
  switch (status) {
    case 'L1 / Awarded':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400';
    case 'Not L1 / Lost':
      return 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400';
    case 'RA Scheduled / Live':
      return 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400';
    case 'Financial Opened':
    case 'RA Completed':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400';
    case 'L2 / Runner-up':
      return 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

interface BidRaWorkspaceFormProps {
  tender: Tender;
  allTenders: Tender[];
  onBack: () => void;
  onSave: (updatedTender: Tender) => void;
}

function BidRaWorkspaceForm({
  tender,
  allTenders,
  onBack,
  onSave,
}: BidRaWorkspaceFormProps) {
  const todayLocal = getLocalDateInputValue();

  // Top Form State (exact Daily Tender Data editable fields)
  const [tenderId, setTenderId] = useState(tender.tenderId ?? '');
  const [portal, setPortal] = useState<PortalType>(tender.portal ?? 'GeM');
  const [stage, setStage] = useState<TenderStage>(tender.stage ?? 'Identified / Reviewing');
  const [clientName, setClientName] = useState(tender.clientName ?? tender.department ?? '');
  const [department, setDepartment] = useState(tender.department ?? '');
  const [locationDepartment, setLocationDepartment] = useState(tender.locationDepartment ?? '');
  const [location, setLocation] = useState(tender.location ?? '');
  const [assignedOwner, setAssignedOwner] = useState(tender.assignedOwner ?? '');
  const [category, setCategory] = useState(tender.category ?? '');
  const [title, setTitle] = useState(tender.title ?? '');
  const [publishDate, setPublishDate] = useState(tender.publishDate ?? todayLocal);
  const [submissionDueDate, setSubmissionDueDate] = useState(
    toDateTimeLocalInput(tender.submissionDueDate) || tender.submissionDueDate || `${todayLocal}T17:00`,
  );
  const [preBidDate, setPreBidDate] = useState(tender.preBidDate ?? '');
  const [completionDate, setCompletionDate] = useState(tender.completionDate ?? '');
  const [estimatedValue, setEstimatedValue] = useState(String(tender.estimatedValue ?? 0));
  const [quotedValue, setQuotedValue] = useState(String(tender.quotedValue ?? 0));
  const [emdStatus, setEmdStatus] = useState<EmdSecurityType>(
    tender.emdStatus ?? 'Exempted - MSME/Startup',
  );
  const [emdAmount, setEmdAmount] = useState(String(tender.emdAmount ?? 0));
  const [technicalOpeningDate, setTechnicalOpeningDate] = useState(
    tender.technicalOpeningDate ?? '',
  );
  const [financialOpeningDate, setFinancialOpeningDate] = useState(
    tender.financialOpeningDate ?? '',
  );
  const [l1BidderName, setL1BidderName] = useState(tender.l1BidderName ?? '');
  const [l1QuotedValue, setL1QuotedValue] = useState(
    tender.l1QuotedValue ? String(tender.l1QuotedValue) : '',
  );
  const [ourPositionRank, setOurPositionRank] = useState(tender.ourPositionRank ?? '');
  const [resultInfo, setResultInfo] = useState(tender.resultInfo ?? '');

  // Bottom Form State (Technical & Financial / RA Update)
  const [technicalStatus, setTechnicalStatus] = useState<TechnicalEvalStatus>(
    tender.technicalStatus ?? 'Pending',
  );
  const [technicalOpeningDateTime, setTechnicalOpeningDateTime] = useState(
    tender.technicalOpeningDateTime ?? '',
  );
  const [technicalRemarks, setTechnicalRemarks] = useState(tender.technicalRemarks ?? '');
  const [financialRaStatus, setFinancialRaStatus] = useState<FinancialRaStatus>(
    tender.financialRaStatus ?? 'Not Opened',
  );
  const [financialOpeningRaDateTime, setFinancialOpeningRaDateTime] = useState(
    tender.financialOpeningRaDateTime ?? '',
  );
  const [raFinalValue, setRaFinalValue] = useState(
    tender.raFinalValue ? String(tender.raFinalValue) : '',
  );
  const [raFinancialRemarks, setRaFinancialRemarks] = useState(
    tender.raFinancialRemarks ?? '',
  );

  const [errorMsg, setErrorMsg] = useState('');

  const supportsEmdSync = emdStatus === 'EMD Paid' || emdStatus === 'BG Submitted';

  const hasCustomRank =
    Boolean(ourPositionRank.trim()) &&
    !(BID_RA_RANK_OPTIONS as readonly string[]).includes(ourPositionRank.trim());

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleanTenderId = tenderId.trim();
    if (!cleanTenderId || !department.trim() || !title.trim() || !submissionDueDate) {
      setErrorMsg('Please fill Tender ID, Department, Work Title, and Submission Due Date.');
      return;
    }

    const duplicateTender = allTenders.find(
      (t) =>
        t.id !== tender.id &&
        t.tenderId.trim().toLowerCase() === cleanTenderId.toLowerCase(),
    );
    if (duplicateTender) {
      setErrorMsg(
        `Tender ID "${cleanTenderId}" is already tracked in another record. Please enter a unique Tender ID.`,
      );
      return;
    }

    const parsedDue = new Date(submissionDueDate);
    if (Number.isNaN(parsedDue.getTime())) {
      setErrorMsg('Please enter a valid Submission Due Date & Time.');
      return;
    }
    if (publishDate && submissionDueDate.slice(0, 10) < publishDate) {
      setErrorMsg('Submission Due Date cannot be earlier than Publish Date.');
      return;
    }

    const parsedEst = Math.max(0, Number(estimatedValue) || 0);
    const parsedQuoted = Math.max(0, Number(quotedValue) || 0);
    const parsedL1Quoted = Math.max(0, Number(l1QuotedValue) || 0);
    const parsedRaFinal = Math.max(0, Number(raFinalValue) || 0);
    const parsedEmd = supportsEmdSync ? Math.max(0, Number(emdAmount) || 0) : 0;

    if (supportsEmdSync && parsedEmd <= 0) {
      setErrorMsg('Please enter a valid EMD / BG Amount greater than ₹ 0.');
      return;
    }

    setErrorMsg('');
    const nowIso = new Date().toISOString();
    const cleanDept = department.trim();
    const cleanLoc = location.trim() || 'India';
    const resolvedTechDate =
      technicalOpeningDate.trim() ||
      (technicalOpeningDateTime ? technicalOpeningDateTime.slice(0, 10) : '');
    const resolvedFinDate =
      financialOpeningDate.trim() ||
      (financialOpeningRaDateTime ? financialOpeningRaDateTime.slice(0, 10) : '');

    const updatedTender: Tender = {
      ...tender,
      tenderId: cleanTenderId,
      portal,
      stage,
      clientName: clientName.trim() || cleanDept,
      department: cleanDept,
      locationDepartment:
        locationDepartment.trim() || [cleanLoc, cleanDept].filter(Boolean).join(' / '),
      location: cleanLoc,
      assignedOwner: assignedOwner.trim() || undefined,
      category: category.trim() || 'General Supply & Services',
      title: title.trim(),
      publishDate,
      submissionDueDate,
      preBidDate: preBidDate || undefined,
      completionDate: completionDate || undefined,
      estimatedValue: parsedEst,
      quotedValue: parsedQuoted,
      emdStatus,
      emdAmount: parsedEmd,
      technicalOpeningDate: resolvedTechDate || undefined,
      financialOpeningDate: resolvedFinDate || undefined,
      l1BidderName: l1BidderName.trim() || undefined,
      l1QuotedValue: parsedL1Quoted > 0 ? parsedL1Quoted : undefined,
      ourPositionRank: ourPositionRank.trim() || undefined,
      resultInfo: resultInfo.trim(),
      technicalStatus,
      technicalOpeningDateTime: technicalOpeningDateTime || undefined,
      technicalRemarks: technicalRemarks.trim() || undefined,
      financialRaStatus,
      financialOpeningRaDateTime: financialOpeningRaDateTime || undefined,
      raFinalValue: parsedRaFinal > 0 ? parsedRaFinal : undefined,
      raFinancialRemarks: raFinancialRemarks.trim() || undefined,
      updatedAt: nowIso,
      lastUpdatedAt: nowIso,
    };

    onSave(updatedTender);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Workspace Action Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to BID/RA List</span>
          </button>
          <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 hidden sm:block" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-mono-num text-sm sm:text-base font-semibold text-slate-900 dark:text-white truncate">
                {tender.tenderId}
              </h2>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${getStageBadgeClass(
                  stage,
                )}`}
              >
                {stage}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-2xl">
              {tender.title}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Save / Update Record</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/50 px-4 py-3 text-xs font-medium text-red-700 dark:text-red-300"
        >
          {errorMsg}
        </div>
      )}

      {/* TOP SECTION: Existing Daily Tender Data Form Entries */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2.5">
          1. Tender Identification & Department
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="bidra-tender-id"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Tender ID / Bid No. *
            </label>
            <input
              id="bidra-tender-id"
              type="text"
              required
              value={tenderId}
              onChange={(e) => setTenderId(e.target.value)}
              placeholder="e.g. GEM/2026/B/5489210"
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-portal"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Portal / Source *
            </label>
            <select
              id="bidra-portal"
              value={portal}
              onChange={(e) => setPortal(e.target.value as PortalType)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {PORTAL_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="bidra-stage"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Current Stage / Status
            </label>
            <select
              id="bidra-stage"
              value={stage}
              onChange={(e) => setStage(e.target.value as TenderStage)}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                stage === 'Tender Not Filled'
                  ? 'border-red-400 dark:border-red-700 bg-red-50/70 dark:bg-red-950/30 text-red-800 dark:text-red-200 font-medium focus:ring-red-500'
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:ring-blue-600'
              }`}
            >
              {STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="bidra-client-name"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Client / Organization Name
            </label>
            <input
              id="bidra-client-name"
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Defaults to Department Name"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-department"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Department / Organization Name *
            </label>
            <input
              id="bidra-department"
              type="text"
              required
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. Ministry of Defence (MES)"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-location-dept"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Location / Department (MIS Col 4)
            </label>
            <input
              id="bidra-location-dept"
              type="text"
              value={locationDepartment}
              onChange={(e) => setLocationDepartment(e.target.value)}
              placeholder="e.g. HQ Western Command / MES"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-location"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Location (City / State)
            </label>
            <input
              id="bidra-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Pune, Maharashtra"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-assigned-owner"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Assigned Person / Owner
            </label>
            <input
              id="bidra-assigned-owner"
              type="text"
              value={assignedOwner}
              onChange={(e) => setAssignedOwner(e.target.value)}
              placeholder="e.g. Vansh Saxena"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-category"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Work / Item Category
            </label>
            <input
              id="bidra-category"
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. IT Hardware & Networking"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label
              htmlFor="bidra-title"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Brief Description & Scope of Work (Work / Supply Title) *
            </label>
            <input
              id="bidra-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Supply & Installation of Managed Network Switches & Firewall"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
        <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-2.5">
          2. Schedule, Financials & Bid Security (EMD / BG)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label
              htmlFor="bidra-pub-date"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Publish Date
            </label>
            <input
              id="bidra-pub-date"
              type="date"
              value={publishDate}
              onChange={(e) => setPublishDate(e.target.value)}
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-due-date"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Submission Due Date & Time *
            </label>
            <input
              id="bidra-due-date"
              type="datetime-local"
              required
              value={submissionDueDate}
              onChange={(e) => setSubmissionDueDate(e.target.value)}
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-prebid-date"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Pre-Bid Meeting Date (Optional)
            </label>
            <input
              id="bidra-prebid-date"
              type="date"
              value={preBidDate}
              onChange={(e) => setPreBidDate(e.target.value)}
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-completion-date"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Tender Result / Completion Date
            </label>
            <input
              id="bidra-completion-date"
              type="date"
              value={completionDate}
              onChange={(e) => setCompletionDate(e.target.value)}
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-est-val"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Estimated Tender Value (₹)
            </label>
            <input
              id="bidra-est-val"
              type="number"
              min={0}
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
              placeholder="e.g. 15000000"
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-quoted-val"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Our Quoted Bid Value (₹)
            </label>
            <input
              id="bidra-quoted-val"
              type="number"
              min={0}
              value={quotedValue}
              onChange={(e) => setQuotedValue(e.target.value)}
              placeholder="e.g. 14250000"
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-emd-status"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              EMD / Bid Security Required
            </label>
            <select
              id="bidra-emd-status"
              value={emdStatus}
              onChange={(e) => setEmdStatus(e.target.value as EmdSecurityType)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {EMD_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="bidra-emd-amt"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              EMD Amount (₹)
            </label>
            <input
              id="bidra-emd-amt"
              type="number"
              min={0}
              disabled={!supportsEmdSync}
              value={supportsEmdSync ? emdAmount : '0'}
              onChange={(e) => setEmdAmount(e.target.value)}
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:bg-slate-100 dark:disabled:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-tech-open-date"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Technical Opening Date
            </label>
            <input
              id="bidra-tech-open-date"
              type="date"
              value={technicalOpeningDate}
              onChange={(e) => setTechnicalOpeningDate(e.target.value)}
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-fin-open-date"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Financial Opening Date
            </label>
            <input
              id="bidra-fin-open-date"
              type="date"
              value={financialOpeningDate}
              onChange={(e) => setFinancialOpeningDate(e.target.value)}
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-l1-bidder"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              L1 Bidder Name
            </label>
            <input
              id="bidra-l1-bidder"
              type="text"
              value={l1BidderName}
              onChange={(e) => setL1BidderName(e.target.value)}
              placeholder="e.g. Winning Firm Name"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-l1-val"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              L1 Quoted Value (₹)
            </label>
            <input
              id="bidra-l1-val"
              type="number"
              min={0}
              value={l1QuotedValue}
              onChange={(e) => setL1QuotedValue(e.target.value)}
              placeholder="e.g. 13900000"
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-our-rank"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Our Position / Rank
            </label>
            <input
              id="bidra-our-rank"
              type="text"
              value={ourPositionRank}
              onChange={(e) => setOurPositionRank(e.target.value)}
              placeholder="e.g. L1, L2, Qualified"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label
              htmlFor="bidra-result-info"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Result / L1 Price Info & Next Action Summary
            </label>
            <input
              id="bidra-result-info"
              type="text"
              value={resultInfo}
              onChange={(e) => setResultInfo(e.target.value)}
              placeholder="e.g. Declared L1 or L2 behind competitor at ₹ X"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      </section>

      {/* BOTTOM SECTION: Technical & Financial / RA Update */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2.5">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Gavel className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400" aria-hidden="true" />
            <span>3. Technical & Financial / RA Update</span>
          </h3>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Post-Submission Technical Evaluation, Financial Opening & Reverse Auction Tracking
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label
              htmlFor="bidra-tech-status"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Technical Status
            </label>
            <select
              id="bidra-tech-status"
              value={technicalStatus}
              onChange={(e) => setTechnicalStatus(e.target.value as TechnicalEvalStatus)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {TECHNICAL_STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="bidra-tech-datetime"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Technical Opening Date & Time
            </label>
            <input
              id="bidra-tech-datetime"
              type="datetime-local"
              value={technicalOpeningDateTime}
              onChange={(e) => {
                const next = e.target.value;
                setTechnicalOpeningDateTime(next);
                if (next && /^\d{4}-\d{2}-\d{2}/.test(next)) {
                  setTechnicalOpeningDate(next.slice(0, 10));
                }
              }}
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-fin-ra-status"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Financial / RA Status
            </label>
            <select
              id="bidra-fin-ra-status"
              value={financialRaStatus}
              onChange={(e) => setFinancialRaStatus(e.target.value as FinancialRaStatus)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {FINANCIAL_RA_STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="bidra-fin-ra-datetime"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Financial Opening / RA Date & Time
            </label>
            <input
              id="bidra-fin-ra-datetime"
              type="datetime-local"
              value={financialOpeningRaDateTime}
              onChange={(e) => {
                const next = e.target.value;
                setFinancialOpeningRaDateTime(next);
                if (next && /^\d{4}-\d{2}-\d{2}/.test(next)) {
                  setFinancialOpeningDate(next.slice(0, 10));
                }
              }}
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-update-quoted-val"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Our Quoted Value (INR)
            </label>
            <input
              id="bidra-update-quoted-val"
              type="number"
              min={0}
              value={quotedValue}
              onChange={(e) => setQuotedValue(e.target.value)}
              placeholder="e.g. 14250000"
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-update-l1-bidder"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              L1 Bidder Name
            </label>
            <input
              id="bidra-update-l1-bidder"
              type="text"
              value={l1BidderName}
              onChange={(e) => setL1BidderName(e.target.value)}
              placeholder="e.g. Winning Firm Name"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-update-l1-val"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              L1 Quoted Value (INR)
            </label>
            <input
              id="bidra-update-l1-val"
              type="number"
              min={0}
              value={l1QuotedValue}
              onChange={(e) => setL1QuotedValue(e.target.value)}
              placeholder="e.g. 13900000"
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-ra-final-val"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              RA Final Value (INR)
            </label>
            <input
              id="bidra-ra-final-val"
              type="number"
              min={0}
              value={raFinalValue}
              onChange={(e) => setRaFinalValue(e.target.value)}
              placeholder="e.g. 13650000"
              className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="bidra-rank-select"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Our Rank / Position
            </label>
            <select
              id="bidra-rank-select"
              value={ourPositionRank}
              onChange={(e) => setOurPositionRank(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">Select Rank / Position</option>
              {BID_RA_RANK_OPTIONS.map((rank) => (
                <option key={rank} value={rank}>
                  {rank}
                </option>
              ))}
              {hasCustomRank && (
                <option value={ourPositionRank}>{ourPositionRank}</option>
              )}
            </select>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label
              htmlFor="bidra-tech-remarks"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Technical Remarks / Deviations
            </label>
            <textarea
              id="bidra-tech-remarks"
              rows={2}
              value={technicalRemarks}
              onChange={(e) => setTechnicalRemarks(e.target.value)}
              placeholder="Technical qualification notes, clarification queries, or compliance deviations..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <label
              htmlFor="bidra-ra-remarks"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              RA & Financial Remarks
            </label>
            <textarea
              id="bidra-ra-remarks"
              rows={2}
              value={raFinancialRemarks}
              onChange={(e) => setRaFinancialRemarks(e.target.value)}
              placeholder="Financial bid opening summary, Reverse Auction decrement notes, L1 comparison..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      </section>

      {/* Bottom Footer Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Back to BID/RA List</span>
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Back
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Save / Update Bid & RA Record</span>
          </button>
        </div>
      </div>
    </form>
  );
}

export function BidRaStatusTab({
  tenders,
  allTenders,
  selectedTenderId,
  onSelectTenderId,
  onSaveTenderUpdate,
  onDeleteTender,
}: BidRaStatusTabProps) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [techFilter, setTechFilter] = useState<'ALL' | TechnicalEvalStatus>('ALL');
  const [finFilter, setFinFilter] = useState<'ALL' | FinancialRaStatus>('ALL');
  const [dateSortDir, setDateSortDir] = useState<DateSortDirection>('desc');
  const [previewTender, setPreviewTender] = useState<Tender | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tender | null>(null);

  const activeSelectedId =
    selectedTenderId !== undefined ? selectedTenderId : internalSelectedId;

  const setActiveSelectedId = (id: string | null) => {
    if (onSelectTenderId) {
      onSelectTenderId(id);
    } else {
      setInternalSelectedId(id);
    }
  };

  const selectedTender = useMemo(
    () => (activeSelectedId ? tenders.find((t) => t.id === activeSelectedId) ?? null : null),
    [tenders, activeSelectedId],
  );

  const summaryCounts = useMemo(() => {
    let pendingTech = 0;
    let techQualified = 0;
    let raActive = 0;
    let l1Awarded = 0;

    for (const t of tenders) {
      const tech = t.technicalStatus ?? 'Pending';
      const fin = t.financialRaStatus ?? 'Not Opened';
      if (tech === 'Pending') pendingTech += 1;
      if (tech === 'Technically Qualified') techQualified += 1;
      if (fin === 'RA Scheduled / Live' || fin === 'Financial Opened') raActive += 1;
      if (fin === 'L1 / Awarded' || t.stage === 'L1 / Won') l1Awarded += 1;
    }
    return {
      total: tenders.length,
      pendingTech,
      techQualified,
      raActive,
      l1Awarded,
    };
  }, [tenders]);

  const filteredTenders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched = tenders.filter((t) => {
      if (q) {
        const matches =
          t.tenderId.toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          (t.clientName || '').toLowerCase().includes(q) ||
          t.department.toLowerCase().includes(q) ||
          t.location.toLowerCase().includes(q) ||
          (t.l1BidderName || '').toLowerCase().includes(q) ||
          (t.assignedOwner || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      const tech = t.technicalStatus ?? 'Pending';
      const fin = t.financialRaStatus ?? 'Not Opened';
      if (techFilter !== 'ALL' && tech !== techFilter) return false;
      if (finFilter !== 'ALL' && fin !== finFilter) return false;
      return true;
    });
    return sortRecordsByDate(matched, (t) => t.submissionDueDate, dateSortDir);
  }, [tenders, searchQuery, techFilter, finFilter, dateSortDir]);

  if (selectedTender) {
    return (
      <BidRaWorkspaceForm
        key={selectedTender.id}
        tender={selectedTender}
        allTenders={allTenders}
        onBack={() => setActiveSelectedId(null)}
        onSave={onSaveTenderUpdate}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Due-Passed Tenders
          </p>
          <p className="font-mono-num text-xl font-bold text-slate-900 dark:text-white mt-0.5">
            {summaryCounts.total}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Pending Tech Eval
          </p>
          <p className="font-mono-num text-xl font-bold text-slate-900 dark:text-white mt-0.5">
            {summaryCounts.pendingTech}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Tech Qualified
          </p>
          <p className="font-mono-num text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
            {summaryCounts.techQualified}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Financial / RA Active
          </p>
          <p className="font-mono-num text-xl font-bold text-blue-700 dark:text-blue-400 mt-0.5">
            {summaryCounts.raActive}
          </p>
        </div>
        <div className="col-span-2 sm:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            L1 / Awarded
          </p>
          <p className="font-mono-num text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
            {summaryCounts.l1Awarded}
          </p>
        </div>
      </div>

      {/* Info Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <Clock className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400 shrink-0" aria-hidden="true" />
          <span>
            Tenders from <span className="font-semibold">Daily Tender Data</span> automatically move here once their Due Date &amp; Time passes. Select any tender to update both tender details and Technical / Financial / RA evaluation status.
          </span>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
          <div className="sm:col-span-6 relative">
            <Search
              className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Tender ID, Department, Work Title, L1 Bidder, Owner..."
              aria-label="Search due-passed tenders"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="sm:col-span-3">
            <select
              aria-label="Filter by Technical Status"
              value={techFilter}
              onChange={(e) =>
                setTechFilter(e.target.value as 'ALL' | TechnicalEvalStatus)
              }
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">All Technical Statuses</option>
              {TECHNICAL_STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-3">
            <select
              aria-label="Filter by Financial / RA Status"
              value={finFilter}
              onChange={(e) =>
                setFinFilter(e.target.value as 'ALL' | FinancialRaStatus)
              }
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">All Financial / RA Statuses</option>
              {FINANCIAL_RA_STATUS_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Compact 6-Column + Actions Table */}
      <CrmCompactTable
        rows={filteredTenders}
        getRowKey={(t) => t.id}
        getTenderNo={(t) => t.tenderId}
        onClickTenderNo={(t) => setActiveSelectedId(t.id)}
        getDepartmentName={(t) => t.clientName || t.department}
        getLocation={(t) => t.location || '—'}
        getDateLabel={(t) => formatShortDate(t.submissionDueDate)}
        getDescription={(t) => t.title}
        getRecordLabel={(t) => t.tenderId}
        getRowClassName={(t) =>
          t.stage === 'Tender Not Filled'
            ? 'bg-red-50/75 hover:bg-red-100/75 dark:bg-red-950/30 dark:hover:bg-red-950/45'
            : ''
        }
        dateSortDir={dateSortDir}
        onToggleDateSort={() =>
          setDateSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))
        }
        onPreview={(t) => setPreviewTender(t)}
        onEdit={(t) => setActiveSelectedId(t.id)}
        onRequestDelete={(t) => setDeleteTarget(t)}
        emptyContent={
          <div className="py-10 px-4 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2.5">
            <p>
              {tenders.length === 0
                ? 'No due-passed tenders yet. Tenders move here automatically once their Due Date & Time passes.'
                : 'No due-passed tenders match your current search or filters.'}
            </p>
            {(searchQuery || techFilter !== 'ALL' || finFilter !== 'ALL') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setTechFilter('ALL');
                  setFinFilter('ALL');
                }}
                className="px-3.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                Clear Filters
              </button>
            )}
          </div>
        }
      />

      {/* Full-Detail Read-Only Preview Modal */}
      {previewTender && (
        <RecordPreviewModal
          open
          title={previewTender.tenderId}
          subtitle={`${previewTender.department} · ${previewTender.location || 'India'}`}
          badge={
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${getStageBadgeClass(
                  previewTender.stage,
                )}`}
              >
                {previewTender.stage}
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${getTechStatusBadgeClass(
                  previewTender.technicalStatus ?? 'Pending',
                )}`}
              >
                {previewTender.technicalStatus ?? 'Pending'}
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${getFinancialStatusBadgeClass(
                  previewTender.financialRaStatus ?? 'Not Opened',
                )}`}
              >
                {previewTender.financialRaStatus ?? 'Not Opened'}
              </span>
            </div>
          }
          onClose={() => setPreviewTender(null)}
        >
          <div className="space-y-5">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-4">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Brief Description &amp; Scope of Work
              </p>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mt-1">
                {previewTender.title}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
              <PreviewField
                label="Client / Organization Name"
                value={previewTender.clientName || previewTender.department}
              />
              <PreviewField
                label="Location / Department"
                value={
                  previewTender.locationDepartment ||
                  [previewTender.location, previewTender.department].filter(Boolean).join(' / ')
                }
              />
              <PreviewField label="Portal / Source" value={previewTender.portal} />
              <PreviewField label="Location" value={previewTender.location || '—'} />
              <PreviewField
                label="Assigned Person / Owner"
                value={previewTender.assignedOwner || '—'}
              />
              <PreviewField label="Category" value={previewTender.category || '—'} />
              <PreviewField
                label="Publish Date"
                value={formatShortDate(previewTender.publishDate)}
                mono
              />
              <PreviewField
                label="Submission Due Date & Time"
                value={formatDateTime(previewTender.submissionDueDate)}
                mono
              />
              <PreviewField
                label="Technical Opening"
                value={
                  previewTender.technicalOpeningDateTime
                    ? formatDateTime(previewTender.technicalOpeningDateTime)
                    : formatShortDate(previewTender.technicalOpeningDate)
                }
                mono
              />
              <PreviewField
                label="Financial / RA Date & Time"
                value={
                  previewTender.financialOpeningRaDateTime
                    ? formatDateTime(previewTender.financialOpeningRaDateTime)
                    : formatShortDate(
                        previewTender.financialOpeningDate || previewTender.completionDate,
                      )
                }
                mono
              />
              <PreviewField
                label="Estimated Value (INR)"
                value={formatINR(previewTender.estimatedValue)}
                mono
              />
              <PreviewField
                label="Our Quoted Value (INR)"
                value={
                  previewTender.quotedValue > 0 ? formatINR(previewTender.quotedValue) : '—'
                }
                mono
              />
              <PreviewField
                label="RA Final Value (INR)"
                value={
                  previewTender.raFinalValue && previewTender.raFinalValue > 0
                    ? formatINR(previewTender.raFinalValue)
                    : '—'
                }
                mono
              />
              <PreviewField label="L1 Bidder Name" value={previewTender.l1BidderName || '—'} />
              <PreviewField
                label="L1 Quoted Value (INR)"
                value={
                  previewTender.l1QuotedValue && previewTender.l1QuotedValue > 0
                    ? formatINR(previewTender.l1QuotedValue)
                    : '—'
                }
                mono
              />
              <PreviewField
                label="Our Position / Rank"
                value={previewTender.ourPositionRank || '—'}
              />
              <PreviewField
                label="EMD Security"
                value={`${
                  previewTender.emdAmount > 0 ? formatINR(previewTender.emdAmount) : 'Exempt / ₹ 0'
                } (${previewTender.emdStatus})`}
                mono
              />
            </div>

            <div className="space-y-3">
              <PreviewField
                label="Technical Remarks / Deviations"
                value={previewTender.technicalRemarks || '—'}
              />
              <PreviewField
                label="RA & Financial Remarks"
                value={previewTender.raFinancialRemarks || '—'}
              />
              <PreviewField
                label="Result / Remarks Summary"
                value={
                  [previewTender.resultInfo, getLatestRemarkText(previewTender.remarks)]
                    .filter(Boolean)
                    .join(' | ') || '—'
                }
              />
            </div>

            {previewTender.attachments && previewTender.attachments.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Attached Documents ({previewTender.attachments.length})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {previewTender.attachments.map((att) =>
                    isSafeAttachmentHref(att.dataUrl) ? (
                      <a
                        key={att.id}
                        href={att.dataUrl}
                        download={att.fileName}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs text-slate-700 dark:text-slate-200"
                      >
                        <FileText className="h-3.5 w-3.5 text-[#1E3A8A] dark:text-blue-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{att.fileName}</p>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {att.slotLabel}
                          </p>
                        </div>
                      </a>
                    ) : (
                      <div
                        key={att.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-700 dark:text-rose-300"
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium truncate">{att.fileName}</p>
                          <p className="text-[10px]">Unsafe attachment blocked</p>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            )}
          </div>
        </RecordPreviewModal>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title={`Delete Tender ${deleteTarget?.tenderId ?? ''}`}
        description={`Are you sure you want to permanently delete tender "${
          deleteTarget?.tenderId ?? ''
        }" (${deleteTarget?.department ?? ''})?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            onDeleteTender(deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
