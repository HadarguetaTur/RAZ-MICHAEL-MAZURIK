import React, { useState, useEffect } from 'react';
import { Entity, EntityPermission } from '../types';
import { nexusApi } from '../services/nexusApi';
import { useToast } from '../hooks/useToast';

interface EntityCardProps {
  entity: Entity;
  onClose: () => void;
  onEdit?: (entity: Entity) => void;
  onDelete?: (entityId: string) => void;
}

const PERMISSION_OPTIONS: { value: EntityPermission; label: string; color: string }[] = [
  { value: 'admin', label: 'מנהל', color: 'bg-red-50 text-red-600 border-red-100' },
  { value: 'teacher', label: 'מורה', color: 'bg-violet-50 text-violet-600 border-violet-100' },
  { value: 'parent', label: 'הורה', color: 'bg-blue-50 text-blue-600 border-blue-100' },
  { value: 'student', label: 'תלמיד', color: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
];

const EntityCard: React.FC<EntityCardProps> = ({ entity, onClose, onEdit, onDelete }) => {
  const toast = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editedEntity, setEditedEntity] = useState<Entity>(entity);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    setEditedEntity(entity);
  }, [entity]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updatedEntity = await nexusApi.updateEntity(entity.id, {
        phone: editedEntity.phone,
        permission: editedEntity.permission,
      });
      setIsEditing(false);
      if (onEdit) {
        onEdit(updatedEntity);
      }
    } catch (err) {
      console.error('Error saving entity:', err);
      toast.error('שגיאה בשמירת הנתונים');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await nexusApi.deleteEntity(entity.id);
      if (onDelete) {
        onDelete(entity.id);
      }
      onClose();
    } catch (err) {
      console.error('Error deleting entity:', err);
      toast.error('שגיאה במחיקת המשתמש');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleChange = (field: keyof Entity, value: any) => {
    setEditedEntity(prev => ({ ...prev, [field]: value }));
  };

  const getPermissionBadge = (permission: EntityPermission) => {
    const option = PERMISSION_OPTIONS.find(p => p.value === permission);
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-black border tracking-tight ${option?.color || 'bg-slate-50 text-slate-400 border-slate-100'}`}>
        {option?.label || permission}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full lg:w-[500px] bg-white lg:h-full h-[85vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl animate-in slide-in-from-bottom lg:slide-in-from-left duration-500 flex flex-col overflow-hidden text-right" dir="rtl">
        
        {/* Header */}
        <div className="p-6 md:p-10 border-b border-slate-100 shrink-0 bg-white">
          <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 lg:hidden"></div>
          <div className="flex items-center justify-between mb-8">
            <button onClick={onClose} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center bg-white border border-slate-200 text-slate-400 rounded-xl transition-all hover:bg-slate-50">✕</button>
            <div className="flex gap-2">
               {isEditing ? (
                 <>
                   <button 
                    onClick={() => {
                      setIsEditing(false);
                      setEditedEntity(entity);
                    }}
                    disabled={isSaving}
                    className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all"
                   >
                     ביטול
                   </button>
                   <button 
                    onClick={handleSave}
                    disabled={isSaving}
                    className="px-6 py-2.5 bg-violet-600 text-white rounded-xl text-xs font-black hover:bg-violet-700 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                   >
                     {isSaving ? 'שומר...' : 'שמור שינויים'}
                   </button>
                 </>
               ) : (
                 <button 
                  onClick={() => setIsEditing(true)}
                  className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black hover:bg-slate-800 transition-all shadow-lg active:scale-95"
                 >
                   עריכה
                 </button>
               )}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="w-20 h-20 md:w-24 md:h-24 bg-violet-600 rounded-3xl flex items-center justify-center text-white text-3xl md:text-4xl font-black shadow-xl shadow-violet-100">
              {entity.name[0] || '?'}
            </div>
            <div className="flex-1">
              <h2 className="text-2xl md:text-3xl font-black text-slate-800 mb-2">{entity.name}</h2>
              <div className="flex flex-wrap items-center gap-3">
                {getPermissionBadge(entity.permission)}
                <span className="text-slate-400 text-xs font-medium mr-auto">מזהה: {entity.id.slice(0, 10)}...</span>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar bg-[#fcfdfe]">
          <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {/* Phone Section */}
            <div className="p-6 bg-white border border-slate-100 rounded-2xl md:rounded-[32px] shadow-sm hover:shadow-md transition-shadow">
              <div className="text-[10px] text-slate-400 font-black uppercase mb-4 tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-violet-500 rounded-full"></span>
                פרטי קשר
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] text-slate-400 font-bold mb-1">טלפון</div>
                  {isEditing ? (
                    <input 
                      type="tel"
                      value={editedEntity.phone}
                      onChange={(e) => handleChange('phone', e.target.value)}
                      className="text-lg font-black text-slate-900 border-b-2 border-violet-500 outline-none w-full bg-transparent"
                      dir="ltr"
                    />
                  ) : (
                    <div className="text-lg font-black text-slate-900 tracking-tight" dir="ltr">{entity.phone || 'לא הוזן'}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Permission Section */}
            <div className="p-6 bg-white border border-slate-100 rounded-2xl md:rounded-[32px] shadow-sm hover:shadow-md transition-shadow">
              <div className="text-[10px] text-slate-400 font-black uppercase mb-4 tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
                סוג הרשאה
              </div>
              <div className="space-y-4">
                {isEditing ? (
                  <div className="flex flex-wrap gap-2">
                    {PERMISSION_OPTIONS.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleChange('permission', option.value)}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                          editedEntity.permission === option.value
                            ? 'bg-violet-600 text-white shadow-md'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    {getPermissionBadge(entity.permission)}
                    <span className="text-sm text-slate-500 font-medium">
                      {entity.permission === 'admin' && 'גישה מלאה למערכת'}
                      {entity.permission === 'teacher' && 'גישת מורה לבוט'}
                      {entity.permission === 'parent' && 'גישת הורה לבוט'}
                      {entity.permission === 'student' && 'גישת תלמיד לבוט'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Metadata Section */}
            {(entity.createdAt || entity.updatedAt) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {entity.createdAt && (
                  <div className="text-xs text-slate-400 font-bold italic">
                    נוצר בתאריך: {new Date(entity.createdAt).toLocaleDateString('he-IL')}
                  </div>
                )}
                {entity.updatedAt && (
                  <div className="text-xs text-slate-400 font-bold italic sm:text-left">
                    עודכן לאחרונה: {new Date(entity.updatedAt).toLocaleDateString('he-IL')}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 md:p-10 border-t border-slate-100 bg-white flex gap-3 shrink-0 pb-10">
          {entity.phone && (
            <a 
              href={`https://wa.me/${entity.phone.replace(/[^0-9]/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black shadow-lg shadow-emerald-100 flex items-center justify-center gap-3 active:scale-95 transition-all hover:bg-emerald-700"
            >
              <span className="text-lg">📱</span>
              <span>WhatsApp</span>
            </a>
          )}
          <button 
            onClick={() => setShowDeleteConfirm(true)}
            className="px-6 py-4 bg-red-50 text-red-600 rounded-2xl font-black flex items-center justify-center gap-2 active:scale-95 transition-all hover:bg-red-100"
          >
            <span>🗑️</span>
            <span>מחק</span>
          </button>
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-10 p-6">
            <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl text-center">
              <div className="text-5xl mb-4">⚠️</div>
              <h3 className="text-xl font-black text-slate-800 mb-2">מחיקת משתמש</h3>
              <p className="text-slate-500 font-medium mb-6">האם אתה בטוח שברצונך למחוק את {entity.name}? פעולה זו אינה הפיכה.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={isDeleting}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-black hover:bg-slate-200 transition-all"
                >
                  ביטול
                </button>
                <button
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl font-black hover:bg-red-700 transition-all disabled:opacity-50"
                >
                  {isDeleting ? 'מוחק...' : 'מחק'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EntityCard;
