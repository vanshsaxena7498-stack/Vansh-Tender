import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMonthlyChartSeries,
  buildStatusDistribution,
  calculateBidQuote,
  computeDashboardKpis,
  computeEmdBgSummary,
  computeNotifications,
  filterTendersForDashboard,
} from './calculations';
import {
  formatINR,
  formatINRCompact,
  getDaysRemaining,
  getFinancialYear,
  getLatestRemarkText,
  getLocalDateInputValue,
  parseCalendarDate,
} from './formatters';
import { SEED_EMD_RECORDS, SEED_TENDERS } from '../data/seedData';

test('formatINR and formatINRCompact format Indian Lakhs and Crores accurately', () => {
  assert.equal(formatINR(14500000), '₹ 1,45,00,000');
  assert.equal(formatINRCompact(14500000), '₹ 1.45 Cr');
  assert.equal(formatINRCompact(840000), '₹ 8.40 L');
  assert.equal(formatINRCompact(95000), '₹ 95.0 K');
});

test('getFinancialYear maps Indian FY correctly across March/April boundary', () => {
  assert.equal(getFinancialYear('2026-03-31'), 'FY 2025-26');
  assert.equal(getFinancialYear('2026-04-01'), 'FY 2026-27');
  assert.equal(getFinancialYear('2026-11-13'), 'FY 2026-27');
});

test('computeDashboardKpis computes seed tender counts, win rate, and capital blocked', () => {
  const kpis = computeDashboardKpis(SEED_TENDERS, SEED_EMD_RECORDS);
  assert.equal(kpis.totalTracked, 8);
  // Submitted or beyond: tnd-3 (Won), tnd-4 (Fin Eval), tnd-5 (Lost), tnd-6 (Won), tnd-7 (Submitted), tnd-8 (Tech Eval) = 6
  assert.equal(kpis.bidsSubmitted, 6);
  assert.equal(kpis.tendersWonCount, 2);
  // Decided: 2 won + 1 lost = 3 -> 2/3 = 66.7%
  assert.equal(kpis.winSuccessRatePct, 66.7);
  // Active capital blocked: 840000 + 684000 + 500000 + 380000 + 650000 + 192000 = 3246000
  assert.equal(kpis.activeCapitalBlocked, 3246000);
});

test('filterTendersForDashboard filters by portal and FY accurately', () => {
  const gemOnly = filterTendersForDashboard(SEED_TENDERS, {
    financialYear: 'ALL',
    month: 'ALL',
    portal: 'GeM',
  });
  assert.equal(gemOnly.length, 2);
  assert.ok(gemOnly.every((t) => t.portal === 'GeM'));
});

test('buildMonthlyChartSeries and buildStatusDistribution produce valid sorted series', () => {
  const series = buildMonthlyChartSeries(SEED_TENDERS);
  assert.ok(series.length >= 4);
  for (let i = 1; i < series.length; i++) {
    assert.ok(series[i].monthKey > series[i - 1].monthKey);
  }
  const slices = buildStatusDistribution(SEED_TENDERS);
  const totalInSlices = slices.reduce((sum, s) => sum + s.value, 0);
  assert.equal(totalInSlices, SEED_TENDERS.length);

  const withNotFilled = [
    ...SEED_TENDERS,
    { ...SEED_TENDERS[0], id: 'tnd-not-filled', stage: 'Tender Not Filled' as const },
  ];
  const slicesWithNotFilled = buildStatusDistribution(withNotFilled);
  const notFilledSlice = slicesWithNotFilled.find((s) => s.name === 'Not Filled');
  assert.equal(notFilledSlice?.value, 1);
  assert.equal(notFilledSlice?.color, '#EF4444');
});

test('computeNotifications detects <=5d (120h) deadlines, <30d BG expiry, and >60d EMD pending refund', () => {
  const now = new Date('2026-11-11T10:00:00');
  const farTender = {
    ...SEED_TENDERS[0],
    id: 'tnd-far-6d',
    tenderId: 'GEM/2026/B/9999999',
    submissionDueDate: '2026-11-18T10:00', // 7 days away (> 5 days) -> excluded
  };
  const notifications = computeNotifications([...SEED_TENDERS, farTender], SEED_EMD_RECORDS, now);

  const deadlines = notifications.filter((n) => n.category === 'deadline_5d');
  const bgExpiries = notifications.filter((n) => n.category === 'bg_expiry_30d');
  const emdOverdue = notifications.filter((n) => n.category === 'emd_refund_60d');

  assert.equal(deadlines.length, 2); // tnd-1 (~3d6h) & tnd-2 (~4d4h) within 5 days; farTender excluded
  assert.equal(deadlines[0].daysOrHoursLabel, '3d 6h left');
  assert.equal(bgExpiries.length, 2);
  assert.equal(emdOverdue.length, 1);
});

test('computeEmdBgSummary separates active EMD, active BG, pending refund, and released totals', () => {
  const now = new Date('2026-11-13T18:00:00');
  const summary = computeEmdBgSummary(SEED_EMD_RECORDS, SEED_TENDERS, now);
  assert.equal(summary.activeEmdLocked, 500000 + 380000 + 192000);
  assert.equal(summary.activeBgTotal, 840000 + 684000 + 650000);
  assert.equal(summary.pendingRefundOverdue, 380000 + 650000);
  assert.equal(summary.safelyReleased, 450000);
});

test('calculateBidQuote applies margin first and GST on top of subtotal', () => {
  const res = calculateBidQuote(1000000, 18, 10);
  assert.equal(res.marginAmount, 100000);
  assert.equal(res.subtotalWithMargin, 1100000);
  assert.equal(res.gstAmount, 198000);
  assert.equal(res.finalBidQuote, 1298000);
});

test('parseCalendarDate, getLocalDateInputValue, getDaysRemaining, and getLatestRemarkText handle local dates and timestamps', () => {
  const localNov15 = parseCalendarDate('2026-11-15');
  assert.ok(localNov15);
  assert.equal(localNov15.getFullYear(), 2026);
  assert.equal(localNov15.getMonth(), 10);
  assert.equal(localNov15.getDate(), 15);
  assert.equal(getLocalDateInputValue(new Date(2026, 3, 1)), '2026-04-01');
  assert.equal(getDaysRemaining('2026-11-15', new Date(2026, 10, 12, 23, 30)), 3);

  assert.equal(
    getLatestRemarkText([
      { id: '1', timestamp: '2026-11-10 09:00', text: 'Older note' },
      { id: '2', timestamp: '2026-11-14 18:15', text: 'Newest note' },
    ]),
    'Newest note',
  );
  assert.equal(
    getLatestRemarkText([
      { id: '2', timestamp: '2026-11-14 18:15', text: 'Prepended newest' },
      { id: '1', timestamp: '2026-11-10 09:00', text: 'Older note' },
    ]),
    'Prepended newest',
  );
});
