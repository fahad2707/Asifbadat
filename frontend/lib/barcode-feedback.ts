import toast from 'react-hot-toast';

/** Standard keyboard-wedge barcode feedback (no camera). */
export const BARCODE_NOT_FOUND = 'No product found for barcode';

let scanAudioCtx: AudioContext | null = null;

function getScanAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!scanAudioCtx) scanAudioCtx = new AC();
  return scanAudioCtx;
}

function playTone(frequency: number, durationSec: number, startAt = 0) {
  const ctx = getScanAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t = ctx.currentTime + startAt;
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + durationSec + 0.02);
}

/** Unlock audio after a click/focus so the next scan beep is not blocked by the browser. */
export function unlockScanAudio() {
  const ctx = getScanAudioContext();
  if (ctx?.state === 'suspended') void ctx.resume();
}

/** Short high beep so punchers who are not looking at the screen hear a successful scan. */
export function playScanSuccessBeep() {
  playTone(1400, 0.12);
}

/** Lower double beep for unknown barcode. */
export function playScanErrorBeep() {
  playTone(420, 0.1, 0);
  playTone(320, 0.14, 0.12);
}

export function toastBarcodeNotFound() {
  toast.error(BARCODE_NOT_FOUND);
}

/** Use only when a scan/lookup newly places a product on a line. */
export function toastProductAdded(name: string) {
  const label = (name || '').trim() || 'item';
  toast.success(`Product ${label} added`);
}

export function notifyBarcodeScanSuccess(name: string) {
  playScanSuccessBeep();
  toastProductAdded(name);
}

export function notifyBarcodeScanMiss() {
  playScanErrorBeep();
  toastBarcodeNotFound();
}
