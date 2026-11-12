/** First word of the customer name, first letter capital, rest lower, plus 321. */
export function onlinePasswordFromName(name: string): string {
  const first = String(name || '')
    .trim()
    .split(/\s+/)
    .find(Boolean) || 'Customer';
  const word = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return `${word}321`;
}

export function normalizeLoginIdentifier(value: string): string {
  return String(value || '').trim().replace(/\s+/g, '');
}

export function looksLikeCustomerCode(value: string): boolean {
  return /^C\d{4,6}$/i.test(normalizeLoginIdentifier(value));
}

export function pickLoginIdentifier(body: {
  email?: unknown;
  username?: unknown;
  customer_code?: unknown;
  phone?: unknown;
}): string {
  const fromCode = normalizeLoginIdentifier(String(body.customer_code ?? ''));
  if (fromCode) return fromCode;
  const fromUser = normalizeLoginIdentifier(String(body.username ?? ''));
  if (fromUser) return fromUser;
  const fromEmail = normalizeLoginIdentifier(String(body.email ?? ''));
  if (fromEmail) return fromEmail;
  return normalizeLoginIdentifier(String(body.phone ?? ''));
}
