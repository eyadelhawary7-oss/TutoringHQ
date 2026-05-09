/** WhatsApp parent pack physical fulfillment (after centre approval). */

export const PACK_FULFILLMENT_PIPELINE = [
  'pending_approval',
  'approved',
  'in_production',
  'dispatched',
  'in_transit',
  'delivered',
  'issued',
] as const

export type PackFulfillmentPipelineStatus = (typeof PACK_FULFILLMENT_PIPELINE)[number]
export type PackFulfillmentStatus = PackFulfillmentPipelineStatus | 'cancelled'

export function packFulfillmentStepIndex(status: PackFulfillmentStatus): number {
  if (status === 'cancelled') return -1
  const i = PACK_FULFILLMENT_PIPELINE.indexOf(status as PackFulfillmentPipelineStatus)
  return i
}

export function nextPackFulfillmentStatus(
  current: PackFulfillmentStatus,
): PackFulfillmentPipelineStatus | null {
  if (current === 'cancelled') return null
  const i = packFulfillmentStepIndex(current)
  if (i < 0 || i >= PACK_FULFILLMENT_PIPELINE.length - 1) return null
  return PACK_FULFILLMENT_PIPELINE[i + 1]
}
