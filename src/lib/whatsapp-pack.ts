import type { WaPackBillingSummary } from '@/types/whatsapp-pack'

export const currentMonthStr = (): string => {
  const now = new Date()
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
    .toISOString()
    .split('T')[0]
}

export const maskPhone = (phone: string): string => `••••${phone.slice(-4)}`

export const deriveBillingSummary = (
  rows: Array<{ amount: number | string; status: string }>
): WaPackBillingSummary => {
  if (rows.length === 0) {
    return { totalAmount: 0, parentCount: 0, status: 'not_issued' }
  }
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0)
  const anyFailed = rows.some(r => r.status === 'failed')
  const allCharged = rows.every(r => r.status === 'charged')
  return {
    totalAmount,
    parentCount: rows.length,
    status: anyFailed ? 'failed' : allCharged ? 'charged' : 'pending',
  }
}
