import toast from 'react-hot-toast';

/** Invoice numbers look like QTN#003 — `#` in a download filename breaks the save in some browsers. */
export function safePdfFilename(name: string): string {
  const base = String(name || 'document').replace(/\.pdf$/i, '');
  const cleaned = base.replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${cleaned || 'document'}.pdf`;
}

/**
 * Normalise whatever axios handed us (Blob with responseType 'blob',
 * ArrayBuffer with 'arraybuffer', or a typed array) into raw bytes.
 * Blobs can only be read asynchronously, which is why these helpers are async.
 */
async function toUint8Array(data: BlobPart): Promise<Uint8Array> {
  if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return new Uint8Array(0);
}

function isPdfBytes(buf: Uint8Array): boolean {
  // "%PDF"
  return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

/** Surface the server's JSON error (if any) instead of a generic message. */
function reportNotPdf(buf: Uint8Array, fallback: string) {
  try {
    const text = new TextDecoder().decode(buf.slice(0, 500));
    const parsed = JSON.parse(text);
    toast.error(parsed?.error || fallback);
  } catch {
    toast.error(fallback);
  }
}

/** Axios headers can be string | number | boolean | string[]. */
function normalizeContentType(contentType?: unknown): string | undefined {
  if (contentType == null) return undefined;
  if (Array.isArray(contentType)) return String(contentType[0] ?? '');
  const text = String(contentType);
  return text || undefined;
}

function bytesToPdfBlob(buf: Uint8Array, contentType?: unknown): Blob {
  const type = normalizeContentType(contentType);
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Blob([copy], { type: type?.includes('pdf') ? type : 'application/pdf' });
}

/** Build a PDF Blob from validated bytes. */
export async function toPdfBlob(data: BlobPart, contentType?: unknown): Promise<Blob | null> {
  const buf = await toUint8Array(data);
  if (!isPdfBytes(buf)) return null;
  return bytesToPdfBlob(buf, contentType);
}

/** Download a PDF from an admin API response (validates the %PDF header first). */
export async function downloadPdfFromResponse(
  data: BlobPart,
  filename: string,
  contentType?: unknown
): Promise<boolean> {
  const buf = await toUint8Array(data);
  if (!isPdfBytes(buf)) {
    reportNotPdf(buf, 'Download failed — file is not a valid PDF');
    return false;
  }

  const blob = bytesToPdfBlob(buf, 'application/pdf');
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safePdfFilename(filename);
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke after the click has been processed; revoking synchronously can cancel the download in some browsers.
  setTimeout(() => window.URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Open the PDF in a new tab (for printing). */
export async function openPdfFromResponse(data: BlobPart, contentType?: unknown): Promise<boolean> {
  const buf = await toUint8Array(data);
  if (!isPdfBytes(buf)) {
    reportNotPdf(buf, 'Could not open PDF — invalid file');
    return false;
  }
  const blob = bytesToPdfBlob(buf, 'application/pdf');
  const url = window.URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    // Popup blocked — fall back to a download so the user still gets the file.
    const link = document.createElement('a');
    link.href = url;
    link.download = 'document.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  return true;
}
