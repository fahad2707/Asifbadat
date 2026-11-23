export const STATEMENT_PERIODS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last week' },
  { id: '2weeks', label: 'Last 2 weeks' },
  { id: 'month', label: 'Last month' },
  { id: '2months', label: 'Last 2 months' },
  { id: '3months', label: 'Last 3 months' },
  { id: '6months', label: 'Last 6 months' },
  { id: '12months', label: 'Last 12 months' },
  { id: 'year', label: 'Last year' },
] as const;

export type StatementPeriod = (typeof STATEMENT_PERIODS)[number]['id'];
