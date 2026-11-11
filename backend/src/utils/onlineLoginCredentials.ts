/** First word of the customer name, first letter capital, rest lower, plus 321. */
export function onlinePasswordFromName(name: string): string {
  const first = String(name || '')
    .trim()
    .split(/\s+/)
    .find(Boolean) || 'Customer';
  const word = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return `${word}321`;
}

export function looksLikeCustomerCode(value: string): boolean {
  return /^C\d{4,6}$/i.test(String(value || '').trim());
}
