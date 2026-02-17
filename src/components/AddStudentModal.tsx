'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, auditLog } from '@/lib/db-proxy';
import QRCode from 'qrcode';

interface Subject {
  id: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
  subject?: string | null;
  fee?: number;
}

interface AddStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  centerId: string;
  userId: string;
}

export default function AddStudentModal({
  isOpen,
  onClose,
  onSuccess,
  centerId,
  userId,
}: AddStudentModalProps) {
  const t = useTranslations('students');
  const tCommon = useTranslations('common');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [monthlyFee, setMonthlyFee] = useState('');
  const [groupId, setGroupId] = useState('');
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdStudent, setCreatedStudent] = useState<{ name: string; student_number: string; qr_code: string } | null>(null);

  useEffect(() => {
    if (!isOpen || !centerId) return;
    const load = async () => {
      const [subjRes, grpRes] = await Promise.all([
        dbSelect({
          table: 'subjects',
          select: 'id, name',
          filters: [{ column: 'center_id', op: 'eq', value: centerId }],
          order: { column: 'name' },
        }),
        dbSelect({
          table: 'student_groups',
          select: 'id, name, subject, fee',
          filters: [{ column: 'center_id', op: 'eq', value: centerId }],
          order: { column: 'name' },
        }),
      ]);
      if (subjRes.data) setSubjects(subjRes.data as Subject[]);
      if (grpRes.data) setGroups(grpRes.data as Group[]);
    };
    load();
  }, [isOpen, centerId]);

  const filteredGroups = subjectId
    ? groups.filter((g) => (g as Group & { subject?: string }).subject === subjects.find((s) => s.id === subjectId)?.name)
    : groups;

  useEffect(() => {
    if (groupId) {
      const g = groups.find((gr) => gr.id === groupId);
      if (g) setMonthlyFee(String(g.fee ?? 0));
    }
  }, [groupId, groups]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError(t('nameRequired', { defaultValue: 'Student name is required' }));
      return;
    }
    if (!groupId) {
      setError(t('groupRequiredError', { defaultValue: 'Group is required' }));
      return;
    }

    setIsLoading(true);
    try {
      const group = groups.find((g) => g.id === groupId);
      const fee = monthlyFee !== '' ? Number(monthlyFee) || 0 : (group?.fee ?? 0);

      const { data: inserted, error: insertError } = await dbInsert({
        table: 'students',
        data: {
          center_id: centerId,
          name: name.trim(),
          phone: phone.trim() || null,
          parent_phone: parentPhone.trim() || null,
          subject: subjects.find((s) => s.id === subjectId)?.name || group?.subject || null,
          fee,
          payment_status: 'unpaid',
        },
        select: 'id, name, student_number',
        single: true,
      });

      if (insertError) throw insertError;
      if (!inserted) throw new Error('Failed to create student');

      const student = inserted as { id: string; name: string; student_number: string };
      let qrDataURL = '';

      try {
        qrDataURL = await QRCode.toDataURL(student.id, {
          width: 300,
          margin: 2,
          errorCorrectionLevel: 'H',
        });
        await dbUpdate({
          table: 'students',
          data: { qr_code: qrDataURL },
          filters: [{ column: 'id', op: 'eq', value: student.id }],
        });
      } catch {
        // QR failure non-critical
      }

      if (groupId) {
        await dbInsert({
          table: 'student_group_members',
          data: { group_id: groupId, student_id: student.id },
          select: false,
        });
      }

      await auditLog({
        centerId,
        userId,
        action: 'student_create',
        entityType: 'students',
        entityId: student.id,
        details: { name: student.name, student_number: student.student_number },
      });

      setCreatedStudent({
        name: student.name,
        student_number: student.student_number,
        qr_code: qrDataURL,
      });
      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setCreatedStudent(null);
    setName('');
    setPhone('');
    setParentPhone('');
    setSubjectId('');
    setMonthlyFee('');
    setGroupId('');
    onClose();
  };

  if (!isOpen) return null;

  if (createdStudent) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" dir="rtl">
        <div className="bg-bg-primary rounded-xl shadow-xl max-w-sm w-full p-6">
          <div className="w-16 h-16 mx-auto bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-text-primary text-center mb-2">
            {t('studentCreated', { defaultValue: 'Student created!' })}
          </h2>
          <p className="text-sm text-text-secondary text-center mb-4">
            {createdStudent.name}
          </p>
          <p className="text-lg font-mono font-bold text-indigo-600 dark:text-indigo-400 text-center mb-4">
            {createdStudent.student_number}
          </p>
          {createdStudent.qr_code && (
            <div className="flex justify-center mb-4">
              <img src={createdStudent.qr_code} alt="QR" className="w-32 h-32" />
            </div>
          )}
          <button
            onClick={handleClose}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
          >
            {t('closeModal', { defaultValue: 'Close' })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" dir="rtl">
      <div className="bg-bg-primary rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-text-primary mb-4">
            {t('addStudent')}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                {t('name')} *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary"
                placeholder={t('name')}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                {t('phone')}
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary"
                placeholder="01XXXXXXXXX"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                {t('parentPhoneOptional', { defaultValue: 'Parent Phone (optional)' })}
              </label>
              <input
                type="tel"
                value={parentPhone}
                onChange={(e) => setParentPhone(e.target.value)}
                dir="ltr"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary"
                placeholder="01XXXXXXXXX"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                {t('groupRequired', { defaultValue: 'Group *' })}
              </label>
              <select
                value={groupId}
                onChange={(e) => {
                  const val = e.target.value;
                  setGroupId(val);
                  if (val) {
                    const g = groups.find((gr) => gr.id === val);
                    if (g) {
                      const subj = subjects.find((s) => s.name === g.subject);
                      setSubjectId(subj?.id ?? '');
                      setMonthlyFee(String(g.fee ?? 0));
                    }
                  } else {
                    setSubjectId('');
                    setMonthlyFee('');
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary"
                required
              >
                <option value="">{tCommon('select')}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            {groupId && (
              <>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    {t('subject')}
                  </label>
                  <input
                    type="text"
                    value={groups.find((g) => g.id === groupId)?.subject ?? ''}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-secondary text-text-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-1">
                    {t('feePerLesson')}
                  </label>
                  <input
                    type="number"
                    value={monthlyFee}
                    onChange={(e) => setMonthlyFee(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary"
                    min={0}
                    step={0.01}
                  />
                </div>
              </>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 py-2.5 px-4 border border-gray-300 dark:border-gray-600 text-text-primary rounded-lg hover:bg-bg-secondary"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 py-2.5 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {isLoading ? tCommon('loading') : tCommon('add')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
