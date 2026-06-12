'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/routing';
import PrivateGroupModal from './PrivateGroupModal';
import FirstGroupCelebration from './FirstGroupCelebration';

/**
 * Shared "start your free trial / create first group" action for every
 * free-zone surface (dashboard tiles, locked sub-pages, upsell cards). Returns
 * `startTrial` (lapsed -> resubscribe, otherwise opens the create-group modal)
 * and `modal` (the create modal + first-group celebration) to render in the
 * page tree. `onCreated` lets the page refresh its context once the gate flips.
 */
export function useStartTrial(
  state: 'center_only' | 'unified' | 'lapsed',
  onCreated?: () => void,
) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [celebration, setCelebration] = useState<{ id: string; name: string | null } | null>(null);

  const startTrial = () => {
    if (state === 'lapsed') {
      router.push('/teacher/resubscribe');
    } else {
      setOpen(true);
    }
  };

  const modal = (
    <>
      {state !== 'lapsed' && (
        <PrivateGroupModal
          open={open}
          showTrialTerms={state === 'center_only'}
          onClose={() => setOpen(false)}
          onCreated={(group) => {
            const wasFirstGroup = state === 'center_only';
            setOpen(false);
            // Let the page refresh its own data/context (the gate flips after
            // the first group); the celebration handles first-group navigation.
            onCreated?.();
            if (wasFirstGroup) {
              setCelebration({ id: group.id, name: group.name });
            }
          }}
        />
      )}
      {celebration && (
        <FirstGroupCelebration
          group={celebration}
          onClose={() => setCelebration(null)}
          onGoToGroup={() => {
            const id = celebration.id;
            setCelebration(null);
            router.push(`/teacher/groups/${id}`);
          }}
        />
      )}
    </>
  );

  return { startTrial, modal };
}
