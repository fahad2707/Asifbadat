/**
 * Customer-facing auth visual system — black surfaces, restrained gold accents.
 * Matches checkout / wholesale storefront presentation. Visual only.
 */

export const customerAuthTheme = {
  bg: '#0C0C0E',
  panel: 'rgba(18, 18, 22, 0.92)',
  panelBorder: 'rgba(191, 160, 106, 0.28)',
  text: '#F5F1E8',
  textMuted: '#A8A29A',
  textSoft: '#78716C',
  gold: '#BFA06A',
  goldHover: '#D4B88A',
  goldDim: 'rgba(191, 160, 106, 0.12)',
  error: '#F87171',
  errorBg: 'rgba(248, 113, 113, 0.1)',
  success: '#86EFAC',
  successBg: 'rgba(134, 239, 172, 0.1)',
  inputBg: 'rgba(255, 255, 255, 0.04)',
  inputBorder: 'rgba(255, 255, 255, 0.12)',
  focusRing: '#BFA06A',
  serif: "'Playfair Display', Georgia, serif",
  body: "'Outfit', system-ui, sans-serif",
} as const;

export const customerAuthUi = {
  page: 'min-h-screen flex flex-col items-center justify-center px-4 py-10 sm:py-14',
  panel:
    'w-full max-w-md rounded-2xl border px-6 py-8 sm:px-9 sm:py-10 shadow-[0_24px_80px_rgba(0,0,0,0.45)]',
  brandMark: 'text-center mb-7',
  brandTitle: 'text-2xl sm:text-3xl tracking-tight text-[#F5F1E8]',
  brandAccent: 'text-[#BFA06A]',
  brandSub: 'mt-2 text-xs sm:text-sm tracking-[0.14em] uppercase text-[#A8A29A]',
  heading: 'text-xl sm:text-2xl font-medium text-[#F5F1E8] text-center',
  lead: 'mt-2 text-sm text-[#A8A29A] text-center leading-relaxed',
  label: 'block text-sm font-medium text-[#E7E5E4] mb-1.5',
  field:
    'w-full rounded-xl bg-white/[0.04] border border-white/15 px-4 py-2.5 text-sm text-[#F5F1E8] placeholder:text-[#78716C] focus:outline-none focus:ring-2 focus:ring-[#BFA06A]/70 focus:border-[#BFA06A]',
  fieldError: 'border-[#F87171]/60 focus:ring-[#F87171]/50 focus:border-[#F87171]',
  helper: 'mt-1.5 text-xs text-[#78716C]',
  errorText: 'text-sm text-[#F87171]',
  errorBox: 'rounded-xl border border-[#F87171]/30 bg-[rgba(248,113,113,0.1)] px-3 py-2.5 text-sm text-[#FECACA]',
  successBox:
    'rounded-xl border border-[#86EFAC]/30 bg-[rgba(134,239,172,0.1)] px-3 py-2.5 text-sm text-[#BBF7D0]',
  btnPrimary:
    'w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-[#0C0C0E] bg-[#BFA06A] hover:bg-[#D4B88A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#BFA06A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0C0C0E] disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
  btnGhost:
    'inline-flex items-center justify-center gap-1 text-sm text-[#BFA06A] hover:text-[#D4B88A] focus:outline-none focus-visible:underline',
  tabRow: 'flex rounded-full border border-white/10 bg-white/[0.03] p-1 mb-7',
  tab:
    'flex-1 rounded-full px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#BFA06A]',
  tabActive: 'bg-[#BFA06A] text-[#0C0C0E]',
  tabIdle: 'text-[#A8A29A] hover:text-[#F5F1E8]',
  linkRow: 'text-center text-sm text-[#A8A29A]',
  iconBtn:
    'absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg text-[#A8A29A] hover:text-[#F5F1E8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#BFA06A]',
} as const;
