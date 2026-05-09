import OrderDetailClient from './OrderDetailClient';

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const id = typeof orderId === 'string' ? orderId.trim() : '';
  return <OrderDetailClient orderId={id} />;
}
