import { redirect } from 'next/navigation';

export default function ActiveProductsPage() {
  redirect('/admin/products?view=active');
}
