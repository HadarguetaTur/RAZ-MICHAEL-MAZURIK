import React, { useState } from 'react';
import { Student } from '../types';
import { createStudent } from '../data/mutations';

interface StudentFormModalProps {
  onClose: () => void;
  onSuccess: (student: Student) => void;
}

// Options based on Airtable field mapping
const GRADE_OPTIONS = ['ו', 'ז', 'ח', 'ט', 'י', 'יא', 'יב'];
const SUBJECT_OPTIONS = ['מתמטיקה', 'פיזיקה', 'אנגלית'];
const LESSON_TYPE_OPTIONS = ['פרטי', 'זוגי', 'קבוצתי'];
const LEVEL_OPTIONS = ['3', '4', '5'];

const StudentFormModal: React.FC<StudentFormModalProps> = ({ onClose, onSuccess }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    parentName: '',
    parentPhone: '',
    grade: '',
    subjectFocus: [] as string[],
    level: '',
    weeklyLessonsLimit: '',
  });

  const handleChange = (field: string, value: string | string[]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleSubjectToggle = (subject: string) => {
    setFormData(prev => ({
      ...prev,
      subjectFocus: prev.subjectFocus.includes(subject)
        ? prev.subjectFocus.filter(s => s !== subject)
        : [...prev.subjectFocus, subject]
    }));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    
    // Validation
    if (!formData.name.trim()) {
      setError('שם התלמיד הוא שדה חובה');
      return;
    }
    if (!formData.phone.trim()) {
      setError('מספר טלפון הוא שדה חובה');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const studentData: Partial<Student> = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        parentName: formData.parentName.trim() || undefined,
        parentPhone: formData.parentPhone.trim() || undefined,
        grade: formData.grade || undefined,
        subjectFocus: formData.subjectFocus.length > 0 ? formData.subjectFocus.join(',') : undefined,
        level: formData.level || undefined,
        weeklyLessonsLimit: formData.weeklyLessonsLimit ? parseInt(formData.weeklyLessonsLimit) : undefined,
      };

      const newStudent = await createStudent(studentData);
      onSuccess(newStudent);
    } catch (err: any) {
      console.error('[StudentFormModal] Error creating student:', err);
      const errorMessage = err.message || err.error?.message || JSON.stringify(err) || 'שגיאה ביצירת התלמיד';
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        className="relative w-full lg:w-[600px] bg-white lg:h-full h-[95vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl animate-in slide-in-from-bottom lg:slide-in-from-right duration-500 flex flex-col overflow-hidden text-right" 
        dir="rtl"
      >
        {/* Header */}
        <div className="p-6 md:p-8 border-b border-slate-100 shrink-0 bg-white">
          <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 lg:hidden" />
          
          <div className="flex items-center justify-between mb-6">
            <button 
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center bg-white border border-slate-200 text-slate-400 rounded-xl transition-all hover:bg-slate-50"
            >
              ✕
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all"
              >
                ביטול
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 transition-all shadow-lg active:scale-95 disabled:opacity-50"
              >
                {isSubmitting ? 'יוצר...' : 'צור תלמיד'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-emerald-600 rounded-2xl flex items-center justify-center text-white text-2xl font-black shadow-xl shadow-emerald-100">
              {formData.name ? formData.name[0] : '+'}
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800">תלמיד חדש</h2>
              <p className="text-slate-400 text-sm font-bold">מלא את הפרטים ליצירת תלמיד חדש במערכת</p>
            </div>
          </div>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar bg-[#fcfdfe]">
          {/* Error Message */}
          {error && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-600 text-sm font-bold">
              {error}
            </div>
          )}

          {/* Required Fields Section */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest flex items-center gap-2 mb-4">
              <span className="w-1.5 h-1.5 bg-rose-500 rounded-full" />
              שדות חובה
            </div>
            
            {/* Name */}
            <div>
              <label className="block text-xs font-black text-slate-600 mb-2">שם מלא *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="הכנס שם מלא"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-xs font-black text-slate-600 mb-2">טלפון *</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                placeholder="050-1234567"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                dir="ltr"
              />
            </div>
          </div>

          {/* Parent Info Section */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest flex items-center gap-2 mb-4">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
              פרטי הורה
            </div>
            
            {/* Parent Name */}
            <div>
              <label className="block text-xs font-black text-slate-600 mb-2">שם הורה</label>
              <input
                type="text"
                value={formData.parentName}
                onChange={(e) => handleChange('parentName', e.target.value)}
                placeholder="שם ההורה"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
              />
            </div>

            {/* Parent Phone */}
            <div>
              <label className="block text-xs font-black text-slate-600 mb-2">טלפון הורה</label>
              <input
                type="tel"
                value={formData.parentPhone}
                onChange={(e) => handleChange('parentPhone', e.target.value)}
                placeholder="050-1234567"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
                dir="ltr"
              />
            </div>
          </div>

          {/* Academic Info Section */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest flex items-center gap-2 mb-4">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
              פרטים לימודיים
            </div>
            
            {/* Grade */}
            <div>
              <label className="block text-xs font-black text-slate-600 mb-2">כיתה</label>
              <div className="flex flex-wrap gap-2">
                {GRADE_OPTIONS.map(grade => (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => handleChange('grade', formData.grade === grade ? '' : grade)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                      formData.grade === grade
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {grade}
                  </button>
                ))}
              </div>
            </div>

            {/* Subjects */}
            <div>
              <label className="block text-xs font-black text-slate-600 mb-2">מקצועות</label>
              <div className="flex flex-wrap gap-2">
                {SUBJECT_OPTIONS.map(subject => (
                  <button
                    key={subject}
                    type="button"
                    onClick={() => handleSubjectToggle(subject)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                      formData.subjectFocus.includes(subject)
                        ? 'bg-emerald-600 text-white shadow-md'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {subject}
                  </button>
                ))}
              </div>
            </div>

            {/* Level */}
            <div>
              <label className="block text-xs font-black text-slate-600 mb-2">רמה (יח"ל)</label>
              <div className="flex flex-wrap gap-2">
                {LEVEL_OPTIONS.map(level => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => handleChange('level', formData.level === level ? '' : level)}
                    className={`px-6 py-2 rounded-xl text-sm font-bold transition-all ${
                      formData.level === level
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {/* Weekly Lessons Limit */}
            <div>
              <label className="block text-xs font-black text-slate-600 mb-2">מכסת שיעורים שבועית</label>
              <input
                type="number"
                min="0"
                max="10"
                value={formData.weeklyLessonsLimit}
                onChange={(e) => handleChange('weeklyLessonsLimit', e.target.value)}
                placeholder="0"
                className="w-32 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-all"
              />
            </div>
          </div>

        </form>

        {/* Footer */}
        <div className="p-6 md:p-8 border-t border-slate-100 bg-white flex gap-3 shrink-0">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black shadow-lg shadow-emerald-100 flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                יוצר תלמיד...
              </>
            ) : (
              <>
                <span className="text-lg">+</span>
                צור תלמיד חדש
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-8 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black hover:bg-slate-200 transition-all"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
};

export default StudentFormModal;
