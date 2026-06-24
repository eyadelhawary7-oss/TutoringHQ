'use client';

import { CustomerInvoicesView } from '@/components/billing/CustomerInvoicesView';

/**
 * Teacher billing surface — full parity with the center /pay page. Renders the
 * SAME shared CustomerInvoicesView template against teacher-scoped endpoints, so
 * a wallet-paying teacher gets a real invoice to see and pay against, and any
 * future invoice redesign applies to centers and teachers together.
 *
 * Reachable while the teacher is in the locked / free-tier state (the underlying
 * endpoints use requireTeacherAuth, NOT the private-access gate), so a lapsed
 * teacher can still pay here to restore her private engine.
 */
export default function TeacherPayPage() {
  return (
    <CustomerInvoicesView
      endpoints={{
        invoices: '/api/teacher/billing/customer-invoices',
        pay: (id) => `/api/teacher/invoices/${id}/pay`,
        pdf: (id) => `/api/teacher/invoices/${id}/pdf`,
        statusEndpoint: '/api/teacher/paymob/invoice-status',
      }}
    />
  );
}
