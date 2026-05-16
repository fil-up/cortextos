import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockBatchUpdate = vi.fn();

vi.mock('googleapis', () => {
  class MockGoogleAuth {
    constructor(_opts: unknown) {}
  }
  return {
    google: {
      auth: { GoogleAuth: MockGoogleAuth },
      sheets: vi.fn().mockReturnValue({
        spreadsheets: {
          values: {
            get: mockGet,
            update: mockUpdate,
            batchUpdate: mockBatchUpdate,
          },
        },
      }),
    },
  };
});

const { readSheet, writeSheet, writeSheetByVenueName } = await import('../../../src/bus/sheets.js');

let tmpDir: string;
let serviceAccountPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cortextos-sheets-test-'));
  serviceAccountPath = join(tmpDir, 'service-account.json');
  writeFileSync(serviceAccountPath, JSON.stringify({ type: 'service_account' }));
  mockGet.mockReset();
  mockUpdate.mockReset();
  mockBatchUpdate.mockReset();
});

// --- readSheet ---

describe('readSheet', () => {
  it('returns values and range from API response', async () => {
    mockGet.mockResolvedValue({
      data: {
        values: [['Venue', 'Status'], ['The 101', 'FINALIST']],
        range: 'Venues!A1:B2',
      },
    });

    const result = await readSheet({
      spreadsheetId: 'sheet-id-abc',
      range: 'Venues!A:B',
      serviceAccountPath,
    });

    expect(result.values).toEqual([['Venue', 'Status'], ['The 101', 'FINALIST']]);
    expect(result.range).toBe('Venues!A1:B2');
    expect(mockGet).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id-abc',
      range: 'Venues!A:B',
    });
  });

  it('returns empty array and input range when API returns no values', async () => {
    mockGet.mockResolvedValue({ data: {} });

    const result = await readSheet({
      spreadsheetId: 'sheet-id-abc',
      range: 'Budget!A:Z',
      serviceAccountPath,
    });

    expect(result.values).toEqual([]);
    expect(result.range).toBe('Budget!A:Z');
  });

  it('throws when service account file does not exist', async () => {
    await expect(
      readSheet({
        spreadsheetId: 'sheet-id-abc',
        range: 'Venues!A:B',
        serviceAccountPath: join(tmpDir, 'nonexistent.json'),
      }),
    ).rejects.toThrow('Service account key not found');
  });
});

// --- writeSheet ---

describe('writeSheet', () => {
  it('calls values.update with correct params and returns cell count', async () => {
    mockUpdate.mockResolvedValue({
      data: { updatedCells: 3, updatedRange: 'Venues!B5:D5' },
    });

    const result = await writeSheet({
      spreadsheetId: 'sheet-id-abc',
      range: 'Venues!B5:D5',
      values: [['LOCKED', 'THE 101', '2027-03-27']],
      serviceAccountPath,
    });

    expect(result.updatedCells).toBe(3);
    expect(result.updatedRange).toBe('Venues!B5:D5');
    expect(mockUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id-abc',
      range: 'Venues!B5:D5',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['LOCKED', 'THE 101', '2027-03-27']] },
    });
  });

  it('defaults updatedCells to 0 when API returns undefined', async () => {
    mockUpdate.mockResolvedValue({ data: {} });

    const result = await writeSheet({
      spreadsheetId: 'sheet-id-abc',
      range: 'Budget!B12',
      values: [['5445.48']],
      serviceAccountPath,
    });

    expect(result.updatedCells).toBe(0);
    expect(result.updatedRange).toBe('Budget!B12');
  });

  it('throws when service account file does not exist', async () => {
    await expect(
      writeSheet({
        spreadsheetId: 'sheet-id-abc',
        range: 'Venues!A1',
        values: [['test']],
        serviceAccountPath: join(tmpDir, 'nonexistent.json'),
      }),
    ).rejects.toThrow('Service account key not found');
  });

  it('propagates API errors', async () => {
    mockUpdate.mockRejectedValue(new Error('403 Forbidden'));

    await expect(
      writeSheet({
        spreadsheetId: 'sheet-id-abc',
        range: 'Venues!A1',
        values: [['test']],
        serviceAccountPath,
      }),
    ).rejects.toThrow('403 Forbidden');
  });
});

// --- writeSheetByVenueName ---

describe('writeSheetByVenueName', () => {
  const VENUE_COL_DATA = [
    ['Venue'],
    ['The 101 (Pioneer Square)'],
    ['Europa (weekday)'],
    ['Broadway Hall'],
  ];

  it('resolves row by venue name and batch-updates the correct cells', async () => {
    mockGet.mockResolvedValue({ data: { values: VENUE_COL_DATA, range: 'Venues!B:B' } });
    mockBatchUpdate.mockResolvedValue({ data: { totalUpdatedCells: 2 } });

    const result = await writeSheetByVenueName({
      spreadsheetId: 'sheet-id-abc',
      tab: 'Venues',
      venueNameCol: 'B',
      venueName: 'Broadway Hall',
      updates: [
        { col: 'C', value: 'TOUR SCHEDULED' },
        { col: 'L', value: 'Tour Sunday 2026-05-17' },
      ],
      serviceAccountPath,
    });

    expect(result.notFound).toBe(false);
    expect(result.row).toBe(4); // header row 1, data rows 2-4, Broadway = row 4
    expect(result.updatedCells).toBe(2);
    expect(mockBatchUpdate).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-id-abc',
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: 'Venues!C4', values: [['TOUR SCHEDULED']] },
          { range: 'Venues!L4', values: [['Tour Sunday 2026-05-17']] },
        ],
      },
    });
  });

  it('returns notFound=true when venue name is not in the column', async () => {
    mockGet.mockResolvedValue({ data: { values: VENUE_COL_DATA, range: 'Venues!B:B' } });

    const result = await writeSheetByVenueName({
      spreadsheetId: 'sheet-id-abc',
      tab: 'Venues',
      venueNameCol: 'B',
      venueName: 'Nonexistent Venue',
      updates: [{ col: 'C', value: 'LOCKED' }],
      serviceAccountPath,
    });

    expect(result.notFound).toBe(true);
    expect(result.row).toBe(-1);
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('does case-insensitive + trim matching', async () => {
    mockGet.mockResolvedValue({ data: { values: VENUE_COL_DATA, range: 'Venues!B:B' } });
    mockBatchUpdate.mockResolvedValue({ data: { totalUpdatedCells: 1 } });

    const result = await writeSheetByVenueName({
      spreadsheetId: 'sheet-id-abc',
      tab: 'Venues',
      venueNameCol: 'B',
      venueName: '  broadway hall  ',
      updates: [{ col: 'C', value: 'LOCKED' }],
      serviceAccountPath,
    });

    expect(result.notFound).toBe(false);
    expect(result.row).toBe(4);
  });

  it('throws when service account file does not exist', async () => {
    await expect(
      writeSheetByVenueName({
        spreadsheetId: 'sheet-id-abc',
        tab: 'Venues',
        venueNameCol: 'B',
        venueName: 'Broadway Hall',
        updates: [{ col: 'C', value: 'LOCKED' }],
        serviceAccountPath: join(tmpDir, 'nonexistent.json'),
      }),
    ).rejects.toThrow('Service account key not found');
  });
});
