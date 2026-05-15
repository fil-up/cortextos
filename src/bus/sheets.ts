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

export async function writeSheet(opts: WriteSheetOptions): Promise<WriteSheetResult> {
  if (!existsSync(opts.serviceAccountPath)) {
    throw new Error(`Service account key not found: ${opts.serviceAccountPath}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: opts.serviceAccountPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

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
