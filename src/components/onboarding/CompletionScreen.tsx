'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import confetti from 'canvas-confetti';
import { supabase } from '@/lib/supabase';

async function scheduleWhatsAppOnboarding(centerId: string, centerPhone: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return;
  await fetch('/api/whatsapp/schedule-onboarding', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ centerId, centerPhone }),
  });
}

interface CompletionScreenProps {
  centerId: string;
  centerPhone: string;
  onGoToDashboard: () => void;
}

export default function CompletionScreen({ centerId, centerPhone, onGoToDashboard }: CompletionScreenProps) {
  const t = useTranslations('onboarding');

  useEffect(() => {
    const duration = 2 * 1000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#0D9488', '#F59E0B'],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#0D9488', '#F59E0B'],
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();

    if (centerPhone?.trim()) {
      scheduleWhatsAppOnboarding(centerId, centerPhone).catch(console.error);
    }
  }, [centerId, centerPhone]);

  return (
    <div className="text-center space-y-6 py-8">
      <h1 className="text-4xl font-black text-foreground" style={{ fontFamily: "'Cairo-Arabic', Georgia, \"Times New Roman\", serif" }}>
        {t('completionTitle')}
      </h1>
      <p className="text-lg text-slate-500">{t('completionDesc')}</p>
      <button
        onClick={onGoToDashboard}
        className="px-8 py-4 rounded-xl text-base font-bold text-white bg-teal-600 hover:bg-teal-700 transition-colors"
      >
        {t('goToDashboard')}
      </button>
    </div>
  );
}
