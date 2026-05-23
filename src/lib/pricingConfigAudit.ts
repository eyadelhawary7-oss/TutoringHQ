/**
 * Audit-log payload builder for /api/admin/pricing-config PATCH.
 *
 * The prior shape (`{ changed_keys: [...] }`) recorded key names only, with
 * no before/after values , a destructive pricing change had no recoverable
 * trail. This builder produces `{ changes: [{ key, old, new }, ...], save_source }`
 * so the audit row contains everything needed to reconstruct or reverse a
 * change.
 *
 * Missing prior values (first write of a key) report `old: null`.
 */
export function buildPricingConfigAuditDetails(
  updates: ReadonlyArray<{ key: string; value: unknown }>,
  priorByKey: ReadonlyMap<string, unknown>,
  saveSource: string,
): { changes: Array<{ key: string; old: unknown; new: unknown }>; save_source: string } {
  return {
    changes: updates.map((u) => ({
      key: u.key,
      old: priorByKey.has(u.key) ? (priorByKey.get(u.key) ?? null) : null,
      new: u.value,
    })),
    save_source: saveSource,
  };
}
