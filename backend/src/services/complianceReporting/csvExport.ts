/**
 * Preview CSV. The first rows state that the file is not an official filing.
 */

export function toPreviewCsv(input: {
  title: string;
  periodLabel: string;
  generatedAt: string;
  blockers: string[];
  headers: string[];
  rows: Array<Array<string | number>>;
}): string {
  const preamble = [
    ['REPORT STATUS', 'PREVIEW — NOT AN OFFICIAL FILING'],
    ['FILING READY', 'no'],
    ['TITLE', input.title],
    ['PERIOD', input.periodLabel],
    ['GENERATED AT', input.generatedAt],
    ['BLOCKERS', input.blockers.join('; ')],
    [],
    input.headers,
    ...input.rows,
  ];
  return preamble
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}
