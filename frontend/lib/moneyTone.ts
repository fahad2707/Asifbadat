/** POS money color: collect/receive = green, give/owe = red, net by sign, else black. */
export const MONEY_IN_HEX = '#16A34A';
export const MONEY_OUT_HEX = '#DC2626';
export const MONEY_PLAIN_HEX = '#1A1A1A';

export const moneyIn = 'text-emerald-600';
export const moneyOut = 'text-red-600';
export const moneyPlain = 'text-black';

export function moneyNet(n: number): string {
  if (n > 0.005) return moneyIn;
  if (n < -0.005) return moneyOut;
  return moneyPlain;
}

export function moneyNetHex(n: number): string {
  if (n > 0.005) return MONEY_IN_HEX;
  if (n < -0.005) return MONEY_OUT_HEX;
  return MONEY_PLAIN_HEX;
}
