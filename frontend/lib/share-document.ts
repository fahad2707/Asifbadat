import { downloadPdfFromResponse, toPdfBlob } from '@/lib/download-pdf';

/**
 * Client-side helpers for sharing an invoice/quotation with a customer.
 * Nothing here touches the backend: the PDF is fetched through the existing
 * admin API and either handed to the OS share sheet (mobile) or downloaded
 * while WhatsApp opens with a prefilled message (desktop).
 */

export type ShareDocType = 'invoice' | 'quotation';

export interface ShareDocument {
  id: string;
  type: ShareDocType;
  number: string;
  customerName?: string | null;
  customerPhone?: string | null;
  total?: number | null;
}

/** Digits only; 10-digit numbers are assumed to be US and get a leading 1. */
export function normalizePhoneForWhatsApp(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

export function buildWhatsAppUrl(phone: string | null | undefined, text: string): string {
  const p = normalizePhoneForWhatsApp(phone);
  const encoded = encodeURIComponent(text);
  return p ? `https://wa.me/${p}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

export function docLabel(type: ShareDocType): string {
  return type === 'quotation' ? 'Quotation' : 'Invoice';
}

export function buildShareText(doc: ShareDocument): string {
  const label = docLabel(doc.type);
  const greeting = doc.customerName ? `Hello ${doc.customerName},` : 'Hello,';
  const amount =
    typeof doc.total === 'number' && Number.isFinite(doc.total)
      ? ` Total: $${doc.total.toFixed(2)}.`
      : '';
  return `${greeting}\n\nPlease find your ${label.toLowerCase()} ${doc.number} from Express Distributors Inc attached.${amount}\n\nReply here if you have any questions.\n\nThank you,\nExpress Distributors Inc`;
}

/**
 * mailto: link with subject/body prefilled. Used when we have no email on file
 * for the customer (so the server can't send it) — the admin picks the recipient
 * in their mail app and attaches the downloaded PDF.
 */
export function buildMailtoUrl(doc: ShareDocument, email?: string | null): string {
  const subject = `${docLabel(doc.type)} ${doc.number} from Express Distributors Inc`;
  const body = buildShareText(doc);
  return `mailto:${email ? encodeURIComponent(email) : ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Open the mail client with the message prefilled and download the PDF so it can be attached. */
export async function composeEmailWithPdf(doc: ShareDocument, fetchPdf: FetchPdf, email?: string | null): Promise<boolean> {
  // window.open keeps the admin page in place (location.href mailto: can unload the SPA).
  window.open(buildMailtoUrl(doc, email), '_blank', 'noopener,noreferrer');
  try {
    const res = await fetchPdf();
    return await downloadPdfFromResponse(res.data, pdfFilename(doc), res.contentType);
  } catch {
    return false;
  }
}

export function pdfFilename(doc: ShareDocument): string {
  return `${doc.type === 'quotation' ? 'quotation' : 'invoice'}-${doc.number.replace(/[^A-Za-z0-9]+/g, '-')}.pdf`;
}

type FetchPdf = () => Promise<{ data: BlobPart; contentType?: string | null }>;

function canShareFiles(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    const probe = new File([new Blob(['%PDF-'])], 'probe.pdf', { type: 'application/pdf' });
    return nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export type ShareOutcome = 'shared' | 'whatsapp-opened' | 'cancelled' | 'failed';

/**
 * Share a document on WhatsApp.
 * - Mobile / Safari with file sharing: opens the OS share sheet with the PDF attached.
 * - Desktop: opens WhatsApp (web/app) with the message prefilled and downloads the PDF
 *   so it can be attached in one drag.
 */
export async function shareDocumentOnWhatsApp(doc: ShareDocument, fetchPdf: FetchPdf): Promise<ShareOutcome> {
  const text = buildShareText(doc);
  const filename = pdfFilename(doc);

  if (canShareFiles()) {
    try {
      const res = await fetchPdf();
      const blob = await toPdfBlob(res.data, res.contentType);
      if (blob) {
        const file = new File([blob], filename, { type: 'application/pdf' });
        await (navigator as Navigator).share({ files: [file], title: `${docLabel(doc.type)} ${doc.number}`, text });
        return 'shared';
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return 'cancelled';
      // fall through to the WhatsApp-link path
    }
  }

  // Open WhatsApp synchronously (before any await) so popup blockers allow it.
  const win = window.open(buildWhatsAppUrl(doc.customerPhone, text), '_blank', 'noopener,noreferrer');
  try {
    const res = await fetchPdf();
    await downloadPdfFromResponse(res.data, filename, res.contentType);
  } catch {
    return win ? 'whatsapp-opened' : 'failed';
  }
  return win ? 'whatsapp-opened' : 'failed';
}
