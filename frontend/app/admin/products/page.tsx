import { ProductsAdminView, type ProductsAdminMode } from '@/components/admin/ProductsAdminView';

export default function ProductsIndexPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const view: ProductsAdminMode =
    searchParams.view === 'active' || searchParams.view === 'inactive' ? searchParams.view : 'all';
  return <ProductsAdminView initialView={view} />;
}
