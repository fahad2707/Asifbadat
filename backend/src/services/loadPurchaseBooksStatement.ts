import CreditMemo from '../modules/credit-memo/models/CreditMemo';
import PurchaseOrder from '../models/PurchaseOrder';
import {
  buildPurchaseBooksStatement,
  statementDayKey,
  statementWindow,
  type PurchaseOrderBook,
  type VendorCreditBook,
} from './booksStatements';

function party(value: any) {
  return {
    vendorId: value?._id ? String(value._id) : '',
    vendorName: value?.name || '',
    supplierCode: value?.supplier_id || '',
    contact: value?.contact_name || '',
    phone: value?.phone || '',
    terms: value?.payment_terms || '',
  };
}

export async function purchaseBooksStatement(period: string) {
  const window = statementWindow(period);
  if (!window) return null;
  const [orders, memos] = await Promise.all([
    PurchaseOrder.find({
      $or: [{ created_at: { $lte: window.end } }, { 'payments.payment_date': { $lte: window.end } }],
    })
      .populate('vendor_id', 'name supplier_id contact_name phone payment_terms')
      .lean(),
    CreditMemo.find({ type: 'VENDOR', created_at: { $lte: window.end } })
      .populate('vendor_id', 'name supplier_id contact_name phone payment_terms')
      .populate('reference_purchase_order_id', 'po_number')
      .lean(),
  ]);

  const purchaseOrders: PurchaseOrderBook[] = (orders as any[]).map((po) => {
    const vendor = party(po.vendor_id);
    return {
      id: String(po._id),
      number: po.po_number || '',
      ...vendor,
      status: String(po.status || ''),
      createdAt: new Date(po.created_at || 0),
      subtotal: Number(po.subtotal) || 0,
      tax: Number(po.tax_amount) || 0,
      total: Number(po.total_amount) || 0,
      items: (po.items || []).map((item: any) => ({
        name: item.product_name || '',
        ordered: Number(item.quantity_ordered) || 0,
        received: Number(item.quantity_received) || 0,
        unitCost: Number(item.unit_cost) || 0,
        subtotal: Number(item.subtotal) || 0,
      })),
      payments: (po.payments || [])
        .filter((payment: any) => payment?.payment_date)
        .map((payment: any) => ({
          amount: Number(payment.amount) || 0,
          at: new Date(payment.payment_date),
          method: String(payment.payment_method || ''),
          reference: String(payment.reference || ''),
        })),
    };
  });

  const credits: VendorCreditBook[] = (memos as any[]).map((memo) => {
    const vendor = party(memo.vendor_id);
    const items = (memo.items || []).map((item: any) => ({
      name: item.product_name || '',
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unit_price) || 0,
      total: Number(item.total) || 0,
    }));
    return {
      number: memo.credit_memo_number || '',
      ...vendor,
      poNumber: memo.reference_purchase_order_id?.po_number || '',
      reason: String(memo.reason || '').replace(/_/g, ' '),
      status: String(memo.status || ''),
      at: new Date(memo.created_at || 0),
      merchandise: Number(memo.subtotal) || items.reduce((sum: number, item: { total: number }) => sum + item.total, 0),
      tax: Number(memo.tax_amount) || 0,
      total: Number(memo.total_amount) || 0,
      items,
    };
  });

  return {
    period,
    ...buildPurchaseBooksStatement(purchaseOrders, credits, window.start, window.end),
    generated_on: statementDayKey(new Date()),
  };
}
