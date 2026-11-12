import Customer from '../models/Customer';

/** Display IDs are C plus 5 digits (e.g. C48291). */
export function randomCustomerCode(): string {
  return 'C' + String(Math.floor(10000 + Math.random() * 90000));
}

export function fallbackCustomerCode(): string {
  return 'C' + String(Date.now() % 100000).padStart(5, '0');
}

export async function generateCustomerCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomCustomerCode();
    const exists = await Customer.findOne({ customer_code: code });
    if (!exists) return code;
  }
  return fallbackCustomerCode();
}
