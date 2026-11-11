import nodemailer from 'nodemailer';

function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim());
}

export function isSmtpConfigured(): boolean {
  return smtpConfigured();
}

function createTransporter() {
  if (!smtpConfigured()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const t = createTransporter();
  if (!t) return;
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const link = `${base}/verify-email?token=${encodeURIComponent(token)}`;
  await t.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: 'Verify your email',
    text: `Verify your account: ${link}\nThis link expires in 24 hours.`,
    html: `<p>Verify your account:</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendOnlineAccessEmail(
  to: string,
  opts: { name?: string; username: string; password: string }
): Promise<boolean> {
  const t = createTransporter();
  if (!t) return false;
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const loginUrl = `${base}/login`;
  const who = opts.name ? `${opts.name}, ` : '';
  const text =
    `${who}your wholesale website login is ready.\n\n` +
    `Sign in at: ${loginUrl}\n` +
    `Username: ${opts.username}\n` +
    `Password: ${opts.password}\n\n` +
    `You can also sign in with this email if it is on your account. Please change your password after first login.`;
  await t.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: 'Your wholesale website login',
    text,
    html:
      `<p>${who}your wholesale website login is ready.</p>` +
      `<p>Sign in at <a href="${loginUrl}">${loginUrl}</a></p>` +
      `<p>Username: <strong>${opts.username}</strong><br/>Password: <strong>${opts.password}</strong></p>` +
      `<p>You can also sign in with this email if it is on your account. Please change your password after first login.</p>`,
  });
  return true;
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const t = createTransporter();
  if (!t) return;
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  await t.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: 'Reset your password',
    text: `Reset your password: ${link}\nThis link expires in 1 hour.`,
    html: `<p>Reset your password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour.</p>`,
  });
}
