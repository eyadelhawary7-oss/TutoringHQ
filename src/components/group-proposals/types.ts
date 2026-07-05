// Shared types for the two-sided group-proposal negotiation screens.
// Both the center-side tab (`components/teachers/GroupProposalsTab`) and the
// teacher-side section (`app/[locale]/teacher/GroupProposalsSection`) render the
// same offer/counter loop over the center cut; these pieces are byte-identical
// on both sides, so they live here once to kill the drift risk (audit #12).

export type Offer = {
  id: string;
  madeBy: 'teacher' | 'center';
  cutEgp: number;
  note: string | null;
  createdAt: string;
};

export type ProposalStatus = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired';

export const STATUS_KEY: Record<ProposalStatus, string> = {
  open: 'statusOpen',
  accepted: 'statusAccepted',
  declined: 'statusDeclined',
  withdrawn: 'statusWithdrawn',
  expired: 'statusExpired',
};
