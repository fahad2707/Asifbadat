/**
 * QuickBooks Online–matched admin visual system.
 * White chrome, slim icon rail, black primary actions, colored money bars.
 * Visual only — pages must not change financial behavior.
 */

export const adminTokens = {
  bg: '#FFFFFF',
  surface: '#FFFFFF',
  text: '#1A1A1A',
  textSecondary: '#6B6C72',
  textMuted: '#8D9096',
  textButton: '#393A3D',
  border: '#E3E5E8',
  borderStrong: '#C7C7C7',
  hover: '#F4F5F8',
  brand: '#000000',
  brandHover: '#2C2C2C',
  success: '#2CA01C',
  successFg: '#0B6B0B',
  successBg: '#E5F6E3',
  warning: '#D97008',
  warningFg: '#8A4500',
  warningBg: '#FFF4E5',
  error: '#C81916',
  errorFg: '#8A100E',
  errorBg: '#FDECEC',
  info: '#0077C5',
  infoBg: '#E6F4FB',
  barTeal: '#2BB3C0',
  barOrange: '#F5A623',
  barGreen: '#2CA01C',
  sidebar: '#FFFFFF',
  header: '#FFFFFF',
  navSelected: '#000000',
} as const;

export const adminUi = {
  app: 'admin-app bg-white text-[#1A1A1A]',
  sidebar: 'bg-white border-r border-[#E3E5E8]',
  header: 'bg-white border-b border-[#E3E5E8]',
  workspace: 'admin-workspace bg-white text-[#1A1A1A]',
  panel: 'bg-white border border-[#E3E5E8] rounded-md',
  overlay: 'bg-white border border-[#E3E5E8] rounded-md shadow-lg',
  modalBackdrop: 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(26,26,26,0.45)]',
  modal: 'bg-white border border-[#E3E5E8] rounded-md text-[#1A1A1A] max-h-[90vh] overflow-y-auto',

  pageTitle: 'text-[28px] font-normal text-[#1A1A1A] tracking-tight',
  sectionTitle: 'text-base font-medium text-[#1A1A1A]',
  body: 'text-sm font-normal text-[#1A1A1A]',
  meta: 'text-xs font-normal text-[#6B6C72]',
  helper: 'text-xs font-normal text-[#8D9096]',
  navGroup: 'text-sm font-semibold text-[#1A1A1A]',
  navSection: 'text-[11px] font-medium text-[#6B6C72]',
  metric: 'text-[28px] font-normal text-[#1A1A1A] tabular-nums',
  label: 'text-xs font-medium text-[#6B6C72]',

  btnPrimary:
    'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-black text-white text-sm font-medium hover:bg-[#2C2C2C] focus:outline-none focus-visible:ring-2 focus-visible:ring-black',
  btnSecondary:
    'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-white text-[#393A3D] text-sm font-medium border border-[#C7C7C7] hover:bg-[#F4F5F8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C7C7C7]',
  btnGhost:
    'inline-flex items-center gap-2 px-3 py-2 rounded-md text-[#6B6C72] text-sm font-medium hover:text-[#1A1A1A] hover:bg-[#F4F5F8] focus:outline-none',
  btnDanger:
    'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full bg-[#C81916] text-white text-sm font-medium hover:bg-[#8A100E] focus:outline-none',
  btnIcon:
    'p-2 rounded-full text-[#6B6C72] hover:text-[#1A1A1A] hover:bg-[#F4F5F8] focus:outline-none',

  input:
    'w-full bg-[#F4F5F8] border-0 rounded-full px-3 py-2 text-sm text-[#1A1A1A] placeholder-[#8D9096] focus:outline-none focus:ring-2 focus:ring-[#0077C5]',
  field:
    'w-full bg-white border border-[#C7C7C7] rounded-md px-3 py-2 text-sm text-[#1A1A1A] placeholder-[#8D9096] focus:outline-none focus:ring-2 focus:ring-[#0077C5] focus:border-[#0077C5]',

  tableHead: 'bg-[#FAFAFA] text-[11px] font-semibold text-[#6B6C72] uppercase border-b border-[#E3E5E8]',
  tableCell: 'px-3 py-3 text-sm text-[#1A1A1A] border-b border-[#E3E5E8]',
  tableRowHover: 'hover:bg-[#F4F5F8]',

  badge: 'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#F4F5F8] text-[#393A3D]',
  badgePaid: 'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#E5F6E3] text-[#0B6B0B]',
  badgeUnpaid: 'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#FFF4E5] text-[#8A4500]',
  badgeOverdue: 'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium text-[#D97008]',
  badgeDraft: 'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#F4F5F8] text-[#393A3D]',

  icon: 'text-[#6B6C72]',
  iconBrand: 'text-[#1A1A1A]',
} as const;

export function adminNavItemClass(active: boolean): string {
  return `block px-3 py-1.5 text-[12px] font-normal rounded-md ${
    active ? 'bg-[#F4F5F8] text-[#1A1A1A]' : 'text-[#6B6C72] hover:bg-[#F4F5F8] hover:text-[#1A1A1A]'
  }`;
}

export function adminNavUtilityClass(active: boolean): string {
  return `flex items-center gap-3 px-3 py-2 rounded-md text-[12px] font-normal ${
    active ? 'bg-[#F4F5F8] text-[#1A1A1A]' : 'text-[#6B6C72] hover:bg-[#F4F5F8] hover:text-[#1A1A1A]'
  }`;
}

export function adminRailBtnClass(active: boolean): string {
  return `w-full text-left px-3 py-2 rounded-md text-sm ${
    active ? 'bg-[#F4F5F8] text-[#1A1A1A] font-medium' : 'text-[#393A3D] hover:bg-[#F4F5F8]'
  }`;
}
