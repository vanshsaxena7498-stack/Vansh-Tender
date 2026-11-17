import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CloudUpload,
  FileCheck2,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  RotateCcw,
  ScanSearch,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type {
  AttachmentItem,
  EmdSecurityType,
  ExtractedBidDraft,
  PortalType,
  Tender,
  TenderStage,
} from '../types/crm';
import {
  formatFileSize,
  MAX_ATTACHMENT_BYTES,
  readAttachmentForFirestore,
  readFileAsDataUrl,
  TENDER_DEFAULT_SLOT_LABELS,
} from '../utils/attachments';
import {
  buildTenderFromBidDraft,
  findDuplicateTender,
} from '../utils/bidSearchParser';
import { sanitizeExtractErrorMessage } from '../utils/geminiRetry';
import { formatINR, formatShortDate, getDaysRemaining } from '../utils/formatters';

const EXTRACT_PDF_TIMEOUT_MS = 45_000;

interface BidSearchTabProps {
  tenders: Tender[];
  onSaveScannedTender: (tender: Tender, syncToEmd: boolean) => void;
  onOpenExistingTender: (tender: Tender) => void;
  onAddManualTender: () => void;
  onGoToDailyTenders: () => void;
  onNotify: (type: 'ok' | 'err', msg: string) => void;
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

interface ScannedBidCardState {
  scanId: string;
  file: File;
  fileName: string;
  fileSize: number;
  status: 'scanning' | 'ready' | 'error' | 'saved';
  errorMsg?: string;
  modelUsed?: string;
  fallbackUsed?: boolean;
  draft?: ExtractedBidDraft;
  attachment1: AttachmentItem | null;
  attachmentWarning?: string;
  syncToEmd: boolean;
  savedTenderId?: string;
  savedTenderRecord?: Tender;
}

interface ParsedExtractResponse {
  ok?: boolean;
  success?: boolean;
  modelUsed?: string;
  fallbackUsed?: boolean;
  extracted?: ExtractedBidDraft;
  error?: string;
}

async function safeReadExtractResponse(res: Response): Promise<{
  json: ParsedExtractResponse | null;
  rawText: string;
}> {
  const rawText = await res.text().catch(() => '');
  if (!rawText) return { json: null, rawText: '' };
  try {
    return { json: JSON.parse(rawText) as ParsedExtractResponse, rawText };
  } catch {
    return { json: null, rawText };
  }
}

export function BidSearchTab({
  tenders,
  onSaveScannedTender,
  onOpenExistingTender,
  onAddManualTender,
  onGoToDailyTenders,
  onNotify,
}: BidSearchTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tendersRef = useRef(tenders);
  tendersRef.current = tenders;
  const [isDragging, setIsDragging] = useState(false);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [scanQueue, setScanQueue] = useState<ScannedBidCardState[]>([]);
  const [recentSearchQuery, setRecentSearchQuery] = useState('');

  const scanningCount = useMemo(
    () => scanQueue.filter((item) => item.status === 'scanning').length,
    [scanQueue],
  );

  const readyUnsavedItems = useMemo(() => {
    return scanQueue.filter((item) => {
      if (item.status !== 'ready' || !item.draft) return false;
      if (!item.draft.tenderId.trim() || !item.draft.department.trim() || !item.draft.title.trim()) {
        return false;
      }
      return !findDuplicateTender(tenders, item.draft.tenderId);
    });
  }, [scanQueue, tenders]);

  const recentBidRows = useMemo(() => {
    const q = recentSearchQuery.trim().toLowerCase();
    return tenders
      .filter((t) => {
        if (q) {
          return (
            t.tenderId.toLowerCase().includes(q) ||
            t.department.toLowerCase().includes(q) ||
            t.title.toLowerCase().includes(q) ||
            t.location.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);
  }, [tenders, recentSearchQuery]);

  const scanSingleBidCard = async (
    scanId: string,
    file: File,
    batchAutoSavedIds: Set<string>,
  ) => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), EXTRACT_PDF_TIMEOUT_MS);

    try {
      // 1. Read PDF as base64 for server-side Gemini extraction
      const rawDataUrl = await readFileAsDataUrl(file);
      const commaIdx = rawDataUrl.indexOf(',');
      const fileBase64 = commaIdx >= 0 ? rawDataUrl.slice(commaIdx + 1) : rawDataUrl;

      // 2. Prepare Attachment 1 (NIT / Tender Document) respecting existing 650 KB Firestore limit
      let attachment1: AttachmentItem | null = null;
      let attachmentWarning: string | undefined;
      if (file.size <= MAX_ATTACHMENT_BYTES) {
        try {
          const prepared = await readAttachmentForFirestore(file);
          attachment1 = {
            id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            slotLabel: TENDER_DEFAULT_SLOT_LABELS[0],
            fileName: file.name,
            fileType: prepared.fileType || 'application/pdf',
            fileSize: prepared.fileSize,
            uploadedAt: new Date().toISOString().slice(0, 10),
            dataUrl: prepared.dataUrl,
          };
        } catch (attErr) {
          attachmentWarning =
            attErr instanceof Error
              ? attErr.message
              : 'PDF exceeds 650 KB cloud attachment limit.';
        }
      } else {
        attachmentWarning = `PDF (${formatFileSize(file.size)}) exceeds the 650 KB Attachment 1 Firestore limit. Tender details will still save; attach a compressed PDF in Attachment 1 later.`;
      }

      // 3. Call server-side Gemini API proxy route with strict 45s AbortController timeout
      const res = await fetch('/api/tenders/extract-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/pdf',
          fileBase64,
        }),
      });

      const { json: data, rawText } = await safeReadExtractResponse(res);
      const isOk = Boolean(res.ok && (data?.ok || data?.success) && data?.extracted);

      if (!isOk || !data?.extracted) {
        const cleanErrMsg = sanitizeExtractErrorMessage(
          data?.error || rawText || `HTTP ${res.status}`,
          res.status,
        );
        setScanQueue((prev) =>
          prev.map((item) =>
            item.scanId === scanId
              ? {
                  ...item,
                  status: 'error',
                  errorMsg: cleanErrMsg,
                  attachment1,
                  attachmentWarning,
                }
              : item,
          ),
        );
        return;
      }

      const draft = data.extracted;
      const shouldAutoSyncEmd =
        (draft.emdStatus === 'EMD Paid' || draft.emdStatus === 'BG Submitted') &&
        draft.emdAmount > 0;

      // Check auto-save mode (only if unique / non-duplicate across both existing and current batch)
      const normalizedId = draft.tenderId.trim().toLowerCase();
      const isDuplicate =
        Boolean(findDuplicateTender(tendersRef.current, draft.tenderId)) ||
        batchAutoSavedIds.has(normalizedId);

      if (autoSaveEnabled && !isDuplicate && normalizedId) {
        batchAutoSavedIds.add(normalizedId);
        const newTender = buildTenderFromBidDraft(draft, attachment1);
        onSaveScannedTender(newTender, shouldAutoSyncEmd);
        setScanQueue((prev) =>
          prev.map((item) =>
            item.scanId === scanId
              ? {
                  ...item,
                  status: 'saved',
                  errorMsg: undefined,
                  modelUsed: data.modelUsed,
                  fallbackUsed: data.fallbackUsed,
                  draft,
                  attachment1,
                  attachmentWarning,
                  syncToEmd: shouldAutoSyncEmd,
                  savedTenderId: newTender.tenderId,
                  savedTenderRecord: newTender,
                }
              : item,
          ),
        );
        onNotify(
          'ok',
          attachment1
            ? `Auto-saved ${newTender.tenderId} (${newTender.location}) with Attachment 1.`
            : `Auto-saved ${newTender.tenderId} (${newTender.location}) to Daily Tender Data.`,
        );
        return;
      }

      setScanQueue((prev) =>
        prev.map((item) =>
          item.scanId === scanId
            ? {
                ...item,
                status: 'ready',
                errorMsg: undefined,
                modelUsed: data.modelUsed,
                fallbackUsed: data.fallbackUsed,
                draft,
                attachment1,
                attachmentWarning,
                syncToEmd: shouldAutoSyncEmd,
              }
            : item,
        ),
      );
    } catch (err) {
      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError');
      const cleanErrMsg = isAbort
        ? sanitizeExtractErrorMessage('AbortError: 45s timeout', 504)
        : sanitizeExtractErrorMessage(err);

      setScanQueue((prev) =>
        prev.map((item) =>
          item.scanId === scanId
            ? {
                ...item,
                status: 'error',
                errorMsg: cleanErrMsg,
              }
            : item,
        ),
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const processPdfFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const validPdfs: File[] = [];
    for (const file of files) {
      const isPdf =
        file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (!isPdf) {
        onNotify('err', `"${file.name}" skipped — only .pdf GeM bid documents are supported.`);
        continue;
      }
      if (file.size <= 0) {
        onNotify('err', `"${file.name}" appears to be empty.`);
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        onNotify('err', `"${file.name}" exceeds 8 MB PDF upload limit for AI scanning.`);
        continue;
      }
      validPdfs.push(file);
    }

    if (validPdfs.length === 0) return;

    const createdEntries: { scanId: string; file: File }[] = validPdfs.map((file, idx) => ({
      scanId: `scan-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      file,
    }));

    setScanQueue((prev) => [
      ...createdEntries.map(
        ({ scanId, file }): ScannedBidCardState => ({
          scanId,
          file,
          fileName: file.name,
          fileSize: file.size,
          status: 'scanning',
          attachment1: null,
          syncToEmd: false,
        }),
      ),
      ...prev,
    ]);

    const batchAutoSavedIds = new Set(
      tendersRef.current.map((t) => t.tenderId.trim().toLowerCase()),
    );

    // Run each file inside an independent Promise.allSettled worker so one failure never interrupts sibling PDFs
    await Promise.allSettled(
      createdEntries.map(({ scanId, file }) =>
        scanSingleBidCard(scanId, file, batchAutoSavedIds),
      ),
    );
  };

  const handleRetrySingleCard = (item: ScannedBidCardState) => {
    if (item.status === 'scanning') return;
    setScanQueue((prev) =>
      prev.map((card) =>
        card.scanId === item.scanId
          ? {
              ...card,
              status: 'scanning',
              errorMsg: undefined,
            }
          : card,
      ),
    );
    const existingIds = new Set(
      tendersRef.current.map((t) => t.tenderId.trim().toLowerCase()),
    );
    void scanSingleBidCard(item.scanId, item.file, existingIds);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      void processPdfFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void processPdfFiles(files);
    }
    e.target.value = '';
  };

  const updateCardDraft = (scanId: string, patch: Partial<ExtractedBidDraft>) => {
    setScanQueue((prev) =>
      prev.map((item) =>
        item.scanId === scanId && item.draft
          ? { ...item, draft: { ...item.draft, ...patch } }
          : item,
      ),
    );
  };

  const handleSaveSingleCard = (item: ScannedBidCardState) => {
    if (!item.draft) return;
    const duplicate = findDuplicateTender(tenders, item.draft.tenderId);
    if (duplicate) {
      onNotify(
        'err',
        `Tender ID "${item.draft.tenderId}" already exists in Daily Tender Data.`,
      );
      return;
    }
    if (!item.draft.tenderId.trim() || !item.draft.department.trim() || !item.draft.title.trim()) {
      onNotify('err', 'Please ensure Tender ID, Department, and Work Title are filled before saving.');
      return;
    }

    const supportsEmd =
      item.draft.emdStatus === 'EMD Paid' || item.draft.emdStatus === 'BG Submitted';
    const newTender = buildTenderFromBidDraft(item.draft, item.attachment1);
    onSaveScannedTender(newTender, supportsEmd && item.syncToEmd && item.draft.emdAmount > 0);

    setScanQueue((prev) =>
      prev.map((card) =>
        card.scanId === item.scanId
          ? {
              ...card,
              status: 'saved',
              savedTenderId: newTender.tenderId,
              savedTenderRecord: newTender,
            }
          : card,
      ),
    );
    onNotify(
      'ok',
      item.attachment1
        ? `Saved ${newTender.tenderId} to Daily Tender Data with Attachment 1 (${item.attachment1.fileName}).`
        : `Saved ${newTender.tenderId} to Daily Tender Data.`,
    );
  };

  const handleBulkSaveAll = () => {
    if (readyUnsavedItems.length === 0) return;
    let savedCount = 0;
    const savedIds = new Map<string, Tender>();
    const seenTenderIds = new Set(tenders.map((t) => t.tenderId.trim().toLowerCase()));

    for (const item of readyUnsavedItems) {
      if (!item.draft) continue;
      const key = item.draft.tenderId.trim().toLowerCase();
      if (seenTenderIds.has(key)) continue;
      seenTenderIds.add(key);

      const supportsEmd =
        item.draft.emdStatus === 'EMD Paid' || item.draft.emdStatus === 'BG Submitted';
      const newTender = buildTenderFromBidDraft(item.draft, item.attachment1);
      onSaveScannedTender(newTender, supportsEmd && item.syncToEmd && item.draft.emdAmount > 0);
      savedIds.set(item.scanId, newTender);
      savedCount += 1;
    }

    setScanQueue((prev) =>
      prev.map((card) => {
        const saved = savedIds.get(card.scanId);
        if (!saved) return card;
        return {
          ...card,
          status: 'saved',
          savedTenderId: saved.tenderId,
          savedTenderRecord: saved,
        };
      }),
    );

    if (savedCount > 0) {
      onNotify('ok', `Saved ${savedCount} scanned GeM bid(s) to Daily Tender Data.`);
    }
  };

  const handleRemoveCard = (scanId: string) => {
    setScanQueue((prev) => prev.filter((item) => item.scanId !== scanId));
  };

  return (
    <div className="space-y-5">
      {/* Top Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[230px] max-w-md">
          <Search
            className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <label htmlFor="bid-search-recent-filter" className="sr-only">
            Search recent bids by Tender ID, Department, Title, or City
          </label>
          <input
            id="bid-search-recent-filter"
            type="search"
            value={recentSearchQuery}
            onChange={(e) => setRecentSearchQuery(e.target.value)}
            placeholder="Search Bid ID, Dept/Org, Scope, District/State..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={autoSaveEnabled}
              onChange={(e) => setAutoSaveEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-[#1E3A8A] focus:ring-blue-600"
            />
            <span>Auto-Save Scanned Bids</span>
          </label>

          {readyUnsavedItems.length > 1 && (
            <button
              type="button"
              onClick={handleBulkSaveAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium whitespace-nowrap"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Save All Valid ({readyUnsavedItems.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={onAddManualTender}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add New Tender</span>
          </button>
        </div>
      </div>

      {/* Drag & Drop PDF Scanner Zone */}
      <div
        role="region"
        aria-label="GeM Bid PDF Drag and Drop Scanner"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
        }}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        tabIndex={0}
        className={`rounded-xl border-2 border-dashed p-8 sm:p-10 text-center cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 ${
          isDragging
            ? 'border-[#1E3A8A] bg-blue-100/70 dark:border-blue-400 dark:bg-blue-950/50'
            : 'border-slate-300 dark:border-slate-700 bg-blue-50/40 dark:bg-slate-900/80 hover:border-[#1E3A8A] dark:hover:border-blue-500 hover:bg-blue-50/80 dark:hover:bg-slate-900'
        }`}
      >
        <input
          ref={fileInputRef}
          id="bid-search-pdf-input"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={handleFileInputChange}
          className="sr-only"
        />

        <div className="max-w-lg mx-auto flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[#1E3A8A] dark:text-blue-400 shadow-xs">
            {scanningCount > 0 ? (
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            ) : (
              <CloudUpload className="h-6 w-6" aria-hidden="true" />
            )}
          </div>

          <div className="space-y-1">
            <p className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              {scanningCount > 0
                ? `Scanning ${scanningCount} GeM Bid PDF document${scanningCount > 1 ? 's' : ''} with Gemini AI...`
                : 'Drag & Drop GeM Bid PDF Document(s)'}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Drop one or multiple <span className="font-mono-num font-medium">.pdf</span> files
              here or click to browse. Extracts all 16 fields, verifies{' '}
              <span className="font-medium text-slate-800 dark:text-slate-200">
                District, State
              </span>{' '}
              via Google Search, attaches{' '}
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Attachment 1 (NIT / Tender Document)
              </span>
              , and saves directly to Daily Tender Data.
            </p>
          </div>
        </div>
      </div>

      {/* Scanned Preview Queue */}
      {scanQueue.length > 0 && (
        <section aria-label="Scanned GeM Bid Previews" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ScanSearch
                className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400"
                aria-hidden="true"
              />
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                Scanned Bid Previews ({scanQueue.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setScanQueue([])}
              className="text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Clear Queue
            </button>
          </div>

          <div className="space-y-4">
            {scanQueue.map((item) => {
              const duplicateTender =
                item.status === 'ready' && item.draft
                  ? findDuplicateTender(tenders, item.draft.tenderId)
                  : undefined;

              const supportsEmd =
                item.draft?.emdStatus === 'EMD Paid' || item.draft?.emdStatus === 'BG Submitted';

              return (
                <article
                  key={item.scanId}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
                >
                  {/* Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText
                        className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400 shrink-0"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {item.fileName}
                        </p>
                        <p className="font-mono-num text-[11px] text-slate-500 dark:text-slate-400">
                          {formatFileSize(item.fileSize)} ·{' '}
                          {item.status === 'scanning'
                            ? 'Extracting structured GeM fields...'
                            : item.status === 'saved'
                              ? `Saved as ${item.savedTenderId}`
                              : item.status === 'error'
                                ? 'Extraction failed'
                                : 'Ready for verification'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.status === 'saved' && (
                        <button
                          type="button"
                          onClick={onGoToDailyTenders}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-xs font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/60"
                        >
                          <span>View in Daily Tender Data</span>
                          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveCard(item.scanId)}
                        aria-label={`Remove ${item.fileName} from queue`}
                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-red-400"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Scanning State */}
                  {item.status === 'scanning' && (
                    <div className="px-5 py-8 flex items-center justify-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                      <Loader2
                        className="h-4 w-4 animate-spin text-[#1E3A8A] dark:text-blue-400"
                        aria-hidden="true"
                      />
                      <span>Reading GeM Bid PDF with Gemini AI and mapping fields...</span>
                    </div>
                  )}

                  {/* Error State */}
                  {item.status === 'error' && (
                    <div
                      role="alert"
                      className="p-5 flex flex-wrap items-center justify-between gap-3 bg-red-50/70 dark:bg-red-950/30 text-xs text-red-800 dark:text-red-200"
                    >
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <AlertTriangle
                          className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400 mt-0.5"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-semibold text-red-900 dark:text-red-100">
                            Scan unsuccessful for {item.fileName}
                          </p>
                          <p className="text-red-800 dark:text-red-200 break-words">
                            {item.errorMsg}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleRetrySingleCard(item)}
                          aria-label={`Retry scanning ${item.fileName}`}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium transition-colors"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Retry This File</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveCard(item.scanId)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-slate-900 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Dismiss</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Saved Confirmation Banner */}
                  {item.status === 'saved' && item.savedTenderRecord && (
                    <div className="p-5 flex flex-wrap items-center justify-between gap-3 bg-emerald-50/60 dark:bg-emerald-950/25">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <CheckCircle2
                          className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"
                          aria-hidden="true"
                        />
                        <div className="text-xs space-y-0.5">
                          <p className="font-semibold text-emerald-900 dark:text-emerald-200">
                            Saved {item.savedTenderRecord.tenderId} to Daily Tender Data & Cloud Sync
                          </p>
                          <p className="text-slate-600 dark:text-slate-400">
                            {item.savedTenderRecord.department} · {item.savedTenderRecord.location} ·{' '}
                            {item.savedTenderRecord.title}
                          </p>
                          {item.attachment1 ? (
                            <p className="text-emerald-700 dark:text-emerald-400">
                              Attachment 1 attached: {item.attachment1.fileName} (Slots 2 & 3 kept open)
                            </p>
                          ) : item.attachmentWarning ? (
                            <p className="text-amber-700 dark:text-amber-400">{item.attachmentWarning}</p>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onOpenExistingTender(item.savedTenderRecord!)}
                        className="px-3.5 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
                      >
                        Inspect & Upload BOQ/Docs
                      </button>
                    </div>
                  )}

                  {/* Editable Preview Form */}
                  {item.status === 'ready' && item.draft && (
                    <div className="p-5 space-y-5">
                      {duplicateTender && (
                        <div
                          role="alert"
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-xs text-amber-900 dark:text-amber-200"
                        >
                          <div className="flex items-start gap-2 min-w-0">
                            <AlertTriangle
                              className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
                              aria-hidden="true"
                            />
                            <div>
                              <p className="font-semibold">
                                Duplicate Bid Detected: {duplicateTender.tenderId} already exists in
                                Daily Tender Data
                              </p>
                              <p className="text-[11px] opacity-90 mt-0.5">
                                Existing record: {duplicateTender.department} ({duplicateTender.stage}
                                ). Review the Tender ID below or inspect the existing record before
                                saving.
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenExistingTender(duplicateTender)}
                            className="px-3 py-1.5 rounded-lg border border-amber-400 dark:border-amber-700 bg-white dark:bg-slate-900 text-xs font-medium text-amber-900 dark:text-amber-200 hover:bg-amber-100/60 shrink-0"
                          >
                            View Existing Tender
                          </button>
                        </div>
                      )}

                      {/* Attachment 1 & Slots Info */}
                      <div
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-xs ${
                          item.attachment1
                            ? 'border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200'
                            : 'border-amber-200 dark:border-amber-900/70 bg-amber-50/50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {item.attachment1 ? (
                            <FileCheck2
                              className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                              aria-hidden="true"
                            />
                          ) : (
                            <Paperclip
                              className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                          <span className="truncate">
                            {item.attachment1
                              ? `Attachment 1 (NIT / Tender Document) ready: ${item.attachment1.fileName}`
                              : item.attachmentWarning || 'Attachment 1 not auto-attached'}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-600 dark:text-slate-400 shrink-0">
                          Attachment 2 (BOQ) & Attachment 3 (Receipt) left empty
                        </span>
                      </div>

                      {/* 16 Editable Fields Matching Daily Tender Data */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            1. Tender ID / Bid No. *
                          </label>
                          <input
                            type="text"
                            value={item.draft.tenderId}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, { tenderId: e.target.value })
                            }
                            className={`font-mono-num w-full rounded-lg border px-3 py-1.5 text-xs focus:outline-none focus:ring-2 ${
                              duplicateTender
                                ? 'border-amber-400 dark:border-amber-600 bg-amber-50/40 dark:bg-amber-950/20 text-amber-950 dark:text-amber-100 focus:ring-amber-500'
                                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:ring-blue-600'
                            }`}
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            2. Portal / Source *
                          </label>
                          <select
                            value={item.draft.portal}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, {
                                portal: e.target.value as PortalType,
                              })
                            }
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          >
                            {PORTAL_OPTIONS.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            3. Current Stage / Status
                          </label>
                          <select
                            value={item.draft.stage}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, {
                                stage: e.target.value as TenderStage,
                              })
                            }
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          >
                            {STAGE_OPTIONS.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            5. District, State
                          </label>
                          <input
                            type="text"
                            value={item.draft.location}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, { location: e.target.value })
                            }
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            4. Department / Organization Name *
                          </label>
                          <input
                            type="text"
                            value={item.draft.department}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, { department: e.target.value })
                            }
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            6. Work / Supply Brief Title *
                          </label>
                          <input
                            type="text"
                            value={item.draft.title}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, { title: e.target.value })
                            }
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            7. Work / Item Category
                          </label>
                          <input
                            type="text"
                            value={item.draft.category}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, { category: e.target.value })
                            }
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            8. Publish Date
                          </label>
                          <input
                            type="date"
                            value={item.draft.publishDate}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, { publishDate: e.target.value })
                            }
                            className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            9. Submission Due Date & Time *
                          </label>
                          <input
                            type="datetime-local"
                            value={item.draft.submissionDueDate}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, { submissionDueDate: e.target.value })
                            }
                            className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            10. Pre-Bid Meeting Date (Optional)
                          </label>
                          <input
                            type="date"
                            value={item.draft.preBidDate}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, { preBidDate: e.target.value })
                            }
                            className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            11. Result / Completion Date
                          </label>
                          <input
                            type="date"
                            value={item.draft.completionDate}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, { completionDate: e.target.value })
                            }
                            className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            12. Estimated Tender Value (₹)
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={item.draft.estimatedValue || ''}
                            placeholder="0"
                            onChange={(e) =>
                              updateCardDraft(item.scanId, {
                                estimatedValue: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            13. Our Quoted Bid Value (₹)
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={item.draft.quotedValue || ''}
                            placeholder="Leave blank until quoted"
                            onChange={(e) =>
                              updateCardDraft(item.scanId, {
                                quotedValue: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            14. EMD / Bid Security Required
                          </label>
                          <select
                            value={item.draft.emdStatus}
                            onChange={(e) => {
                              const nextStatus = e.target.value as EmdSecurityType;
                              updateCardDraft(item.scanId, {
                                emdStatus: nextStatus,
                                emdAmount:
                                  nextStatus === 'EMD Paid' || nextStatus === 'BG Submitted'
                                    ? item.draft?.emdAmount || 0
                                    : 0,
                              });
                            }}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          >
                            {EMD_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            15. EMD Amount (₹)
                          </label>
                          <input
                            type="number"
                            min={0}
                            disabled={!supportsEmd}
                            value={supportsEmd ? item.draft.emdAmount : 0}
                            onChange={(e) =>
                              updateCardDraft(item.scanId, {
                                emdAmount: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                            className="font-mono-num w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 disabled:bg-slate-100 dark:disabled:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>

                        <div className="sm:col-span-2 lg:col-span-3">
                          <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                            16. Result / L1 Price Info
                          </label>
                          <input
                            type="text"
                            value={item.draft.resultInfo}
                            placeholder="Leave blank until bid outcome"
                            onChange={(e) =>
                              updateCardDraft(item.scanId, { resultInfo: e.target.value })
                            }
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                          />
                        </div>
                      </div>

                      {/* Card Footer */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <div>
                          {supportsEmd && item.draft.emdAmount > 0 ? (
                            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={item.syncToEmd}
                                onChange={(e) =>
                                  setScanQueue((prev) =>
                                    prev.map((card) =>
                                      card.scanId === item.scanId
                                        ? { ...card, syncToEmd: e.target.checked }
                                        : card,
                                    ),
                                  )
                                }
                                className="h-3.5 w-3.5 rounded border-slate-300 text-[#1E3A8A] focus:ring-blue-600"
                              />
                              <span>
                                Auto-create linked entry in EMD & BG Tracker (
                                <span className="font-mono-num">{formatINR(item.draft.emdAmount)}</span>)
                              </span>
                            </label>
                          ) : (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              Saving syncs directly to Daily Tender Data, Firestore Cloud & WhatsApp
                              Alerts
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRemoveCard(item.scanId)}
                            className="px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"
                          >
                            Discard
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(duplicateTender)}
                            onClick={() => handleSaveSingleCard(item)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
                          >
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>
                              {duplicateTender ? 'Duplicate Bid ID' : 'Save to Daily Tender'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Recently Added Bid Searches / Tracked Bids */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-800/40">
          <div>
            <h2 className="font-display text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
              Recently Added Bid Searches
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Latest entries synced with Daily Tender Data
            </p>
          </div>
          <button
            type="button"
            onClick={onGoToDailyTenders}
            className="inline-flex items-center gap-1 text-xs font-medium text-[#1E3A8A] dark:text-blue-400 hover:underline whitespace-nowrap"
          >
            <span>Open Full Tender Table</span>
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {recentBidRows.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-slate-500 dark:text-slate-400">
            No matching bids found. Upload a GeM PDF above to scan and add a tender.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                  <th className="py-2.5 px-4 font-semibold whitespace-nowrap">Bid ID</th>
                  <th className="py-2.5 px-4 font-semibold">Dept / Org & Title</th>
                  <th className="py-2.5 px-4 font-semibold whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-4 font-semibold whitespace-nowrap">Published Date</th>
                  <th className="py-2.5 px-4 font-semibold whitespace-nowrap">Due Date</th>
                  <th className="py-2.5 px-4 font-semibold text-right whitespace-nowrap">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {recentBidRows.map((t) => {
                  const days = getDaysRemaining(t.submissionDueDate);
                  const isOpenStage =
                    t.stage === 'Identified / Reviewing' || t.stage === 'Doc Preparation';
                  const isUrgent = isOpenStage && days >= 0 && days <= 2;
                  const statusLabel = isUrgent ? 'URGENT' : isOpenStage ? 'OPEN' : t.stage;
                  const statusClass = isUrgent
                    ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400'
                    : isOpenStage
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';

                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenExistingTender(t)}
                          className="font-mono-num font-semibold text-[#1E3A8A] dark:text-blue-400 hover:underline"
                        >
                          {t.tenderId}
                        </button>
                      </td>
                      <td className="py-2.5 px-4 max-w-[320px]">
                        <p className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {t.department}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {t.title} · {t.location}
                        </p>
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${statusClass}`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {formatShortDate(t.publishDate)}
                      </td>
                      <td className="py-2.5 px-4 font-mono-num text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {formatShortDate(t.submissionDueDate)}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenExistingTender(t)}
                          className="text-xs font-medium text-[#1E3A8A] dark:text-blue-400 hover:underline"
                        >
                          Edit / View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
