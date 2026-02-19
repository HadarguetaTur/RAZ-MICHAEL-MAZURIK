/**
 * Generic CSV export utility with Hebrew (UTF-8 BOM) support.
 */

interface CsvHeader {
  key: string;
  label: string;
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate a CSV string and trigger a browser download.
 *
 * @param filename  - Name for the downloaded file (should end with `.csv`).
 * @param headers   - Column definitions: `key` is the property path in each data
 *                    row, `label` is the human-readable column header.
 * @param data      - Array of objects to export.
 */
export function exportToCsv(
  filename: string,
  headers: CsvHeader[],
  data: Record<string, any>[],
): void {
  const headerRow = headers.map(h => escapeCsvValue(h.label)).join(',');

  const rows = data.map(row =>
    headers.map(h => escapeCsvValue(row[h.key])).join(','),
  );

  // UTF-8 BOM so Excel opens Hebrew text correctly
  const BOM = '\uFEFF';
  const csvContent = BOM + [headerRow, ...rows].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
