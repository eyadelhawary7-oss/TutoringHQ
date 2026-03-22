'use client';

import dynamic from 'next/dynamic';

const ServiceWorkerRegistrar = dynamic(
  () => import('@/components/ServiceWorkerRegistrar'),
  { ssr: false }
);

export default function ServiceWorkerRegistrarWrapper() {
  return <ServiceWorkerRegistrar />;
}
