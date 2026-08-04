// src/lib/collectionPayout/collectionMath.ts
//
// The B1 rate card, in integer piastres. PURE — no I/O, no Date, no config read.
// The rate card is passed in from THE ONE CONFIG POINT
// (src/lib/collectionPayout/config.ts); this module never reads it itself, so a
// missing rate card cannot be papered over with a default here.
//
// ── THE LOCKED RATE CARD (design/NEW-FEATURES.md B1, locked 26 July 2026) ────
//
//   provider fee                 X
//   collection fee        0.10 × X            visible to the PROVIDER
//   price markup          0.075 × X + 7.5     visible to the PROVIDER ONLY
//   provider price        X + markup          what provider screens quote
//   parent processing fee 0.015 × provider price + 1.5   visible to the PARENT
//   parent pays           provider price + parent processing fee
//
//   Worked example, X = 150.00:
//     provider keeps   135.00
//     provider price   168.75
//     parent fee         4.03   (1.5% × 168.75 + 1.5 = 2.53125 + 1.5)
//     parent pays      172.78
//
// ── TWO FEES, ONE NAME, AND IT FAILS SILENTLY ────────────────────────────────
//
// The PARENT PROCESSING FEE computed here is NOT the CENTER PROCESSING FEE.
//
//   CENTER fee: flat 20 EGP, paid by the centre/teacher, on Paymob-charged
//     subscription / pack / card-order / reactivation invoices. Lives in
//     src/lib/processingFee.ts (`resolveProcessingFeeAmount`) and is snapshotted
//     into invoices.metadata.processing_fee.
//   PARENT fee: 1.5% + 1.5 EGP, paid by the PARENT, on tuition collected on a
//     provider's behalf. Lives here.
//
// On the design's own example the two differ by 20.00 vs 4.03 — no type error,
// no exception, just a parent billed the wrong amount by a plausible-looking
// number. `resolveProcessingFeeAmount`, `getProcessingFeeConfig`,
// `applyProcessingFee` and `invoices.metadata.processing_fee` MUST NEVER appear
// in a parent tuition path. This module imports none of them.
//
// The flat 20 EGP DOES still apply to the charge invoice we raise against the
// provider for our own collection fee — that invoice is a normal charge invoice
// and goes through the existing pricing path, not through this module.
//
// ── VAT ──────────────────────────────────────────────────────────────────────
// Every amount here is VAT-INCLUSIVE at 14%. The VAT is the slice already inside
// the amount (P × r / (1 + r)), never added on top.
//
// ── PRESENTATION RULE (B1) ───────────────────────────────────────────────────
// "The parent never sees the underlying fee. The provider screens quote the
// provider price, not the parent total. If a screen shows a provider the parent
// total, that is a bug." `providerFacingQuote()` and `parentFacingQuote()` below
// are separate functions precisely so a screen cannot reach the wrong one by
// accident — the provider quote does not contain `parentPaysMinor` at all.

import type { RateCard } from './config';
import {
  applyRateMinor,
  assertNonNegativeMinor,
  egpToMinor,
  vatInsideMinor,
} from './money';

/** Everything the platform and both parties see, in piastres. */
export interface CollectionSplitMinor {
  /** X — the fee the provider entered. VAT-inclusive. */
  providerFeeMinor: number;
  /** 0.10 × X — the platform's collection fee. Provider-visible. */
  collectionFeeMinor: number;
  /** VAT already inside the collection fee. */
  collectionFeeVatMinor: number;
  /** X − collection fee — what the provider keeps. */
  providerKeepsMinor: number;
  /** 0.075 × X + 7.5 — the markup. Provider-visible, NEVER parent-visible. */
  markupMinor: number;
  /** X + markup — what provider screens quote. */
  providerPriceMinor: number;
  /** 0.015 × provider price + 1.5 — parent-visible. */
  parentProcessingFeeMinor: number;
  /** VAT already inside the parent processing fee. */
  parentProcessingFeeVatMinor: number;
  /** provider price + parent processing fee — the parent total. */
  parentPaysMinor: number;
}

/**
 * Compute the full split from a provider fee in piastres.
 *
 * THROWS on a non-positive fee. A zero-fee tuition charge is not a valid
 * collection: it would produce a zero split that renders as a successful
 * collection of nothing.
 */
export function computeCollectionSplitMinor(
  providerFeeMinor: number,
  rateCard: RateCard,
): CollectionSplitMinor {
  assertNonNegativeMinor(providerFeeMinor, 'providerFee');
  if (providerFeeMinor <= 0) {
    throw new Error('collection_split_requires_positive_provider_fee');
  }

  const collectionFeeMinor = applyRateMinor(providerFeeMinor, rateCard.collectionFeeRate);
  const providerKeepsMinor = providerFeeMinor - collectionFeeMinor;

  const markupMinor =
    applyRateMinor(providerFeeMinor, rateCard.markupRate) + egpToMinor(rateCard.markupFlatEgp);
  const providerPriceMinor = providerFeeMinor + markupMinor;

  const parentProcessingFeeMinor =
    applyRateMinor(providerPriceMinor, rateCard.parentFeeRate) +
    egpToMinor(rateCard.parentFeeFlatEgp);
  const parentPaysMinor = providerPriceMinor + parentProcessingFeeMinor;

  return {
    providerFeeMinor,
    collectionFeeMinor,
    collectionFeeVatMinor: vatInsideMinor(collectionFeeMinor, rateCard.vatRate),
    providerKeepsMinor,
    markupMinor,
    providerPriceMinor,
    parentProcessingFeeMinor,
    parentProcessingFeeVatMinor: vatInsideMinor(parentProcessingFeeMinor, rateCard.vatRate),
    parentPaysMinor,
  };
}

/**
 * The provider-facing view. Deliberately DOES NOT carry the parent total —
 * B1: "If a screen shows a provider the parent total, that is a bug."
 */
export interface ProviderQuoteMinor {
  providerFeeMinor: number;
  collectionFeeMinor: number;
  providerKeepsMinor: number;
  markupMinor: number;
  providerPriceMinor: number;
}

export function providerFacingQuote(split: CollectionSplitMinor): ProviderQuoteMinor {
  return {
    providerFeeMinor: split.providerFeeMinor,
    collectionFeeMinor: split.collectionFeeMinor,
    providerKeepsMinor: split.providerKeepsMinor,
    markupMinor: split.markupMinor,
    providerPriceMinor: split.providerPriceMinor,
  };
}

/**
 * The parent-facing view. Carries the provider price, the parent fee and the
 * total — and NEITHER the collection fee NOR the markup, which B1 forbids
 * showing a parent.
 */
export interface ParentQuoteMinor {
  providerPriceMinor: number;
  parentProcessingFeeMinor: number;
  parentProcessingFeeVatMinor: number;
  parentPaysMinor: number;
}

export function parentFacingQuote(split: CollectionSplitMinor): ParentQuoteMinor {
  return {
    providerPriceMinor: split.providerPriceMinor,
    parentProcessingFeeMinor: split.parentProcessingFeeMinor,
    parentProcessingFeeVatMinor: split.parentProcessingFeeVatMinor,
    parentPaysMinor: split.parentPaysMinor,
  };
}

/**
 * A zero split, for surfaces that must render something when collection is not
 * configured. Every figure is 0 and `sourced` is false, so a caller can render
 * "0 — online collection is not switched on" rather than a plausible number.
 *
 * PAYOUT-SYSTEM-SPEC.md §4 on the same principle for balances: a figure that
 * cannot be sourced from real data reads zero and says why.
 */
export interface UnsourcedSplit {
  sourced: false;
  reasonKey: string;
  split: CollectionSplitMinor;
}

export function unsourcedSplit(reasonKey: string): UnsourcedSplit {
  return {
    sourced: false,
    reasonKey,
    split: {
      providerFeeMinor: 0,
      collectionFeeMinor: 0,
      collectionFeeVatMinor: 0,
      providerKeepsMinor: 0,
      markupMinor: 0,
      providerPriceMinor: 0,
      parentProcessingFeeMinor: 0,
      parentProcessingFeeVatMinor: 0,
      parentPaysMinor: 0,
    },
  };
}
