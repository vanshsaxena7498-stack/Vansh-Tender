import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Printer,
  TrendingUp,
} from 'lucide-react';
import type {
  EmdBgRecord,
  FirmProfile,
  PortalType,
  Tender,
} from '../types/crm';
import {
  ACTIVE_LOCKED_STATUSES,
  buildMonthlyChartSeries,
  buildStatusDistribution,
  COMPLETED_TENDER_STAGES,
  computeDashboardKpis,
  filterTendersForDashboard,
  isBgOrFdr,
} from '../utils/calculations';
import {
  formatINR,
  formatINRCompact,
  formatMonthLabel,
  formatShortDate,
  getDaysRemaining,
  getFinancialYear,
  getMonthKey,
} from '../utils/formatters';

interface DashboardTabProps {
  tenders: Tender[];
  emdRecords: EmdBgRecord[];
  firmProfile: FirmProfile;
  darkMode: boolean;
  onOpenTender: (tender: Tender) => void;
  onGoToEmdBg: () => void;
}

const PORTALS: ('ALL' | PortalType)[] = [
  'ALL',
  'GeM',
  'CPPP / eProcure',
  'State Portal',
  'PSU / Direct',
  'Private',
];

export function DashboardTab({
  tenders,
  emdRecords,
  firmProfile,
  darkMode,
  onOpenTender,
  onGoToEmdBg,
}: DashboardTabProps) {
  const [financialYear, setFinancialYear] = useState<string>('ALL');
  const [month, setMonth] = useState<string>('ALL');
  const [portal, setPortal] = useState<'ALL' | PortalType>('ALL');

  const availableFYs = useMemo(() => {
    const set = new Set<string>(['FY 2025-26', 'FY 2026-27']);
    for (const t of tenders) {
      set.add(getFinancialYear(t.submissionDueDate || t.publishDate));
    }
    return Array.from(set).sort().reverse();
  }, [tenders]);

  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    for (const t of tenders) {
      const k = getMonthKey(t.submissionDueDate || t.publishDate);
      if (k) set.add(k);
    }
    return Array.from(set).sort().reverse();
  }, [tenders]);

  const filteredTenders = useMemo(
    () => filterTendersForDashboard(tenders, { financialYear, month, portal }),
    [tenders, financialYear, month, portal],
  );

  const kpis = useMemo(
    () => computeDashboardKpis(filteredTenders, emdRecords),
    [filteredTenders, emdRecords],
  );

  const monthlySeries = useMemo(
    () => buildMonthlyChartSeries(filteredTenders),
    [filteredTenders],
  );

  const statusDistribution = useMemo(
    () => buildStatusDistribution(filteredTenders),
    [filteredTenders],
  );

  const urgentDeadlines = useMemo(() => {
    const now = new Date();
    return tenders
      .filter(
        (t) =>
          !COMPLETED_TENDER_STAGES.includes(t.stage) &&
          t.stage !== 'Submitted' &&
          getDaysRemaining(t.submissionDueDate, now) >= -1,
      )
      .sort((a, b) => a.submissionDueDate.localeCompare(b.submissionDueDate))
      .slice(0, 5);
  }, [tenders]);

  const financialAlerts = useMemo(() => {
    const now = new Date();
    const tenderByCode = new Map(tenders.map((t) => [t.tenderId.toLowerCase(), t]));
    return emdRecords
      .filter((r) => (ACTIVE_LOCKED_STATUSES as readonly string[]).includes(r.status))
      .map((r) => {
        const daysLeft = r.expiryDate ? getDaysRemaining(r.expiryDate, now) : 999;
        const linked = tenderByCode.get(r.tenderId.toLowerCase());
        const daysSinceComp =
          linked && COMPLETED_TENDER_STAGES.includes(linked.stage)
            ? -getDaysRemaining(linked.completionDate || linked.submissionDueDate, now)
            : 0;
        const isExpiringBg = isBgOrFdr(r.instrumentType) && daysLeft <= 30;
        const isPendingRefund =
          r.status === 'Refund / Release Applied' ||
          (!isBgOrFdr(r.instrumentType) && daysSinceComp > 60);
        return { record: r, daysLeft, daysSinceComp, isExpiringBg, isPendingRefund };
      })
      .filter((item) => item.isExpiringBg || item.isPendingRefund);
  }, [emdRecords, tenders]);

  const axisColor = darkMode ? '#94A3B8' : '#64748B';
  const gridColor = darkMode ? '#1E293B' : '#E2E8F0';
  const tooltipStyle = {
    backgroundColor: darkMode ? '#0F172A' : '#FFFFFF',
    borderColor: darkMode ? '#334155' : '#E2E8F0',
    color: darkMode ? '#F8FAFC' : '#0F172A',
    borderRadius: '8px',
    fontSize: '12px',
  };

  const kpiCards = [
    {
      label: 'Tenders Tracked',
      value: String(kpis.totalTracked),
      sub: `${filteredTenders.filter((t) => !COMPLETED_TENDER_STAGES.includes(t.stage)).length} active pipeline`,
      trend: 'Pipeline volume',
      accent: 'text-[#1E3A8A] dark:text-blue-400',
    },
    {
      label: 'Bids Submitted',
      value: String(kpis.bidsSubmitted),
      sub: `${kpis.submissionRatioPct}% submission ratio`,
      trend: 'Of tracked tenders',
      accent: 'text-sky-700 dark:text-sky-400',
    },
    {
      label: 'Total Quoted Value',
      value: formatINRCompact(kpis.totalQuotedValue),
      sub: formatINR(kpis.totalQuotedValue),
      trend: 'Submitted bid value',
      accent: 'text-slate-900 dark:text-slate-100',
    },
    {
      label: 'Tenders Won (L1)',
      value: String(kpis.tendersWonCount),
      sub: `Won: ${formatINRCompact(kpis.totalWonValue)}`,
      trend: 'Order book secured',
      accent: 'text-emerald-700 dark:text-emerald-400',
    },
    {
      label: 'Win Success Rate',
      value: `${kpis.winSuccessRatePct}%`,
      sub: 'Won vs. decided bids',
      trend: 'Competitive ratio',
      accent: 'text-emerald-700 dark:text-emerald-400',
    },
    {
      label: 'Capital Blocked',
      value: formatINRCompact(kpis.activeCapitalBlocked),
      sub: formatINR(kpis.activeCapitalBlocked),
      trend: 'Locked EMD & BG',
      accent: 'text-amber-700 dark:text-amber-400',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Print-only executive header */}
      <div className="hidden print:block pb-4 border-b border-slate-300">
        <h2 className="text-xl font-bold text-slate-900">{firmProfile.firmName}</h2>
        <p className="text-xs text-slate-600">
          Executive Tender & Financial Security Summary · GSTIN: {firmProfile.gstin} · Prepared by{' '}
          {firmProfile.adminName}
        </p>
      </div>

      {/* Filter Bar */}
      <section
        aria-label="Dashboard Filters"
        className="no-print flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label
              htmlFor="dash-fy-filter"
              className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap"
            >
              Financial Year
            </label>
            <select
              id="dash-fy-filter"
              value={financialYear}
              onChange={(e) => setFinancialYear(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">All-Time View</option>
              {availableFYs.map((fy) => (
                <option key={fy} value={fy}>
                  {fy}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="dash-month-filter"
              className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap"
            >
              Month
            </label>
            <select
              id="dash-month-filter"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="ALL">All Months</option>
              {availableMonths.map((mk) => (
                <option key={mk} value={mk}>
                  {formatMonthLabel(mk)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="dash-portal-filter"
              className="text-xs font-medium text-slate-600 dark:text-slate-400 whitespace-nowrap"
            >
              Portal
            </label>
            <select
              id="dash-portal-filter"
              value={portal}
              onChange={(e) => setPortal(e.target.value as 'ALL' | PortalType)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {PORTALS.map((p) => (
                <option key={p} value={p}>
                  {p === 'ALL' ? 'All Portals' : p}
                </option>
              ))}
            </select>
          </div>

          {(financialYear !== 'ALL' || month !== 'ALL' || portal !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setFinancialYear('ALL');
                setMonth('ALL');
                setPortal('ALL');
              }}
              className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              Reset Filters
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#1E3A8A] hover:bg-[#172554] dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
        >
          <Printer className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Print Executive Summary</span>
        </button>
      </section>

      {/* 6 Top KPI Cards */}
      <section
        aria-label="Key Performance Indicators"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4"
      >
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {card.label}
              </span>
              <TrendingUp className="h-3.5 w-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            </div>
            <p className={`font-mono-num text-2xl font-semibold mt-2 ${card.accent}`}>
              {card.value}
            </p>
            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="font-mono-num truncate">{card.sub}</span>
            </div>
          </div>
        ))}
      </section>

      {/* Empty filtered notice */}
      {filteredTenders.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-10 text-center">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            No tenders match the selected Financial Year, Month, or Portal filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setFinancialYear('ALL');
              setMonth('ALL');
              setPortal('ALL');
            }}
            className="mt-3 px-4 py-2 rounded-lg bg-[#1E3A8A] text-white text-xs font-medium"
          >
            Show All-Time Tenders
          </button>
        </div>
      ) : (
        /* Interactive Analytics Charts */
        <section aria-label="Tender Analytics Charts" className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* Monthly Performance Bar Chart */}
          <div className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="mb-3">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Monthly Bid Performance
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Bids Submitted vs. Tenders Won (Count)
              </p>
            </div>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlySeries} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: axisColor, fontSize: 11 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="submitted" name="Submitted" fill="#1E3A8A" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="won" name="L1 / Won" fill="#16A34A" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Bid Value Pipeline Area Chart */}
          <div className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="mb-3">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Bid Value Pipeline (₹ Crores)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Monthly Quoted Bid Value vs. Won Order Value
              </p>
            </div>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthlySeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 11 }} />
                  <YAxis tick={{ fill: axisColor, fontSize: 11 }} unit=" Cr" />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: unknown) => [`₹ ${Number(value).toFixed(2)} Cr`, '']}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Area
                    type="monotone"
                    dataKey="quotedCr"
                    name="Quoted (Cr)"
                    stroke="#2563EB"
                    fill="#3B82F6"
                    fillOpacity={0.18}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="wonCr"
                    name="Won (Cr)"
                    stroke="#16A34A"
                    fill="#16A34A"
                    fillOpacity={0.22}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Status Distribution Donut Chart */}
          <div className="xl:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="mb-3">
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Stage Distribution
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Breakdown by current tender stage
              </p>
            </div>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusDistribution}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="46%"
                    innerRadius={46}
                    outerRadius={72}
                    paddingAngle={2}
                  >
                    {statusDistribution.map((slice) => (
                      <Cell key={slice.name} fill={slice.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>
      )}

      {/* Actionable Desk Widgets */}
      <section aria-label="Actionable Desk Widgets" className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Urgent Deadlines Table */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#1E3A8A] dark:text-blue-400" aria-hidden="true" />
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Urgent Submission Deadlines
              </h2>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Next {urgentDeadlines.length} upcoming bids
            </span>
          </div>

          {urgentDeadlines.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No pending tender submissions in the upcoming queue.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400">
                    <th className="py-2.5 px-3 font-semibold">Tender ID / Portal</th>
                    <th className="py-2.5 px-3 font-semibold">Department</th>
                    <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Est. Value</th>
                    <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Due Date</th>
                    <th className="py-2.5 px-3 font-semibold text-right whitespace-nowrap">Due In</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {urgentDeadlines.map((t) => {
                    const days = getDaysRemaining(t.submissionDueDate);
                    const countdownLabel =
                      days < 0
                        ? 'Overdue'
                        : days === 0
                          ? 'Today'
                          : days === 1
                            ? '1 Day Left'
                            : `${days} Days Left`;
                    const urgencyClass =
                      days <= 1
                        ? 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/50'
                        : days <= 4
                          ? 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50'
                          : 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800';
                    return (
                      <tr
                        key={t.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-2.5 px-3">
                          <button
                            type="button"
                            onClick={() => onOpenTender(t)}
                            className="font-mono-num font-medium text-[#1E3A8A] dark:text-blue-400 hover:underline text-left"
                          >
                            {t.tenderId}
                          </button>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t.portal} · {t.stage}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 max-w-[140px] truncate">
                          {t.department}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatINRCompact(t.estimatedValue)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-num text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {formatShortDate(t.submissionDueDate)}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <span
                            className={`font-mono-num inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${urgencyClass}`}
                          >
                            {countdownLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Expiring BGs & Pending Refunds Alert Box */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Expiring BGs & Pending Refunds
              </h2>
            </div>
            <button
              type="button"
              onClick={onGoToEmdBg}
              className="flex items-center gap-1 text-xs font-medium text-[#1E3A8A] dark:text-blue-400 hover:underline whitespace-nowrap"
            >
              <span>Open Tracker</span>
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {financialAlerts.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-500 dark:text-slate-400">
              All Bank Guarantees and EMD refunds are currently within safe timelines.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
              {financialAlerts.map(({ record, daysLeft, isExpiringBg }) => (
                <li
                  key={record.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {record.tenderId} · {record.instrumentType}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {record.bankName} · {record.status}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono-num text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {formatINR(record.amount)}
                    </p>
                    <p
                      className={`font-mono-num text-[11px] font-medium ${
                        isExpiringBg
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {isExpiringBg
                        ? daysLeft < 0
                          ? `Expired ${Math.abs(daysLeft)}d ago`
                          : `Expires in ${daysLeft}d`
                        : 'Refund Follow-up'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
