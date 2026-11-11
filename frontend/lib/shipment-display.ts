import { adminUi } from '@/lib/admin-ui';

export function shipmentTypeLabel(type?: string) {
  if (type === 'GROUND_RG') return 'Return';
  if (type === 'GROUND') return 'Outbound';
  return type || 'Shipment';
}

export function shipmentStatusLabel(status?: string) {
  if (status === 'PACKED' || status === 'PENDING') return 'Ready to ship';
  if (status === 'IN_TRANSIT' || status === 'DISPATCHED') return 'Out for delivery';
  if (status === 'DELIVERED') return 'Delivered';
  if (status === 'RETURNED') return 'Return received';
  if (status === 'FAILED') return 'Failed';
  return status || '—';
}

export function shipmentTypeBadgeClass(type?: string) {
  if (type === 'GROUND_RG') return 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FFF4E5] text-[#8A4500]';
  return 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#E6F4FB] text-[#0077C5]';
}

export function shipmentStatusBadgeClass(status?: string) {
  if (status === 'DELIVERED' || status === 'RETURNED') return adminUi.badgePaid;
  if (status === 'FAILED') return adminUi.badgeUnpaid;
  if (status === 'IN_TRANSIT' || status === 'DISPATCHED') {
    return 'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#E6F4FB] text-[#0077C5]';
  }
  return adminUi.badge;
}

export function formatShipmentDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
