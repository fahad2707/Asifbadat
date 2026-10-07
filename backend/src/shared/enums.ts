/**
 * Shared enums for Distribution POS / ERP
 */

export const CreditMemoType = {
  VENDOR: 'VENDOR',
  CUSTOMER: 'CUSTOMER',
} as const;
export type CreditMemoType = (typeof CreditMemoType)[keyof typeof CreditMemoType];

export const CreditMemoReason = {
  DAMAGED: 'DAMAGED',
  RATE_DIFFERENCE: 'RATE_DIFFERENCE',
  RETURN: 'RETURN',
  SCHEME: 'SCHEME',
  OTHER: 'OTHER',
} as const;
export type CreditMemoReason = (typeof CreditMemoReason)[keyof typeof CreditMemoReason];

export const CreditMemoStatus = {
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  ADJUSTED: 'ADJUSTED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const;
export type CreditMemoStatus = (typeof CreditMemoStatus)[keyof typeof CreditMemoStatus];

export const ShipmentType = {
  GROUND: 'GROUND',
  GROUND_RG: 'GROUND_RG', // Return goods
} as const;
export type ShipmentType = (typeof ShipmentType)[keyof typeof ShipmentType];

export const ShipmentStatus = {
  PENDING: 'PENDING',
  PACKED: 'PACKED',
  DISPATCHED: 'DISPATCHED',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  RETURNED: 'RETURNED',
} as const;
export type ShipmentStatus = (typeof ShipmentStatus)[keyof typeof ShipmentStatus];

export const LedgerAccountType = {
  VENDOR: 'VENDOR',
  CUSTOMER: 'CUSTOMER',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  SALES_RETURN: 'SALES_RETURN',
  PURCHASE: 'PURCHASE',
  SALES: 'SALES',
  CASH: 'CASH',
  BANK: 'BANK',
  EXPENSE: 'EXPENSE',
  UPI: 'UPI',
  CARD: 'CARD',
} as const;
export type LedgerAccountType = (typeof LedgerAccountType)[keyof typeof LedgerAccountType];

export const LedgerReferenceType = {
  CREDIT_MEMO: 'CREDIT_MEMO',
  INVOICE: 'INVOICE',
  PAYMENT: 'PAYMENT',
  RECEIPT: 'RECEIPT',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  SHIPMENT: 'SHIPMENT',
  DEBIT_NOTE: 'DEBIT_NOTE',
  EXPENSE: 'EXPENSE',
} as const;
export type LedgerReferenceType = (typeof LedgerReferenceType)[keyof typeof LedgerReferenceType];

export const ExpensePaymentMode = {
  CASH: 'CASH',
  BANK: 'BANK',
  UPI: 'UPI',
  CARD: 'CARD',
} as const;
export type ExpensePaymentMode = (typeof ExpensePaymentMode)[keyof typeof ExpensePaymentMode];

export const ExpenseRecurrenceType = {
  NONE: 'NONE',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
} as const;
export type ExpenseRecurrenceType = (typeof ExpenseRecurrenceType)[keyof typeof ExpenseRecurrenceType];

export const ExpenseCategoryType = {
  FIXED: 'FIXED',
  VARIABLE: 'VARIABLE',
} as const;
export type ExpenseCategoryType = (typeof ExpenseCategoryType)[keyof typeof ExpenseCategoryType];

export const StockMovementType = {
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  RETURN_IN: 'RETURN_IN',
  RETURN_OUT: 'RETURN_OUT',
  ADJUSTMENT: 'ADJUSTMENT',
  CREDIT_MEMO: 'CREDIT_MEMO',
  SHIPMENT_OUT: 'SHIPMENT_OUT',
  SHIPMENT_IN: 'SHIPMENT_IN',
  PHYSICAL_COUNT: 'PHYSICAL_COUNT',
} as const;
export type StockMovementType = (typeof StockMovementType)[keyof typeof StockMovementType];
