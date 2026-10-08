import toast from 'react-hot-toast';

/** Standard keyboard-wedge barcode feedback (no camera). */
export const BARCODE_NOT_FOUND = 'No product found for barcode';

export function toastBarcodeNotFound() {
  toast.error(BARCODE_NOT_FOUND);
}

/** Use only when a scan/lookup newly places a product on a line. */
export function toastProductAdded(name: string) {
  const label = (name || '').trim() || 'item';
  toast.success(`Product ${label} added`);
}
