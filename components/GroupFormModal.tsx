import React, { useState } from 'react';
import { StudentGroup } from '../types';
import StudentsPicker from './StudentsPicker';

interface GroupFormModalProps {
  group?: StudentGroup;
  onClose: () => void;
  onSave: (data: { name: string; studentIds: string[]; status: 'active' | 'paused' }) => Promise<void>;
}

const GroupFormModal: React.FC<GroupFormModalProps> = ({ group, onClose, onSave }) => {
  const [name, setName] = useState(group?.name || '');
  const [studentIds, setStudentIds] = useState<string[]>(group?.studentIds || []);
  const [status, setStatus] = useState<'active' | 'paused'>(group?.status || 'active');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = Boolean(group);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('שם הקבוצה הוא שדה חובה');
      return;
    }
    if (studentIds.length === 0) {
      setError('יש לבחור לפחות תלמיד אחד');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({ name: name.trim(), studentIds, status });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'אירעה שגיאה בשמירה');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 md:p-8 animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-black text-slate-900">
            {isEditing ? 'עריכת קבוצה' : 'קבוצה חדשה'}
          </h3>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">שם קבוצה</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="לדוגמה: קבוצה א׳ מתמטיקה"
              disabled={isSaving}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all disabled:opacity-50"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">סטטוס</label>
            <div className="grid grid-cols-2 gap-2">
              {(['active', 'paused'] as const).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  disabled={isSaving}
                  className={`py-2.5 text-sm font-bold border rounded-xl transition-all ${
                    status === s
                      ? s === 'active'
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'bg-amber-500 border-amber-500 text-white'
                      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {s === 'active' ? 'פעילה' : 'מושהית'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              תלמידים ({studentIds.length})
            </label>
            <StudentsPicker
              values={studentIds}
              onChange={setStudentIds}
              placeholder="חפש תלמידים להוספה..."
              disabled={isSaving}
              filterActiveOnly={true}
              fallbackNames={
                group?.studentNames
                  ? Object.fromEntries(
                      group.studentIds.map((id, idx) => [id, group.studentNames?.[idx] || ''])
                        .filter(([_, name]) => name)
                    )
                  : {}
              }
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm font-bold text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className={`flex-1 py-4 rounded-2xl font-bold shadow-lg transition-all ${
                isSaving
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isSaving ? 'שומר...' : isEditing ? 'שמור שינויים' : 'צור קבוצה'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-6 py-4 rounded-2xl font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all"
            >
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default GroupFormModal;
