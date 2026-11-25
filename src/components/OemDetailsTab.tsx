import { useMemo, useState } from 'react';
import { Building2, Download, Mail, Phone, Plus, Search } from 'lucide-react';
import type { MafTrackerRecord, OemRecord, Tender } from '../types/crm';
import { downloadTextFile, formatShortDate } from '../utils/formatters';
import {
  computeOemUsageMap,
  filterOemRecords,
} from '../utils/oemDirectory';
import {
  resolveOemLinkedContexts,
  sortRecordsByDate,
  type DateSortDirection,
} from '../utils/tableSorting';
import {
  CrmCompactTable,
  DeleteConfirmModal,
  PreviewField,
  RecordPreviewModal,
} from './CompactTableKit';

interface OemDetailsTabProps {
  oemRecords: OemRecord[];
  mafTrackers: MafTrackerRecord[];
  tenders: Tender[];
  onAddOem: () => void;
  onEditOem: (oem: OemRecord) => void;
  onDeleteOem: (id: string) => void;
}

function escapeCsvCell(val: string): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function OemDetailsTab({
  oemRecords,
  mafTrackers,
  tenders,
  onAddOem,
  onEditOem,
  onDeleteOem,
}: OemDetailsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [dateSortDir, setDateSortDir] = useState<DateSortDirection>('desc');
  const [previewOem, setPreviewOem] = useState<OemRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OemRecord | null>(null);

  const usageMap = useMemo(
    () => computeOemUsageMap(oemRecords, mafTrackers),
    [oemRecords, mafTrackers],
  );

  const linkedContexts = useMemo(
    () => resolveOemLinkedContexts(oemRecords, mafTrackers, tenders),
    [oemRecords, mafTrackers, tenders],
  );

  const kpis = useMemo(() => {
    let oemsLinkedCount = 0;
    let totalLinkedItems = 0;
    for (const oem of oemRecords) {
      const usage = usageMap.get(oem.id);
      if (usage && usage.tenderCount > 0) {
        oemsLinkedCount += 1;
      }
      if (usage) {
        totalLinkedItems += usage.itemCount;
      }
    }
    return {
      totalOems: oemRecords.length,
      oemsLinkedCount,
      totalLinkedItems,
    };
  }, [oemRecords, usageMap]);

  const filteredOems = useMemo(() => {
    const filtered = filterOemRecords(oemRecords, searchQuery);
    return sortRecordsByDate(
      filtered,
      (oem) => oem.updatedAt || oem.createdAt,
      dateSortDir,
    );
  }, [oemRecords, searchQuery, dateSortDir]);

  const handleExportCsv = () => {
    const headers = [
      'OEM / Manufacturer Name',
      'Company Name',
      'Concerned Person Name',
      'Email ID',
      'Phone No.',
      'Linked Tenders',
      'Linked BOQ Items',
      'Remarks',
    ];
    const rows = filteredOems.map((oem) => {
      const usage = usageMap.get(oem.id) ?? { tenderCount: 0, itemCount: 0 };
      return [
        oem.oemName,
        oem.companyName,
        oem.concernedPersonName,
        oem.email,
        oem.phone,
        String(usage.tenderCount),
        String(usage.itemCount),
        oem.remarks,
      ]
        .map(escapeCsvCell)
        .join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const dateStamp = new Date().toISOString().slice(0, 10);
    downloadTextFile(`BidLedger_OEM_Details_${dateStamp}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const previewContext = previewOem ? linkedContexts.get(previewOem.id) : undefined;
  const previewUsage = previewOem
    ? usageMap.get(previewOem.id) ?? { tenderCount: 0, itemCount: 0 }
    : { tenderCount: 0, itemCount: 0 };

  return (
    <div className="space-y-4">
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total OEMs Managed
          </p>
          <p className="font-mono-num text-2xl font-bold text-slate-900 dark:text-white mt-2">
            {kpis.totalOems}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            OEMs Linked to Tenders
          </p>
          <p className="font-mono-num text-2xl font-bold text-[#1E3A8A] dark:text-blue-400 mt-2">
            {kpis.oemsLinkedCount}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Linked MAF BOQ Items
          </p>
          <p className="font-mono-num text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">
            {kpis.totalLinkedItems}
          </p>
        </div>
      </div>

      {/* Search & Action Toolbar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search
              className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search OEM Name, Company, Concerned Person, Email or Phone..."
              aria-label="Search OEM Directory"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={onAddOem}
              data-testid="add-oem-btn"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Add New OEM</span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span>
            Authorized manufacturers &amp; contacts · Auto-populates MAF Status selections
          </span>
          <span className="font-mono-num">
            Showing {filteredOems.length} of {oemRecords.length} OEMs
          </span>
        </div>
      </div>

      {/* Compact 6-Column + Actions Table */}
      <CrmCompactTable
        rows={filteredOems}
        getRowKey={(oem) => oem.id}
        getTenderNo={(oem) => linkedContexts.get(oem.id)?.tenderNosLabel || '—'}
        getDepartmentName={(oem) =>
          oem.companyName ? `${oem.oemName} · ${oem.companyName}` : oem.oemName
        }
        getLocation={(oem) => linkedContexts.get(oem.id)?.locationLabel || '—'}
        getDateLabel={(oem) => formatShortDate(oem.updatedAt || oem.createdAt)}
        getDescription={(oem) =>
          [oem.concernedPersonName, oem.remarks].filter(Boolean).join(' · ') || '—'
        }
        getRecordLabel={(oem) => oem.oemName}
        dateSortDir={dateSortDir}
        onToggleDateSort={() =>
          setDateSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))
        }
        onPreview={(oem) => setPreviewOem(oem)}
        onEdit={(oem) => onEditOem(oem)}
        onRequestDelete={(oem) => setDeleteTarget(oem)}
        emptyContent={
          oemRecords.length === 0 ? (
            <div className="px-6 py-12 text-center space-y-3">
              <div className="mx-auto h-11 w-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400">
                <Building2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  No OEM records added yet
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Add manufacturers and authorized contacts here. MAF Status forms restrict OEM
                  selection strictly to this directory and auto-fill concerned person details.
                </p>
              </div>
              <button
                type="button"
                onClick={onAddOem}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Add First OEM</span>
              </button>
            </div>
          ) : (
            <div className="px-6 py-10 text-center space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No OEMs matched &ldquo;{searchQuery}&rdquo;
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-xs font-medium text-[#1E3A8A] dark:text-blue-400 hover:underline"
              >
                Clear search filter
              </button>
            </div>
          )
        }
      />

      {/* Full-Detail Read-Only OEM Preview Modal */}
      {previewOem && (
        <RecordPreviewModal
          open
          title={previewOem.oemName}
          subtitle={previewOem.companyName || 'Authorized OEM / Manufacturer'}
          badge={
            <span className="font-mono-num inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-[#1E3A8A] dark:bg-blue-950/60 dark:text-blue-300 text-[11px] font-semibold">
              {previewUsage.tenderCount} tender{previewUsage.tenderCount === 1 ? '' : 's'} ·{' '}
              {previewUsage.itemCount} item{previewUsage.itemCount === 1 ? '' : 's'}
            </span>
          }
          onClose={() => setPreviewOem(null)}
        >
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
              <PreviewField label="OEM / Manufacturer Name" value={previewOem.oemName} />
              <PreviewField label="Company Name" value={previewOem.companyName || '—'} />
              <PreviewField
                label="Concerned Person Name"
                value={previewOem.concernedPersonName || '—'}
              />
              <PreviewField
                label="Email ID"
                value={
                  previewOem.email ? (
                    <a
                      href={`mailto:${previewOem.email}`}
                      className="inline-flex items-center gap-1.5 text-[#1E3A8A] dark:text-blue-400 hover:underline break-all"
                    >
                      <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{previewOem.email}</span>
                    </a>
                  ) : (
                    '—'
                  )
                }
              />
              <PreviewField
                label="Phone No."
                value={
                  previewOem.phone ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                      <span>{previewOem.phone}</span>
                    </span>
                  ) : (
                    '—'
                  )
                }
                mono
              />
              <PreviewField
                label="Last Updated"
                value={formatShortDate(previewOem.updatedAt || previewOem.createdAt)}
                mono
              />
            </div>

            <PreviewField label="Remarks / Notes" value={previewOem.remarks || '—'} />

            {previewContext && previewContext.linkedItems.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Linked Tenders &amp; BOQ Items ({previewContext.linkedItems.length})
                </p>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300">
                        <th className="py-2 px-3">Tender No.</th>
                        <th className="py-2 px-3">Department</th>
                        <th className="py-2 px-3">Item Name</th>
                        <th className="py-2 px-3">MAF Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {previewContext.linkedItems.map((item, idx) => (
                        <tr key={`${item.tenderId}-${idx}`}>
                          <td className="py-2 px-3 font-mono-num font-medium text-[#1E3A8A] dark:text-blue-400 whitespace-nowrap">
                            {item.tenderId}
                          </td>
                          <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                            {item.department}
                          </td>
                          <td className="py-2 px-3 text-slate-900 dark:text-slate-100">
                            {item.itemName}
                            {item.requiredQuantity ? ` (${item.requiredQuantity})` : ''}
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
                            {item.mafStatus}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </RecordPreviewModal>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title={`Delete OEM ${deleteTarget?.oemName ?? ''}`}
        description={`Are you sure you want to remove "${deleteTarget?.oemName ?? ''}" from the OEM Details directory?`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            onDeleteOem(deleteTarget.id);
          }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
