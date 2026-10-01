import { redirect } from 'next/navigation';

export default function CreditMemosIndexPage() {
  redirect('/admin/credit-memos/customers');
}
