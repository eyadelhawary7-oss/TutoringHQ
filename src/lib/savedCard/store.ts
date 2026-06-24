/**
 * Saved-Card Engine — Supabase (service-role) implementation of SavedCardStore.
 *
 * Thin persistence adapter over the saved_card_* tables. Mapped to/from the
 * camelCase record shapes so the engine logic (saveCard/autoCharge) stays
 * DB-agnostic and unit-testable with an in-memory fake. All access is via the
 * service-role client (supabase-admin); the tables are RLS-locked otherwise.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  OwnerRef,
  SavedCardStore,
  SavedCardRecord,
  ConsentRecord,
  ChargeIntentRecord,
  ChargeIntentStatus,
} from './types';

type Row = Record<string, unknown>;

function mapConsent(r: Row): ConsentRecord {
  return {
    id: String(r.id),
    ownerType: r.owner_type as ConsentRecord['ownerType'],
    ownerId: String(r.owner_id),
    consentVersion: String(r.consent_version),
    consentText: String(r.consent_text),
    locale: r.locale as ConsentRecord['locale'],
    agreedToStore: r.agreed_to_store === true,
    agreedToAutoCharge: r.agreed_to_auto_charge === true,
    userId: (r.user_id as string | null) ?? null,
    createdAt: (r.created_at as string | null) ?? undefined,
  };
}

function mapCard(r: Row): SavedCardRecord {
  return {
    id: String(r.id),
    ownerType: r.owner_type as SavedCardRecord['ownerType'],
    ownerId: String(r.owner_id),
    paymobToken: String(r.paymob_token),
    last4: String(r.card_last4),
    brand: (r.card_brand as string | null) ?? null,
    expMonth: Number(r.exp_month),
    expYear: Number(r.exp_year),
    storedCredentialRef: (r.stored_credential_ref as string | null) ?? null,
    initialTransactionRef: (r.initial_transaction_ref as string | null) ?? null,
    status: r.status as SavedCardRecord['status'],
    consentId: (r.consent_id as string | null) ?? null,
    validityCheckedAt: (r.validity_checked_at as string | null) ?? null,
  };
}

function mapIntent(r: Row): ChargeIntentRecord {
  return {
    id: String(r.id),
    idempotencyKey: String(r.idempotency_key),
    savedCardId: String(r.saved_card_id),
    ownerType: r.owner_type as ChargeIntentRecord['ownerType'],
    ownerId: String(r.owner_id),
    invoiceId: (r.invoice_id as string | null) ?? null,
    billingPeriod: (r.billing_period as string | null) ?? null,
    amount: Number(r.amount),
    currency: String(r.currency),
    requestFingerprint: String(r.request_fingerprint),
    status: r.status as ChargeIntentStatus,
    is3dSecure: r.is_3d_secure === true,
    attemptCount: Number(r.attempt_count ?? 0),
    paymobOrderId: (r.paymob_order_id as string | null) ?? null,
    paymobTransactionId: (r.paymob_transaction_id as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
  };
}

export function createSupabaseSavedCardStore(supabase: SupabaseClient): SavedCardStore {
  return {
    async getActiveCard(owner: OwnerRef) {
      const { data } = await supabase
        .from('saved_cards')
        .select('*')
        .eq('owner_type', owner.ownerType)
        .eq('owner_id', owner.ownerId)
        .eq('status', 'active')
        .maybeSingle();
      return data ? mapCard(data as Row) : null;
    },

    async insertConsent(params) {
      const { data, error } = await supabase
        .from('saved_card_consents')
        .insert({
          owner_type: params.owner.ownerType,
          owner_id: params.owner.ownerId,
          consent_version: params.consentVersion,
          consent_text: params.consentText,
          locale: params.locale,
          agreed_to_store: params.agreedToStore,
          agreed_to_auto_charge: params.agreedToAutoCharge,
          user_id: params.userId ?? null,
          ip_address: params.ipAddress ?? null,
          user_agent: params.userAgent ?? null,
        })
        .select('*')
        .single();
      if (error) throw new Error(`insertConsent failed: ${error.message}`);
      return mapConsent(data as Row);
    },

    async getConsentById(id: string) {
      const { data } = await supabase
        .from('saved_card_consents')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      return data ? mapConsent(data as Row) : null;
    },

    async getLatestConsent(owner: OwnerRef) {
      const { data } = await supabase
        .from('saved_card_consents')
        .select('*')
        .eq('owner_type', owner.ownerType)
        .eq('owner_id', owner.ownerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? mapConsent(data as Row) : null;
    },

    async revokeActiveCards(owner: OwnerRef) {
      await supabase
        .from('saved_cards')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('owner_type', owner.ownerType)
        .eq('owner_id', owner.ownerId)
        .eq('status', 'active');
    },

    async insertCard(params) {
      const { data, error } = await supabase
        .from('saved_cards')
        .insert({
          owner_type: params.owner.ownerType,
          owner_id: params.owner.ownerId,
          paymob_token: params.card.token,
          card_last4: params.card.last4,
          card_brand: params.card.brand ?? null,
          exp_month: params.card.expMonth,
          exp_year: params.card.expYear,
          stored_credential_ref: params.card.storedCredentialRef ?? null,
          initial_transaction_ref: params.card.initialTransactionRef ?? null,
          status: 'active',
          consent_id: params.consentId,
          validity_checked_at: params.validityCheckedAt,
        })
        .select('*')
        .single();
      if (error) throw new Error(`insertCard failed: ${error.message}`);
      return mapCard(data as Row);
    },

    async updateCardStatus(id, status, extra) {
      await supabase
        .from('saved_cards')
        .update({ status, revoked_at: extra?.revokedAt ?? null })
        .eq('id', id);
    },

    async getIntentByKey(idempotencyKey: string) {
      const { data } = await supabase
        .from('card_charge_intents')
        .select('*')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      return data ? mapIntent(data as Row) : null;
    },

    async insertIntent(params) {
      const { data, error } = await supabase
        .from('card_charge_intents')
        .insert({
          idempotency_key: params.idempotencyKey,
          saved_card_id: params.savedCardId,
          owner_type: params.owner.ownerType,
          owner_id: params.owner.ownerId,
          invoice_id: params.invoiceId ?? null,
          billing_period: params.billingPeriod ?? null,
          amount: params.amount,
          currency: params.currency,
          request_fingerprint: params.requestFingerprint,
          status: 'created',
        })
        .select('*')
        .single();
      if (error) throw new Error(`insertIntent failed: ${error.message}`);
      return mapIntent(data as Row);
    },

    async updateIntent(id, fields) {
      const patch: Row = {};
      if (fields.status !== undefined) patch.status = fields.status;
      if (fields.attemptCount !== undefined) patch.attempt_count = fields.attemptCount;
      if (fields.paymobOrderId !== undefined) patch.paymob_order_id = fields.paymobOrderId;
      if (fields.paymobTransactionId !== undefined) patch.paymob_transaction_id = fields.paymobTransactionId;
      if (fields.lastError !== undefined) patch.last_error = fields.lastError;
      if (fields.completedAt !== undefined) patch.completed_at = fields.completedAt;
      const { data, error } = await supabase
        .from('card_charge_intents')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(`updateIntent failed: ${error.message}`);
      return mapIntent(data as Row);
    },

    async insertEvent(params) {
      await supabase.from('saved_card_events').insert({
        event_type: params.eventType,
        owner_type: params.owner?.ownerType ?? null,
        owner_id: params.owner?.ownerId ?? null,
        saved_card_id: params.savedCardId ?? null,
        charge_intent_id: params.chargeIntentId ?? null,
        details: params.details ?? null,
      });
    },
  };
}
