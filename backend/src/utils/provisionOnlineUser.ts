import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import Customer from '../models/Customer';
import User from '../models/User';
import { generateCustomerCode } from './customerCode';
import { onlinePasswordFromName } from './onlineLoginCredentials';
import { sendOnlineAccessEmail } from './mail';

const BCRYPT_ROUNDS = 12;

export type ProvisionedLogin = {
  username: string;
  password: string;
  emailed: boolean;
  email: string | null;
};

/** Create a website user for a CRM customer (idempotent if user_id already set). */
export async function provisionOnlineLogin(customer: any): Promise<ProvisionedLogin | null> {
  if (customer.user_id) return null;

  if (!customer.customer_code) {
    customer.customer_code = await generateCustomerCode();
  }

  const password = onlinePasswordFromName(String(customer.name || ''));
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let email: string | undefined = String(customer.email || '').trim().toLowerCase() || undefined;
  if (email) {
    const emailTaken = await User.findOne({
      email: { $regex: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });
    if (emailTaken) email = undefined;
  }

  const phoneRaw = String(customer.phone || '').trim();
  let phone = phoneRaw || undefined;
  if (phone) {
    const phoneTaken = await User.findOne({ phone });
    if (phoneTaken) phone = undefined;
  }
  if (!phone) {
    phone = `acct:cust:${crypto.createHash('sha256').update(String(customer._id)).digest('hex').slice(0, 20)}`;
  }

  const user = await User.create({
    name: customer.name,
    ...(email ? { email } : {}),
    phone,
    password_hash,
    email_verified: true,
  });
  customer.user_id = user._id;

  let emailed = false;
  const mailTo = String(customer.email || '').trim();
  if (mailTo) {
    try {
      emailed = await sendOnlineAccessEmail(mailTo, {
        name: customer.name,
        username: String(customer.customer_code),
        password,
      });
    } catch (err) {
      console.error('Online access email failed:', err);
    }
  }

  return {
    username: String(customer.customer_code),
    password,
    emailed,
    email: mailTo || null,
  };
}
