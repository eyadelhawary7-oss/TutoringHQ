-- Optional physical QR card ordering: per-center opt-in, OFF by default.
-- A center that wants cards turns it on; one that doesn't never sees the order
-- flow. The card-order code is NOT removed -- only its visibility is gated on
-- this flag (center dashboard /orders page + its nav item). Service-role routes
-- bypass RLS, so any gate that must bite them lives in the TS route layer.
--
-- Catalog reality (introspected against prod BEFORE writing -- Rule 146):
--   * public.centers had NO card-orders feature flag before this migration.
--   * No in-progress card orders need a backfill -- DEFAULT false is correct for
--     every existing center (confirmed with the product owner).

ALTER TABLE public.centers
  ADD COLUMN IF NOT EXISTS card_orders_enabled boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
