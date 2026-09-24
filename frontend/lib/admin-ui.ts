/**
 * Shared admin visual conventions.
 *
 * Use these class strings on the admin shell and, later, on pages that
 * opt in. Do not treat this as a full design system.
 *
 * Surfaces: solid dark, subtle border, modest radius, no glass/glow.
 * Accent: existing teal. Danger: existing rose. No new color tokens.
 */

export const adminUi = {
  app: 'bg-[#0b0f17] text-slate-200',
  sidebar: 'bg-slate-950 border-r border-slate-800',
  header: 'bg-slate-950 border-b border-slate-800',
  workspace: 'bg-[#0e1320] text-slate-200',
  panel: 'bg-slate-900 border border-slate-800 rounded-md',
  overlay: 'bg-slate-950 border border-slate-800 rounded-md shadow-lg',

  pageTitle: 'text-xl font-semibold text-white tracking-tight',
  sectionTitle: 'text-sm font-semibold text-slate-200',
  body: 'text-sm text-slate-300',
  meta: 'text-xs text-slate-400',
  helper: 'text-xs text-slate-500',
  navGroup: 'text-xs font-semibold text-slate-500',

  btnPrimary:
    'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-teal-700 text-white text-xs font-medium hover:bg-teal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600',
  btnSecondary:
    'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-slate-900 text-slate-200 text-xs font-medium border border-slate-700 hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500',
  btnGhost:
    'inline-flex items-center gap-2 px-3 py-2 rounded-md text-slate-400 text-xs font-medium hover:text-white hover:bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500',
  btnDanger:
    'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md text-rose-300 text-xs font-medium border border-rose-500/30 hover:bg-rose-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500',
  btnIcon:
    'p-2 rounded-md border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500',

  input:
    'w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600',

  tableHead: 'bg-slate-950 text-xs font-semibold text-slate-400 border-b border-slate-800',
  tableCell: 'px-3 py-2.5 text-sm text-slate-200 border-b border-slate-800',
  tableRowHover: 'hover:bg-slate-900/60',

  badge: 'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border border-slate-700 text-slate-300',
} as const;

export function adminNavItemClass(active: boolean): string {
  return `block px-3 py-1.5 text-sm rounded-md ${
    active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-900'
  }`;
}

export function adminNavUtilityClass(active: boolean): string {
  return `flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
    active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-900'
  }`;
}
