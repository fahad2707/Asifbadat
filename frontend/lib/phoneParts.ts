/** Longer codes first so +880 matches before +1-style prefixes. */
const CALLING_CODES = ['+880', '+971', '+44', '+61', '+81', '+49', '+33', '+91', '+1'];

export const DEFAULT_CALLING_CODE = '+1';

export function splitPhone(phone: string): { callingCode: string; nationalNumber: string } {
  const raw = String(phone || '').trim();
  if (!raw) return { callingCode: DEFAULT_CALLING_CODE, nationalNumber: '' };

  const compact = raw.replace(/\s+/g, '');
  const withPlus = compact.startsWith('+') ? compact : compact.startsWith('00') ? `+${compact.slice(2)}` : compact;

  if (withPlus.startsWith('+')) {
    const known = CALLING_CODES.find((code) => withPlus.startsWith(code));
    if (known) {
      return { callingCode: known, nationalNumber: withPlus.slice(known.length).replace(/\D/g, '') };
    }
    const m = withPlus.match(/^\+(\d{1,3})(\d*)$/);
    if (m) {
      return { callingCode: `+${m[1]}`, nationalNumber: m[2] };
    }
  }

  return { callingCode: DEFAULT_CALLING_CODE, nationalNumber: raw.replace(/\D/g, '') };
}

export function joinPhone(callingCode: string, nationalNumber: string): string {
  const code = String(callingCode || DEFAULT_CALLING_CODE).trim() || DEFAULT_CALLING_CODE;
  const normalizedCode = code.startsWith('+') ? code : `+${code.replace(/\D/g, '')}`;
  const number = String(nationalNumber || '').replace(/\D/g, '');
  if (!number) return '';
  return `${normalizedCode} ${number}`;
}

export function phoneDigitsForWhatsApp(phone: string): string {
  return String(phone || '').replace(/\D/g, '');
}
