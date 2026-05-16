import { google } from 'googleapis';
import { existsSync } from 'fs';

export interface WriteSheetOptions {
  spreadsheetId: string;
  range: string;
  values: string[][];
  serviceAccountPath: string;
}

export interface WriteSheetResult {
  updatedCells: number;
  updatedRange: string;
}

export interface ReadSheetOptions {
  spreadsheetId: string;
  range: string;
  serviceAccountPath: string;
}

export interface ReadSheetResult {
  values: string[][];
  range: string;
}

export interface VenueFieldUpdate {
  col: string;   // A1 column letter, e.g. "C" for Status
  value: string;
}

export interface WriteSheetByVenueNameOptions {
  spreadsheetId: string;
  venueNameCol: string;     // column letter containing venue names, default "B"
  tab: string;              // sheet tab name, e.g. "Venues"
  venueName: string;        // exact string to match in venueNameCol
  updates: VenueFieldUpdate[];
  serviceAccountPath: string;
}

export interface WriteSheetByVenueNameResult {
  row: number;
  updatedCells: number;
  notFound: boolean;
}

function buildAuth(serviceAccountPath: string) {
  if (!existsSync(serviceAccountPath)) {
    throw new Error(`Service account key not found: ${serviceAccountPath}`);
  }
  return new google.auth.GoogleAuth({
    keyFile: serviceAccountPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

export async function readSheet(opts: ReadSheetOptions): Promise<ReadSheetResult> {
  const auth = buildAuth(opts.serviceAccountPath);
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: opts.spreadsheetId,
    range: opts.range,
  });

  return {
    values: (response.data.values ?? []) as string[][],
    range: response.data.range ?? opts.range,
  };
}

export async function writeSheet(opts: WriteSheetOptions): Promise<WriteSheetResult> {
  const auth = buildAuth(opts.serviceAccountPath);
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.update({
    spreadsheetId: opts.spreadsheetId,
    range: opts.range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: opts.values },
  });

  return {
    updatedCells: response.data.updatedCells ?? 0,
    updatedRange: response.data.updatedRange ?? opts.range,
  };
}

export async function writeSheetByVenueName(
  opts: WriteSheetByVenueNameOptions,
): Promise<WriteSheetByVenueNameResult> {
  const col = opts.venueNameCol ?? 'B';
  const lookupRange = `${opts.tab}!${col}:${col}`;

  // Read the venue name column to resolve the row
  const read = await readSheet({
    spreadsheetId: opts.spreadsheetId,
    range: lookupRange,
    serviceAccountPath: opts.serviceAccountPath,
  });

  const rowIndex = read.values.findIndex(
    (row) => row[0]?.trim().toLowerCase() === opts.venueName.trim().toLowerCase(),
  );

  if (rowIndex === -1) {
    return { row: -1, updatedCells: 0, notFound: true };
  }

  const sheetRow = rowIndex + 1; // 1-indexed

  // Build batch update data — one entry per field update
  const data = opts.updates.map(({ col: fieldCol, value }) => ({
    range: `${opts.tab}!${fieldCol}${sheetRow}`,
    values: [[value]],
  }));

  const auth = buildAuth(opts.serviceAccountPath);
  const sheets = google.sheets({ version: 'v4', auth });

  const response = await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: opts.spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data,
    },
  });

  const updatedCells = response.data.totalUpdatedCells ?? 0;
  return { row: sheetRow, updatedCells, notFound: false };
}
