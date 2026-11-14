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
import { formatINR, formatINRCompact, getFinancialYear } from './formatters';
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

test('computeNotifications detects <48h deadlines, <30d BG expiry, and >60d EMD pending refund', () => {
  const now = new Date('2026-11-13T18:00:00');
  const notifications = computeNotifications(SEED_TENDERS, SEED_EMD_RECORDS, now);

  const deadlines = notifications.filter((n) => n.category === 'deadline_48h');
  const bgExpiries = notifications.filter((n) => n.category === 'bg_expiry_30d');
  const emdOverdue = notifications.filter((n) => n.category === 'emd_refund_60d');

  assert.equal(deadlines.length, 2); // tnd-1 (Nov 14 16:00) & tnd-2 (Nov 15 14:00)
  assert.equal(bgExpiries.length, 2); // emd-2 (Dec 02) & emd-5 (Dec 08)
  assert.equal(emdOverdue.length, 1); // emd-4 (AIIMS Bhopal lost 2026-08-25 -> 80 days)
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
