import assert from 'node:assert/strict';
import test from 'node:test';
import type { EmdBgRecord, Tender } from '../types/crm';
import {
  buildSheetSyncPayload,
  computeMonthlySummaryForSheet,
  detectMisHeaderRowIndex,
  formatFullMonthYearLabel,
  formatIndianDateForSheet,
  formatIndianDateTimeForSheet,
  getSheetStatusRowHighlightColor,
  getTenderInteractionMonthKey,
  GOOGLE_APPS_SCRIPT_CODE_GS,
  groupTendersByInteractionMonth,
  isMonthBannerRow,
  isValidAppsScriptWebhookUrl,
  mapMisRowToTenderFields,
  MIS_MONTHLY_TENDER_HEADERS,
  sanitizeSheetText,
  SHEET_STATUS_HIGHLIGHT_COLORS,
} from './googleSheetSync';

function makeTender(overrides: Partial<Tender>): Tender {
  return {
    id: 't1',
    tenderId: 'GEM/2026/B/1001',
    portal: 'GeM',
    clientName: 'Ministry of Defence',
    department: 'Ministry of Defence',
    locationDepartment: 'Defence / Panchkula',
    location: 'Panchkula, Haryana',
    category: 'IT Hardware',
    title: 'Supply of Rugged Workstations',
    publishDate: '2026-10-01',
    submissionDueDate: '2026-10-20T15:00',
    preBidDate: '2026-10-08',
    technicalOpeningDate: '2026-10-25',
    financialOpeningDate: '2026-10-30',
    estimatedValue: 1000000,
    quotedValue: 950000,
    l1BidderName: 'Saxena Infra',
    l1QuotedValue: 940000,
    ourPositionRank: 'L1',
    assignedOwner: 'Vansh',
    emdStatus: 'EMD Paid',
    emdAmount: 25000,
    stage: 'Identified / Reviewing',
    resultInfo: '',
    completionDate: '',
    checklist: [],
    remarks: [{ id: 'r1', timestamp: '2026-10-02T10:00:00Z', text: 'Reviewed BOQ' }],
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  };
}

function makeEmd(overrides: Partial<EmdBgRecord>): EmdBgRecord {
  return {
    id: 'e1',
    tenderRefId: 't1',
    tenderId: 'GEM/2026/B/1001',
    department: 'Ministry of Defence',
    instrumentType: 'Bank Guarantee (PBG / Bid BG)',
    referenceNo: 'BG-9901',
    bankName: 'SBI Bank',
    amount: 50000,
    issueDate: '2026-10-01',
    expiryDate: '2027-04-01',
    claimEndDate: '2027-06-01',
    status: 'Active / Locked',
    remarks: 'Issued',
    ...overrides,
  };
}

test('formatIndianDateForSheet and formatIndianDateTimeForSheet output DD/MM/YYYY and IST DD/MM/YYYY HH:MM', () => {
  assert.equal(formatIndianDateForSheet('2026-11-16'), '16/11/2026');
  assert.equal(formatIndianDateTimeForSheet('2026-11-16T17:05'), '16/11/2026 17:05');
  assert.equal(formatIndianDateTimeForSheet('2026-11-16T09:40:31.691Z'), '16/11/2026 15:10');
  assert.equal(formatIndianDateForSheet('2026-11-16T20:00:00.000Z'), '17/11/2026');
  assert.equal(formatIndianDateForSheet(''), '');
  assert.equal(formatIndianDateTimeForSheet(''), '');
});

test('sanitizeSheetText preserves ≤/≥/–, repairs mojibake and unit (?10 KVA) artifacts without breaking genuine questions', () => {
  assert.equal(sanitizeSheetText('UPS Rating (≤10 KVA)'), 'UPS Rating (≤10 KVA)');
  assert.equal(sanitizeSheetText('UPS Rating (?10 KVA)'), 'UPS Rating (≤10 KVA)');
  assert.equal(sanitizeSheetText('Capacity â‰¤ 15 KW & â‰¥ 5 KW â€“ Phase 1'), 'Capacity ≤ 15 KW & ≥ 5 KW – Phase 1');
  assert.equal(sanitizeSheetText('Is EMD exempted?'), 'Is EMD exempted?');
  assert.equal(sanitizeSheetText('Budget \uFFFD100 kVA'), 'Budget ≤100 kVA');
});

test('isMonthBannerRow, detectMisHeaderRowIndex, and mapMisRowToTenderFields skip banner rows and support legacy + 21-column MIS headers', () => {
  assert.equal(isMonthBannerRow(['November 2026', '', '', '']), true);
  assert.equal(isMonthBannerRow(['S.No.', 'Tender Ref / ID']), false);

  const legacyRows = [
    ['November 2026'],
    ['S.No.', 'Tender ID / Bid No.', 'Portal / Source', 'Department / Organization', 'District / State', 'Item Category', 'Work / Supply Title', 'Publish Date', 'Submission Due Date'],
    ['1', 'GEM/2026/B/9001', 'GeM', 'Indian Army', 'Panchkula', 'UPS', '10 KVA Online UPS (?10 KVA)', '01/11/2026', '15/11/2026 15:00'],
  ];
  const hdrIdx = detectMisHeaderRowIndex(legacyRows);
  assert.equal(hdrIdx, 1);
  const mappedLegacy = mapMisRowToTenderFields(legacyRows[hdrIdx] as string[], legacyRows[2]);
  assert.equal(mappedLegacy.tenderId, 'GEM/2026/B/9001');
  assert.equal(mappedLegacy.clientName, 'Indian Army');
  assert.equal(mappedLegacy.location, 'Panchkula');
  assert.equal(mappedLegacy.title, '10 KVA Online UPS (≤10 KVA)');

  const fullRows = [
    ['December 2026'],
    [...MIS_MONTHLY_TENDER_HEADERS],
    ['1', 'GEM/2026/B/9002', 'SAIL', 'SAIL / Bokaro', 'Bokaro, Jharkhand', 'Solar Street Light', 'GeM', '02/12/2026', '18/12/2026 17:00', '', '1500000', '30000', 'EMD Paid', 'L1 / Won', '20/12/2026', '28/12/2026', 'Saxena Infra', '1420000', 'L1', 'Vansh', 'PO awaited'],
  ];
  assert.equal(detectMisHeaderRowIndex(fullRows), 1);
  const mappedFull = mapMisRowToTenderFields(fullRows[1] as string[], fullRows[2]);
  assert.equal(mappedFull.l1BidderName, 'Saxena Infra');
  assert.equal(mappedFull.ourPositionRank, 'L1');
  assert.equal(mappedFull.assignedOwner, 'Vansh');
  assert.equal(mappedFull.remarksNextAction, 'PO awaited');
});

test('isValidAppsScriptWebhookUrl validates HTTPS Google Apps Script URLs only', () => {
  assert.equal(
    isValidAppsScriptWebhookUrl(
      'https://script.google.com/macros/s/AKfycbDemoWebhookTest123/exec',
    ),
    true,
  );
  assert.equal(
    isValidAppsScriptWebhookUrl('https://script.googleusercontent.com/macros/echo?user_content_key=1'),
    true,
  );
  assert.equal(
    isValidAppsScriptWebhookUrl('http://script.google.com/macros/s/AKfycb123/exec'),
    false,
  );
  assert.equal(
    isValidAppsScriptWebhookUrl('https://evil.example.com/macros/s/abc/exec'),
    false,
  );
  assert.equal(isValidAppsScriptWebhookUrl('http://localhost:3000/api/auth/login'), false);
  assert.equal(isValidAppsScriptWebhookUrl(''), false);
});

test('groups tenders dynamically by lastUpdatedAt/updatedAt interaction month rather than publishDate', () => {
  const octPublishedEditedInNov = makeTender({
    id: 't-oct-edit-nov',
    tenderId: 'GEM/2026/B/1101',
    publishDate: '2026-10-05',
    updatedAt: '2026-11-10T09:00:00.000Z',
    lastUpdatedAt: '2026-11-10T09:00:00.000Z',
  });
  const decTender = makeTender({
    id: 't-dec',
    tenderId: 'GEM/2026/B/1201',
    publishDate: '2026-11-28',
    updatedAt: '2026-12-03T10:30:00.000Z',
  });
  const fallbackNoUpdated = makeTender({
    id: 't-fallback-oct',
    tenderId: 'GEM/2026/B/1009',
    publishDate: '2026-10-14',
    updatedAt: '',
    lastUpdatedAt: undefined,
  });

  assert.equal(getTenderInteractionMonthKey(octPublishedEditedInNov), '2026-11');
  assert.equal(getTenderInteractionMonthKey(fallbackNoUpdated), '2026-10');
  assert.equal(formatFullMonthYearLabel('2026-11'), 'November 2026');

  const blocks = groupTendersByInteractionMonth([
    decTender,
    octPublishedEditedInNov,
    fallbackNoUpdated,
  ]);

  assert.equal(blocks.length, 3);
  assert.deepEqual(
    blocks.map((b) => b.monthLabel),
    ['October 2026', 'November 2026', 'December 2026'],
  );
  assert.equal(blocks[0]?.rows[0]?.tenderId, 'GEM/2026/B/1009');
  assert.equal(blocks[1]?.rows[0]?.tenderId, 'GEM/2026/B/1101');
  assert.equal(blocks[2]?.rows[0]?.tenderId, 'GEM/2026/B/1201');
});

test('numbers S.No. freshly from 1 inside each month block (e.g., 1..17 in November, restarting at 1 in December)', () => {
  const novTenders = Array.from({ length: 17 }, (_, idx) =>
    makeTender({
      id: `nov-${idx + 1}`,
      tenderId: `GEM/2026/B/${String(2000 + idx + 1)}`,
      publishDate: '2026-10-01',
      updatedAt: `2026-11-${String(idx + 1).padStart(2, '0')}T10:00:00.000Z`,
    }),
  );
  const decTenders = [
    makeTender({
      id: 'dec-1',
      tenderId: 'GEM/2026/B/3001',
      publishDate: '2026-11-29',
      updatedAt: '2026-12-01T11:00:00.000Z',
    }),
    makeTender({
      id: 'dec-2',
      tenderId: 'GEM/2026/B/3002',
      publishDate: '2026-11-30',
      updatedAt: '2026-12-02T11:00:00.000Z',
    }),
  ];

  const payload = buildSheetSyncPayload({
    action: 'UPDATE',
    entityType: 'TENDER',
    tenders: [...decTenders, ...novTenders],
    emdRecords: [],
  });

  assert.equal(payload.monthlyBlocks.length, 2);
  assert.equal(payload.monthlyBlocks[0]?.monthLabel, 'November 2026');
  assert.equal(payload.monthlyBlocks[0]?.rows.length, 17);
  assert.equal(payload.monthlyBlocks[0]?.rows[0]?.serialNo, 1);
  assert.equal(payload.monthlyBlocks[0]?.rows[16]?.serialNo, 17);

  assert.equal(payload.monthlyBlocks[1]?.monthLabel, 'December 2026');
  assert.equal(payload.monthlyBlocks[1]?.rows.length, 2);
  assert.equal(payload.monthlyBlocks[1]?.rows[0]?.serialNo, 1);
  assert.equal(payload.monthlyBlocks[1]?.rows[1]?.serialNo, 2);
});

test('computeMonthlySummaryForSheet groups breakdown by interaction month accurately', () => {
  const tenders: Tender[] = [
    makeTender({ id: 't1', stage: 'Identified / Reviewing', estimatedValue: 500000, quotedValue: 0, updatedAt: '2026-10-15T14:00:00Z' }),
    makeTender({ id: 't2', stage: 'Doc Preparation', estimatedValue: 300000, quotedValue: 0, updatedAt: '2026-10-18T14:00:00Z' }),
    makeTender({ id: 't3', stage: 'Submitted', estimatedValue: 1200000, quotedValue: 1150000, updatedAt: '2026-10-22T14:00:00Z' }),
    makeTender({ id: 't4', stage: 'Technical Eval', estimatedValue: 800000, quotedValue: 780000, updatedAt: '2026-11-05T14:00:00Z' }),
    makeTender({ id: 't5', stage: 'L1 / Won', estimatedValue: 2000000, quotedValue: 1900000, updatedAt: '2026-11-10T14:00:00Z' }),
    makeTender({ id: 't6', stage: 'Lost (L2/L3)', estimatedValue: 600000, quotedValue: 620000, updatedAt: '2026-11-12T14:00:00Z' }),
    makeTender({ id: 't7', stage: 'Tender Not Filled', estimatedValue: 400000, quotedValue: 0, updatedAt: '2026-11-15T14:00:00Z' }),
  ];
  const emds: EmdBgRecord[] = [
    makeEmd({ id: 'e1', amount: 100000, status: 'Active / Locked' }),
    makeEmd({ id: 'e2', amount: 40000, status: 'Refund / Release Applied' }),
    makeEmd({ id: 'e3', amount: 75000, status: 'Refunded / Released' }),
  ];

  const summary = computeMonthlySummaryForSheet(tenders, emds);
  assert.equal(summary.totalTenders, 7);
  assert.equal(summary.inPreparationCount, 2);
  assert.equal(summary.submittedCount, 2);
  assert.equal(summary.awardedCount, 1);
  assert.equal(summary.rejectedLostCount, 2);
  assert.equal(summary.totalEstimatedValue, 5800000);
  assert.equal(summary.totalQuotedValue, 4450000);
  assert.equal(summary.awardedValue, 1900000);
  assert.equal(summary.totalEmdRecords, 3);
  assert.equal(summary.activeEmdLockedAmount, 140000);
  assert.equal(summary.refundAppliedAmount, 40000);
  assert.equal(summary.releasedAmount, 75000);
  assert.equal(summary.monthlyBreakdown.length, 2);
  assert.deepEqual(
    summary.monthlyBreakdown.map((m) => m.monthLabel),
    ['October 2026', 'November 2026'],
  );
});

test('GOOGLE_APPS_SCRIPT_CODE_GS removes frozen rows, uses exact 21 MIS columns, merges A:U banners, and leaves 3 blank rows between months', () => {
  assert.equal(MIS_MONTHLY_TENDER_HEADERS.length, 21);
  assert.deepEqual([...MIS_MONTHLY_TENDER_HEADERS], [
    'S.No.',
    'Tender Ref / ID',
    'Client / Organization Name',
    'Location / Department',
    'Location',
    'Brief Description & Scope of Work',
    'Portal / Platform',
    'Publish / Tender Date',
    'Due Date & Time',
    'Pre-Bid Meeting Date',
    'Estimated Tender Value (INR)',
    'EMD Amount (INR)',
    'EMD Mode / Form',
    'Current Status',
    'Technical Opening Date',
    'Financial Opening Date',
    'L1 Bidder Name',
    'L1 Quoted Value (INR)',
    'Our Position / Rank',
    'Assigned Person / Owner',
    'Remarks / Next Action',
  ]);

  assert.ok(!GOOGLE_APPS_SCRIPT_CODE_GS.includes('setFrozenRows(1)'));
  assert.ok(!GOOGLE_APPS_SCRIPT_CODE_GS.includes('frozenRowCount: 1'));
  assert.ok(GOOGLE_APPS_SCRIPT_CODE_GS.includes('setFrozenRows(0)'));

  for (const h of MIS_MONTHLY_TENDER_HEADERS) {
    assert.ok(GOOGLE_APPS_SCRIPT_CODE_GS.includes(`'${h}'`), `Missing MIS header ${h}`);
  }

  assert.ok(GOOGLE_APPS_SCRIPT_CODE_GS.includes('BLANK_GAP_ROWS_BETWEEN_MONTHS = 3'));
  assert.ok(GOOGLE_APPS_SCRIPT_CODE_GS.includes('bannerRange.merge()'));
  assert.ok(GOOGLE_APPS_SCRIPT_CODE_GS.includes("setBackground('#000000')"));
  assert.ok(!GOOGLE_APPS_SCRIPT_CODE_GS.includes('Last Synced At (UTC)'));

  assert.doesNotThrow(() => new Function(GOOGLE_APPS_SCRIPT_CODE_GS));
});

test('GOOGLE_APPS_SCRIPT_CODE_GS doPost initializes all 21 headers on PING/empty tenders and writes merged A:U banners, fresh S.No., UTF-8 <=, and 3-row gaps', () => {
  interface MockCellMeta {
    value: unknown;
    bg?: string;
    fg?: string;
    weight?: string;
    hAlign?: string;
  }

  class MockSheet {
    name: string;
    frozenRows = 1;
    cells = new Map<string, MockCellMeta>();
    merges: Array<{ row: number; col: number; numRows: number; numCols: number }> = [];

    constructor(name: string) {
      this.name = name;
    }
    setFrozenRows(n: number) {
      this.frozenRows = n;
    }
    getLastRow(): number {
      let max = 0;
      for (const k of this.cells.keys()) {
        const r = Number(k.split(',')[0]);
        if (r > max) max = r;
      }
      return max;
    }
    getLastColumn(): number {
      let max = 0;
      for (const k of this.cells.keys()) {
        const c = Number(k.split(',')[1]);
        if (c > max) max = c;
      }
      return max;
    }
    clear() {
      this.cells.clear();
      this.merges = [];
    }
    autoResizeColumns() {}
    setRowHeight() {}
    appendRow(row: unknown[]) {
      const nextR = this.getLastRow() + 1;
      for (let c = 0; c < row.length; c += 1) {
        this.cells.set(`${nextR},${c + 1}`, { value: row[c] });
      }
    }
    deleteRow() {}
    getRange(row: number, col: number, numRows = 1, numCols = 1) {
      const sheet = this;
      const rangeObj = {
        merge() {
          sheet.merges.push({ row, col, numRows, numCols });
          return rangeObj;
        },
        breakApart() {
          sheet.merges = [];
          return rangeObj;
        },
        setValue(val: unknown) {
          sheet.cells.set(`${row},${col}`, { ...(sheet.cells.get(`${row},${col}`) ?? { value: '' }), value: val });
          return rangeObj;
        },
        setValues(vals: unknown[][]) {
          for (let r = 0; r < vals.length; r += 1) {
            for (let c = 0; c < (vals[r]?.length ?? 0); c += 1) {
              const key = `${row + r},${col + c}`;
              sheet.cells.set(key, { ...(sheet.cells.get(key) ?? { value: '' }), value: vals[r][c] });
            }
          }
          return rangeObj;
        },
        getValues() {
          const out: unknown[][] = [];
          for (let r = 0; r < numRows; r += 1) {
            const line: unknown[] = [];
            for (let c = 0; c < numCols; c += 1) {
              line.push(sheet.cells.get(`${row + r},${col + c}`)?.value ?? '');
            }
            out.push(line);
          }
          return out;
        },
        setBackground(bg: string) {
          for (let r = 0; r < numRows; r += 1) {
            for (let c = 0; c < numCols; c += 1) {
              const key = `${row + r},${col + c}`;
              sheet.cells.set(key, { ...(sheet.cells.get(key) ?? { value: '' }), bg });
            }
          }
          return rangeObj;
        },
        setBackgrounds(bgs: string[][]) {
          for (let r = 0; r < bgs.length; r += 1) {
            for (let c = 0; c < (bgs[r]?.length ?? 0); c += 1) {
              const key = `${row + r},${col + c}`;
              sheet.cells.set(key, { ...(sheet.cells.get(key) ?? { value: '' }), bg: bgs[r][c] });
            }
          }
          return rangeObj;
        },
        setFontColor(fg: string) {
          for (let r = 0; r < numRows; r += 1) {
            for (let c = 0; c < numCols; c += 1) {
              const key = `${row + r},${col + c}`;
              sheet.cells.set(key, { ...(sheet.cells.get(key) ?? { value: '' }), fg });
            }
          }
          return rangeObj;
        },
        setFontWeight(weight: string) {
          for (let r = 0; r < numRows; r += 1) {
            for (let c = 0; c < numCols; c += 1) {
              const key = `${row + r},${col + c}`;
              sheet.cells.set(key, { ...(sheet.cells.get(key) ?? { value: '' }), weight });
            }
          }
          return rangeObj;
        },
        setFontSize() {
          return rangeObj;
        },
        setHorizontalAlignment(hAlign: string) {
          for (let r = 0; r < numRows; r += 1) {
            for (let c = 0; c < numCols; c += 1) {
              const key = `${row + r},${col + c}`;
              sheet.cells.set(key, { ...(sheet.cells.get(key) ?? { value: '' }), hAlign });
            }
          }
          return rangeObj;
        },
        setVerticalAlignment() {
          return rangeObj;
        },
        setWrap() {
          return rangeObj;
        },
        setBorder() {
          return rangeObj;
        },
      };
      return rangeObj;
    }
  }

  const sheets = new Map<string, MockSheet>();
  const mockSpreadsheet = {
    getName: () => 'MIS Monthly Report',
    getSheetByName: (name: string) => sheets.get(name) ?? null,
    insertSheet: (name: string) => {
      const s = new MockSheet(name);
      sheets.set(name, s);
      return s;
    },
  };

  const sandboxFactory = new Function(
    'SpreadsheetApp',
    'LockService',
    'Utilities',
    'ContentService',
    `${GOOGLE_APPS_SCRIPT_CODE_GS}; return { doPost: doPost };`,
  );

  const mockGlobals = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => mockSpreadsheet,
      BorderStyle: { SOLID: 'SOLID' },
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
    },
    Utilities: {
      formatDate: (d: Date, tz: string, fmt: string) => {
        if (fmt === 'yyyy-MM') {
          const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(d);
          return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
        }
        return formatIndianDateForSheet(d.toISOString());
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (txt: string) => ({
        _txt: txt,
        setMimeType() { return this; },
      }),
    },
  };

  const scriptExports = sandboxFactory(
    mockGlobals.SpreadsheetApp,
    mockGlobals.LockService,
    mockGlobals.Utilities,
    mockGlobals.ContentService,
  ) as { doPost: (e: unknown) => { _txt: string } };

  // 1. PING with zero tenders still renders Month Banner + all 21 MIS headings
  const pingPayload = buildSheetSyncPayload({
    action: 'PING',
    entityType: 'TENDER',
    tenders: [],
    emdRecords: [],
  });
  const pingResp = JSON.parse(
    scriptExports.doPost({ postData: { contents: JSON.stringify(pingPayload) } })._txt,
  ) as { ok: boolean; ping?: boolean };
  assert.equal(pingResp.ok, true);
  assert.equal(pingResp.ping, true);
  const pingSheet = sheets.get('Daily Tender Data')!;
  assert.deepEqual(pingSheet.merges[0], { row: 1, col: 1, numRows: 1, numCols: 21 });
  assert.equal(pingSheet.cells.get('2,1')?.value, 'S.No.');
  assert.equal(pingSheet.cells.get('2,21')?.value, 'Remarks / Next Action');

  // 2. Multi-month tenders with UTF-8 <= symbol & 3 blank gap rows
  const novTenders = Array.from({ length: 17 }, (_, idx) =>
    makeTender({
      id: `n-${idx + 1}`,
      tenderId: `GEM/2026/B/${5001 + idx}`,
      title: idx === 0 ? 'Online UPS System (?10 KVA)' : 'Supply of Rugged Workstations',
      publishDate: '2026-10-03',
      updatedAt: `2026-11-${String(idx + 1).padStart(2, '0')}T08:00:00.000Z`,
    }),
  );
  const decTender = makeTender({
    id: 'd-1',
    tenderId: 'GEM/2026/B/6001',
    publishDate: '2026-11-28',
    updatedAt: '2026-12-04T09:00:00.000Z',
  });

  const payload = buildSheetSyncPayload({
    action: 'UPDATE',
    entityType: 'TENDER',
    tenders: [decTender, ...novTenders],
    emdRecords: [],
    assignedOwner: 'Vansh',
  });

  const resp = scriptExports.doPost({
    postData: { contents: JSON.stringify(payload) },
  });
  const parsedResp = JSON.parse(resp._txt) as { ok: boolean; rowsAffected: number };
  assert.equal(parsedResp.ok, true);

  const sheet = sheets.get('Daily Tender Data')!;
  assert.equal(sheet.frozenRows, 0);

  // Row 1: November 2026 Banner merged A1:U1 (#000000 bg, centered bold white)
  assert.deepEqual(sheet.merges[0], { row: 1, col: 1, numRows: 1, numCols: 21 });
  const novBanner = sheet.cells.get('1,1');
  assert.equal(novBanner?.value, 'November 2026');
  assert.equal(novBanner?.bg, '#000000');
  assert.equal(novBanner?.fg, '#FFFFFF');
  assert.equal(novBanner?.weight, 'bold');
  assert.equal(novBanner?.hAlign, 'center');

  // Row 2: Header row (21 columns)
  assert.equal(sheet.cells.get('2,1')?.value, 'S.No.');
  assert.equal(sheet.cells.get('2,21')?.value, 'Remarks / Next Action');
  assert.equal(sheet.cells.get('2,2')?.bg, '#0F172A');

  // Rows 3..19: 17 November tenders (S.No. 1..17) and clean <= rendering
  assert.equal(sheet.cells.get('3,1')?.value, 1);
  assert.equal(sheet.cells.get('3,2')?.value, 'GEM/2026/B/5001');
  assert.equal(sheet.cells.get('3,6')?.value, 'Online UPS System (≤10 KVA) [IT Hardware]');
  assert.equal(sheet.cells.get('19,1')?.value, 17);
  assert.equal(sheet.cells.get('19,2')?.value, 'GEM/2026/B/5017');

  // Rows 20, 21, 22: 3 blank rows
  assert.equal(sheet.cells.has('20,1'), false);
  assert.equal(sheet.cells.has('21,1'), false);
  assert.equal(sheet.cells.has('22,1'), false);

  // Row 23: December 2026 Banner merged A23:U23
  assert.deepEqual(sheet.merges[1], { row: 23, col: 1, numRows: 1, numCols: 21 });
  assert.equal(sheet.cells.get('23,1')?.value, 'December 2026');

  // Row 24: Header row
  assert.equal(sheet.cells.get('24,1')?.value, 'S.No.');
  assert.equal(sheet.cells.get('24,21')?.value, 'Remarks / Next Action');

  // Row 25: First December tender restarts at S.No. 1
  assert.equal(sheet.cells.get('25,1')?.value, 1);
  assert.equal(sheet.cells.get('25,2')?.value, 'GEM/2026/B/6001');
  assert.equal(sheet.cells.get('25,20')?.value, 'Vansh');

  // 3. Status-based row highlighting across all 21 columns + clean re-sync update
  const highlightedTenders: Tender[] = [
    makeTender({ id: 's1', tenderId: 'GEM/1', stage: 'Tender Not Filled', updatedAt: '2026-11-01T10:00:00Z' }),
    makeTender({ id: 's2', tenderId: 'GEM/2', stage: 'Cancelled / Retendered', updatedAt: '2026-11-02T10:00:00Z' }),
    makeTender({ id: 's3', tenderId: 'GEM/3', stage: 'Identified / Reviewing', updatedAt: '2026-11-03T10:00:00Z' }),
    makeTender({ id: 's4', tenderId: 'GEM/4', stage: 'Doc Preparation', updatedAt: '2026-11-04T10:00:00Z' }),
    makeTender({ id: 's5', tenderId: 'GEM/5', stage: 'Submitted', updatedAt: '2026-11-05T10:00:00Z' }),
    makeTender({ id: 's6', tenderId: 'GEM/6', stage: 'Technical Eval', updatedAt: '2026-11-06T10:00:00Z' }),
    makeTender({ id: 's7', tenderId: 'GEM/7', stage: 'Financial / BOQ Eval', updatedAt: '2026-11-07T10:00:00Z' }),
    makeTender({ id: 's8', tenderId: 'GEM/8', stage: 'L1 / Won', updatedAt: '2026-11-08T10:00:00Z' }),
  ];

  const highlightPayload = buildSheetSyncPayload({
    action: 'FULL_SYNC',
    entityType: 'BULK',
    tenders: highlightedTenders,
    emdRecords: [],
  });
  scriptExports.doPost({ postData: { contents: JSON.stringify(highlightPayload) } });

  // Row 3 = s1 (Tender Not Filled -> Red), Row 4 = s2 (Cancelled -> Red)
  assert.equal(sheet.cells.get('3,1')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.red);
  assert.equal(sheet.cells.get('3,21')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.red);
  assert.equal(sheet.cells.get('4,14')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.red);
  // Row 5 = s3 (Identified / Reviewing -> Orange), Row 6 = s4 (Doc Preparation -> Orange)
  assert.equal(sheet.cells.get('5,1')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.orange);
  assert.equal(sheet.cells.get('6,14')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.orange);
  // Row 7 = s5 (Submitted -> Green), Row 8 = s6 (Technical Eval -> Green), Row 9 = s7 (Financial / BOQ Eval -> Green)
  assert.equal(sheet.cells.get('7,1')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.green);
  assert.equal(sheet.cells.get('8,14')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.green);
  assert.equal(sheet.cells.get('9,21')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.green);
  // Row 10 = s8 (L1 / Won -> White default)
  assert.equal(sheet.cells.get('10,1')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.defaultWhite);

  // Subsequent sync changes s3 status from Identified / Reviewing (Orange) -> Submitted (Green) and s1 -> L1 / Won (White)
  const updatedHighlightPayload = buildSheetSyncPayload({
    action: 'UPDATE',
    entityType: 'TENDER',
    tenders: highlightedTenders.map((t) =>
      t.id === 's3'
        ? { ...t, stage: 'Submitted' }
        : t.id === 's1'
          ? { ...t, stage: 'L1 / Won' }
          : t,
    ),
    emdRecords: [],
  });
  scriptExports.doPost({ postData: { contents: JSON.stringify(updatedHighlightPayload) } });
  assert.equal(sheet.cells.get('3,1')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.defaultWhite);
  assert.equal(sheet.cells.get('5,14')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.green);
  assert.equal(sheet.cells.get('5,21')?.bg, SHEET_STATUS_HIGHLIGHT_COLORS.green);
});

test('getSheetStatusRowHighlightColor maps red, orange, green, and default white statuses accurately', () => {
  assert.equal(getSheetStatusRowHighlightColor('Cancelled'), SHEET_STATUS_HIGHLIGHT_COLORS.red);
  assert.equal(getSheetStatusRowHighlightColor('Cancelled / Retendered'), SHEET_STATUS_HIGHLIGHT_COLORS.red);
  assert.equal(getSheetStatusRowHighlightColor('Tender Not Filled'), SHEET_STATUS_HIGHLIGHT_COLORS.red);

  assert.equal(getSheetStatusRowHighlightColor('Documentation Identified'), SHEET_STATUS_HIGHLIGHT_COLORS.orange);
  assert.equal(getSheetStatusRowHighlightColor('Identified / Reviewing'), SHEET_STATUS_HIGHLIGHT_COLORS.orange);
  assert.equal(getSheetStatusRowHighlightColor('Doc Preparation'), SHEET_STATUS_HIGHLIGHT_COLORS.orange);

  assert.equal(getSheetStatusRowHighlightColor('Submitted'), SHEET_STATUS_HIGHLIGHT_COLORS.green);
  assert.equal(getSheetStatusRowHighlightColor('Technical Stage'), SHEET_STATUS_HIGHLIGHT_COLORS.green);
  assert.equal(getSheetStatusRowHighlightColor('Technical Eval'), SHEET_STATUS_HIGHLIGHT_COLORS.green);
  assert.equal(getSheetStatusRowHighlightColor('Financial Stage'), SHEET_STATUS_HIGHLIGHT_COLORS.green);
  assert.equal(getSheetStatusRowHighlightColor('Financial / BOQ Eval'), SHEET_STATUS_HIGHLIGHT_COLORS.green);

  assert.equal(getSheetStatusRowHighlightColor('L1 / Won'), SHEET_STATUS_HIGHLIGHT_COLORS.defaultWhite);
  assert.equal(getSheetStatusRowHighlightColor('Lost (L2/L3)'), SHEET_STATUS_HIGHLIGHT_COLORS.defaultWhite);
  assert.equal(getSheetStatusRowHighlightColor(''), SHEET_STATUS_HIGHLIGHT_COLORS.defaultWhite);
});



