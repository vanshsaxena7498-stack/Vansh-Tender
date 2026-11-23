import { useMemo, useState } from 'react';
import {
  Building2,
  Download,
  Edit3,
  Mail,
  Phone,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { MafTrackerRecord, OemRecord } from '../types/crm';
import { downloadTextFile } from '../utils/formatters';
import {
  computeOemUsageMap,
  filterOemRecords,
} from '../utils/oemDirectory';

interface OemDetailsTabProps {
  oemRecords: OemRecord[];
  mafTrackers: MafTrackerRecord[];
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
  onAddOem,
  onEditOem,
  onDeleteOem,
}: OemDetailsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const usageMap = useMemo(
    () => computeOemUsageMap(oemRecords, mafTrackers),
    [oemRecords, mafTrackers],
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

  const filteredOems = useMemo(
    () => filterOemRecords(oemRecords, searchQuery),
    [oemRecords, searchQuery],
  );

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

  return (
    <div className="space-y-6">
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

      {/* OEM Directory Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              OEM Directory Table
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Authorized manufacturers &amp; contacts · Auto-populates MAF Status selections
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              onClick={onAddOem}
              data-testid="add-oem-btn"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add New OEM</span>
            </button>
          </div>
        </div>

        {/* Search Strip */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3">
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
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <p className="font-mono-num text-xs text-slate-500 dark:text-slate-400">
            Showing {filteredOems.length} of {oemRecords.length} OEMs
          </p>
        </div>

        {/* Directory Table or Empty State */}
        {oemRecords.length === 0 ? (
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
        ) : filteredOems.length === 0 ? (
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
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  <th className="py-3 px-3">OEM / Manufacturer</th>
                  <th className="py-3 px-3">Company Name</th>
                  <th className="py-3 px-3">Concerned Person</th>
                  <th className="py-3 px-3">Email ID</th>
                  <th className="py-3 px-3 whitespace-nowrap">Phone No.</th>
                  <th className="py-3 px-3 whitespace-nowrap">Linked Tenders</th>
                  <th className="py-3 px-3">Remarks</th>
                  <th className="py-3 px-3 text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredOems.map((oem) => {
                  const usage = usageMap.get(oem.id) ?? { tenderCount: 0, itemCount: 0 };
                  const isDeleting = confirmDeleteId === oem.id;

                  return (
                    <tr
                      key={oem.id}
                      data-testid={`oem-row-${oem.id}`}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 align-top"
                    >
                      <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white min-w-[100px]">
                        {oem.oemName}
                      </td>
                      <td className="py-3 px-3 text-slate-700 dark:text-slate-300 min-w-[115px]">
                        {oem.companyName || (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-800 dark:text-slate-200 min-w-[105px]">
                        {oem.concernedPersonName || (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 max-w-[195px]">
                        {oem.email ? (
                          <a
                            href={`mailto:${oem.email}`}
                            className="inline-flex items-start gap-1.5 text-slate-700 dark:text-slate-300 hover:text-[#1E3A8A] dark:hover:text-blue-400 hover:underline break-all"
                          >
                            <Mail className="h-3 w-3 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
                            <span>{oem.email}</span>
                          </a>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono-num whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {oem.phone ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Phone className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
                            <span>{oem.phone}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono-num whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {usage.tenderCount > 0 ? (
                          <span>
                            {usage.tenderCount} tender{usage.tenderCount === 1 ? '' : 's'} ·{' '}
                            {usage.itemCount} item{usage.itemCount === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td
                        className="py-3 px-3 text-slate-600 dark:text-slate-400 max-w-[170px]"
                        title={oem.remarks}
                      >
                        <p className="line-clamp-2">{oem.remarks || '—'}</p>
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {isDeleting ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteOem(oem.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded border border-slate-300 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onEditOem(oem)}
                              aria-label={`Edit ${oem.oemName}`}
                              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-[#1E3A8A] dark:hover:text-blue-400"
                            >
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(oem.id)}
                              aria-label={`Delete ${oem.oemName}`}
                              className="p-1.5 rounded-lg text-slate-500 hover:bg-red-50 dark:hover:bg-red-950/40 hover:text-red-600 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
