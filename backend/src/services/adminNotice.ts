import AdminNotice, { type AdminNoticeKind } from '../models/AdminNotice';

export async function recordAdminNotice(input: {
  kind: AdminNoticeKind;
  title: string;
  body?: string;
  href: string;
  ref?: string;
}): Promise<void> {
  try {
    await AdminNotice.create({
      kind: input.kind,
      title: String(input.title || '').trim() || 'Update',
      body: String(input.body || '').trim(),
      href: String(input.href || '/admin/dashboard'),
      ref: input.ref ? String(input.ref) : undefined,
    });
  } catch (error) {
    console.error('Admin notice was not stored:', error);
  }
}

export function serializeAdminNotice(doc: {
  _id: { toString: () => string };
  kind?: string;
  title?: string;
  body?: string;
  href?: string;
  ref?: string;
  created_at?: Date;
}) {
  return {
    id: String(doc._id),
    kind: String(doc.kind || ''),
    title: String(doc.title || ''),
    body: String(doc.body || ''),
    href: String(doc.href || '/admin/dashboard'),
    ref: doc.ref ? String(doc.ref) : '',
    created_at: doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString(),
  };
}
