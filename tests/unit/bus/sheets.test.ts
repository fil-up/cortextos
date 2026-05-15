import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockUpdate = vi.fn();

vi.mock('googleapis', () => {
  class MockGoogleAuth {
    constructor(_opts: unknown) {}
  }
  return {
    google: {
      auth: { GoogleAuth: MockGoogleAuth },
      sheets: vi.fn().mockReturnValue({
        spreadsheets: { values: { update: mockUpdate } },
      }),
    },
  };
});

const { writeSheet } = await import('../../../src/bus/sheets.js');

let tmpDir: string;
let serviceAccountPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cortextos-sheets-test-'));
  serviceAccountPath = join(tmpDir, 'service-account.json');
  writeFileSync(serviceAccountPath, JSON.stringify({ type: 'service_account' }));
  mockUpdate.mockReset();
});

describe('writeSheet', () => {
  it('calls spreadsheets.values.update with correct params and returns cell count', async () => {
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

  it('defaults updatedCells to 0 and updatedRange to input range when API returns undefined', async () => {
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
