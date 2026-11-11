import { redirect } from 'next/navigation';

export default function InactiveProductsPage() {
  redirect('/admin/products?view=inactive');
}
