'use client';

import { CustomerInvoicesView } from '@/components/billing/CustomerInvoicesView';

/**
 * Center billing surface (Phase 3). Thin wrapper over the shared
 * CustomerInvoicesView — the same template teachers use at /teacher/pay, so a
 * future invoice redesign lands on both at once.
 */
export default function CustomerInvoicesPage() {
  return (
    <CustomerInvoicesView
      endpoints={{
        invoices: '/api/billing/customer-invoices',
        pay: (id) => `/api/invoices/${id}/pay`,
        pdf: (id) => `/api/invoices/${id}/pdf`,
      }}
    />
  );
}
