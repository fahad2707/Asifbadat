import mongoose from 'mongoose';
import RFQ from '../models/RFQ';

/** When a quotation becomes an invoice, the linked quote request moves to closed. */
export async function closeRfqsForConvertedQuotation(
  quotationId: mongoose.Types.ObjectId | string,
  invoiceNumber: string,
  quotationNumber?: string | null
): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  await RFQ.updateMany(
    { quotation_id: quotationId, status: { $ne: 'cancelled' } },
    {
      $set: {
        status: 'closed',
        invoice_number: invoiceNumber,
        ...(quotationNumber ? { quotation_number: quotationNumber } : {}),
      },
    }
  );
}
