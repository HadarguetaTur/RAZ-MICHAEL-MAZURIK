import React, { useState } from 'react';
import { Entity, EntityPermission } from '../types';
import { nexusApi } from '../services/nexusApi';

interface EntityFormModalProps {
  onClose: () => void;
  onSuccess: (entity: Entity) => void;
}

const PERMISSION_OPTIONS: { value: EntityPermission; label: string; description: string }[] = [
  { value: 'admin', label: 'מנהל', description: 'גישה מלאה למערכת' },
  { value: 'teacher', label: 'מורה', description: 'גישת מורה לבוט' },
  { value: 'parent', label: 'הורה', description: 'גישת הורה לבוט' },
  { value: 'student', label: 'תלמיד', description: 'גישת תלמיד לבוט' },
];

const EntityFormModal: React.FC<EntityFormModalProps> = ({ onClose, onSuccess }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    permission: 'student' as EntityPermission,
  });

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    // Validation
    if (!formData.name.trim()) {
      setError('שם המשתמש הוא שדה חובה');
      return;
    }
    if (!formData.phone.trim()) {
      setError('מספר טלפון הוא שדה חובה');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const entityData: Partial<Entity> = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        permission: formData.permission,
      };

      const newEntity = await nexusApi.createEntity(entityData);
      onSuccess(newEntity);
    } catch (err: any) {
      console.error('[EntityFormModal] Error creating entity:', err);
      const errorMessage = err.message || err.error?.message || JSON.stringify(err) || 'שגיאה ביצירת המשתמש';
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
        className="relative w-full lg:w-[500px] bg-white lg:h-full h-[85vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl animate-in slide-in-from-bottom lg:slide-in-from-right duration-500 flex flex-col overflow-hidden text-right" 
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
                className="px-6 py-2.5 bg-violet-600 text-white rounded-xl text-xs font-black hover:bg-violet-700 transition-all shadow-lg active:scale-95 disabled:opacity-50"
              >
                {isSubmitting ? 'יוצר...' : 'צור משתמש'}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-violet-600 rounded-2xl flex items-center justify-center text-white text-2xl font-black shadow-xl shadow-violet-100">
              {formData.name ? formData.name[0] : '+'}
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800">משתמש חדש</h2>
              <p className="text-slate-400 text-sm font-bold">הוסף ישות מורשית לבוט</p>
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
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-50 transition-all"
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
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-50 transition-all"
                dir="ltr"
              />
            </div>
          </div>

          {/* Permission Section */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
            <div className="text-[10px] text-slate-400 font-black uppercase tracking-widest flex items-center gap-2 mb-4">
              <span className="w-1.5 h-1.5 bg-violet-500 rounded-full" />
              סוג הרשאה
            </div>
            
            <div className="space-y-3">
              {PERMISSION_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleChange('permission', option.value)}
                  className={`w-full p-4 rounded-xl text-right transition-all border ${
                    formData.permission === option.value
                      ? 'bg-violet-50 border-violet-300 ring-2 ring-violet-100'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className={`font-black text-sm ${
                        formData.permission === option.value ? 'text-violet-700' : 'text-slate-700'
                      }`}>
                        {option.label}
                      </div>
                      <div className="text-xs text-slate-400 font-medium mt-0.5">
                        {option.description}
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                      formData.permission === option.value 
                        ? 'border-violet-600 bg-violet-600' 
                        : 'border-slate-300'
                    }`}>
                      {formData.permission === option.value && (
                        <div className="w-2 h-2 bg-white rounded-full"></div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

        </form>

        {/* Footer */}
        <div className="p-6 md:p-8 border-t border-slate-100 bg-white flex gap-3 shrink-0">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 py-4 bg-violet-600 text-white rounded-2xl font-black shadow-lg shadow-violet-100 flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                יוצר משתמש...
              </>
            ) : (
              <>
                <span className="text-lg">+</span>
                צור משתמש חדש
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

export default EntityFormModal;
