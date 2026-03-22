'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

interface ChangePinModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChangePinModal({ isOpen, onClose }: ChangePinModalProps) {
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const resetForm = () => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    setError(null);
    if (!/^\d{4,}$/.test(newPin)) {
      setError('الرمز الجديد يجب أن يكون 4 أرقام على الأقل (أرقام فقط)');
      return;
    }
    if (newPin !== confirmPin) {
      setError('الرمز الجديد وتأكيد الرمز غير متطابقَين');
      return;
    }

    setLoading(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user?.email) throw new Error('لم يتم العثور على المستخدم');

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPin,
      });
      if (signInError) {
        setError('الرمز الحالي غير صحيح');
        setLoading(false);
        return;
      }

      const { error: authUpdateError } = await supabase.auth.updateUser({
        password: newPin,
      });
      if (authUpdateError) throw authUpdateError;

      const encoder = new TextEncoder();
      const data = encoder.encode(newPin);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashedPin = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      const { error: dbUpdateError } = await supabase
        .from('users')
        .update({ pin_code: hashedPin })
        .eq('id', user.id);
      if (dbUpdateError) throw dbUpdateError;

      setSuccess(true);
      setTimeout(() => handleClose(), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'حدث خطأ، حاول مرة أخرى');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="modal-spring-in bg-white rounded-2xl p-6 w-full max-w-sm space-y-4" dir="rtl">
        <h2 className="text-lg font-bold text-slate-800">تغيير الرمز السري</h2>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">
            تم تحديث الرمز بنجاح ✓
          </p>
        )}

        {[
          { label: 'الرمز الحالي', value: currentPin, setter: setCurrentPin },
          { label: 'الرمز الجديد', value: newPin, setter: setNewPin },
          { label: 'تأكيد الرمز الجديد', value: confirmPin, setter: setConfirmPin },
        ].map(({ label, value, setter }) => (
          <div key={label} className="space-y-1">
            <label className="text-sm font-medium text-slate-700 block">{label}</label>
            <input
              type="password"
              inputMode="numeric"
              value={value}
              onChange={(e) => setter(e.target.value)}
              disabled={loading || success}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
              dir="ltr"
            />
          </div>
        ))}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleClose}
            className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50"
          >
            إلغاء
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || success}
            className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 disabled:opacity-50"
          >
            {loading ? '...' : 'تحديث الرمز'}
          </button>
        </div>
      </div>
    </div>
  );
}
