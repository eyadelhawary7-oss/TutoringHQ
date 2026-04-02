export interface NotificationTypes {
  scan: boolean
  absence: boolean
  balance: boolean
  announcement: boolean
}

export interface PatchStudentBody {
  parent_pack_opted_in?: boolean
  notify_on_scan?: boolean
  notify_on_absence?: boolean
  notify_on_balance?: boolean
}

export interface WaPackBillingSummary {
  totalAmount: number
  parentCount: number
  status: 'charged' | 'pending' | 'failed' | 'not_issued'
}

export interface WaPackStudent {
  id: string
  name: string
  parent_phone: string
  parent_pack_opted_in: boolean
  notify_on_scan: boolean
  notify_on_absence: boolean
  notify_on_balance: boolean
  parent_consent_given: boolean
}

export interface WaPackCenter {
  id: string
  name: string
  plan: string
  phone: string | null
  parent_pack_enabled: boolean
  parent_pack_active_parents: number
  announcement_balance?: number | null
  billing: WaPackBillingSummary
  pack_request_status: string
  pack_requested_at: string | null
  pack_rejection_reason: string | null
  pack_pending_balance: number
  pack_months_without_invoice: number
  pack_custom_invoice_minimum: number | null
}
