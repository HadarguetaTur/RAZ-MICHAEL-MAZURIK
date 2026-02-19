
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { HomeworkLibraryItem, HomeworkAssignment, Student } from '../types';
import { parseApiError } from '../services/nexusApi';
import { getHomeworkLibrary, getHomeworkAssignments } from '../data/resources/homework';
import { assignHomework, createHomeworkLibraryItem, updateHomeworkLibraryItem, deleteHomeworkLibraryItem } from '../data/mutations';
import { nexusApi } from '../services/nexusApi';
import StudentPicker from './StudentPicker';
import { useStudents } from '../hooks/useStudents';
import AppSidePanel from './ui/AppSidePanel';
import { useToast } from '../hooks/useToast';

// ─── Types for library form ────────────────────────────────────────────────
interface AttachmentInput {
  id?: string; // Airtable attachment ID (for existing attachments)
  url: string;
  filename: string;
  isNew?: boolean; // true if newly added (not yet saved to Airtable)
}

interface LibraryFormData {
  topic: string;
  subTopic: string;
  description: string;
  level: string;
  grade: string;
  status: string;
  attachments: AttachmentInput[];
}

const EMPTY_LIBRARY_FORM: LibraryFormData = {
  topic: '',
  subTopic: '',
  description: '',
  level: '',
  grade: '',
  status: 'פעיל',
  attachments: [],
};

const Homework: React.FC = () => {
  const toast = useToast();
  const [activeView, setActiveView] = useState<'library' | 'assignments'>('assignments');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [library, setLibrary] = useState<HomeworkLibraryItem[]>([]);
  const [assignments, setAssignments] = useState<HomeworkAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  // Assignment Form State
  const [selectedHomework, setSelectedHomework] = useState<string>('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [dueDate, setDueDate] = useState('');
  
  // Library Form State
  const [libraryForm, setLibraryForm] = useState<LibraryFormData>(EMPTY_LIBRARY_FORM);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use the centralized students hook
  const { getStudentById } = useStudents({ autoLoad: true });

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [lib, assign] = await Promise.all([
          getHomeworkLibrary(),
          getHomeworkAssignments()
        ]);
        setLibrary(lib);
        setAssignments(assign);
      } catch (err) {
        toast.error(parseApiError(err));
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // ─── Assignment handlers ─────────────────────────────────────────────────

  const handleAssign = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }
    if (!selectedHomework || !selectedStudent || !dueDate) {
      toast.error('יש למלא את כל השדות');
      return;
    }

    const homeworkItem = library.find(h => h.id === selectedHomework);
    const studentItem = selectedStudent;

    setIsSubmitting(true);
    try {
      const newAssign = await assignHomework({
        studentId: selectedStudent.id,
        studentName: studentItem?.name,
        homeworkId: homeworkItem ? parseInt(homeworkItem.id, 10) || 0 : 0,
        homeworkTitle: homeworkItem?.topic || '',
        dueDate: dueDate,
      });
      // Reload assignments to get fresh data (cache was invalidated by mutation)
      const freshAssignments = await getHomeworkAssignments();
      setAssignments(freshAssignments);
      setShowAssignModal(false);
      // Reset form
      setSelectedHomework('');
      setSelectedStudent(null);
      setDueDate('');
      toast.success('שיעורי הבית הוקצו בהצלחה');
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── Library CRUD handlers ───────────────────────────────────────────────

  const openCreateLibraryModal = () => {
    setLibraryForm(EMPTY_LIBRARY_FORM);
    setEditingItemId(null);
    setShowLibraryModal(true);
  };

  const openEditLibraryModal = (item: HomeworkLibraryItem) => {
    setLibraryForm({
      topic: item.topic || '',
      subTopic: item.subTopic || '',
      description: item.description || '',
      level: item.level || '',
      grade: item.grade || '',
      status: item.status || 'פעיל',
      attachments: item.attachments
        ? item.attachments.map(a => ({ id: a.id, url: a.url, filename: a.filename }))
        : [],
    });
    setEditingItemId(item.id);
    setShowLibraryModal(true);
  };

  const handleSaveLibraryItem = async () => {
    if (!libraryForm.topic.trim()) {
      toast.error('נא להזין נושא');
      return;
    }
    setIsSubmitting(true);
    try {
      const payload: Partial<HomeworkLibraryItem> = {
        topic: libraryForm.topic.trim(),
        subTopic: libraryForm.subTopic.trim(),
        description: libraryForm.description.trim(),
        level: libraryForm.level.trim(),
        grade: libraryForm.grade.trim(),
        status: libraryForm.status.trim() || 'פעיל',
        attachments: libraryForm.attachments.length > 0
          ? libraryForm.attachments.map(a => ({ id: a.id, url: a.url, filename: a.filename }))
          : editingItemId ? [] : undefined,
      };
      if (editingItemId) {
        await updateHomeworkLibraryItem(editingItemId, payload);
        toast.success('המשימה עודכנה בהצלחה');
      } else {
        await createHomeworkLibraryItem(payload);
        toast.success('המשימה נוספה לספריה בהצלחה');
      }
      // Reload library
      const freshLib = await getHomeworkLibrary();
      setLibrary(freshLib);
      setShowLibraryModal(false);
      setEditingItemId(null);
      setLibraryForm(EMPTY_LIBRARY_FORM);
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteLibraryItem = async (id: string) => {
    setIsSubmitting(true);
    try {
      await deleteHomeworkLibraryItem(id);
      toast.success('המשימה נמחקה מהספריה');
      // Reload library
      const freshLib = await getHomeworkLibrary();
      setLibrary(freshLib);
      setDeleteConfirmId(null);
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─── File upload handlers ────────────────────────────────────────────────

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      const newAttachments: AttachmentInput[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`הקובץ ${file.name} גדול מדי (מקסימום 10MB)`);
          continue;
        }
        const result = await nexusApi.uploadTmpFile(file);
        newAttachments.push({
          url: result.url,
          filename: file.name,
          isNew: true,
        });
      }
      if (newAttachments.length > 0) {
        setLibraryForm(prev => ({
          ...prev,
          attachments: [...prev.attachments, ...newAttachments],
        }));
        toast.success(`${newAttachments.length} ${newAttachments.length === 1 ? 'קובץ הועלה' : 'קבצים הועלו'} בהצלחה`);
      }
    } catch (err) {
      toast.error('שגיאה בהעלאת הקובץ: ' + parseApiError(err));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const removeAttachment = (index: number) => {
    setLibraryForm(prev => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index),
    }));
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    handleFileUpload(e.dataTransfer.files);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      assigned: 'bg-blue-50 text-blue-600 border-blue-100',
      done: 'bg-amber-50 text-amber-600 border-amber-100',
      reviewed: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    };
    const labels: Record<string, string> = {
      assigned: 'הוקצה',
      done: 'הוגש',
      reviewed: 'נבדק',
    };
    return (
      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase border ${styles[status]}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* View Toggles */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
          <button 
            onClick={() => setActiveView('assignments')}
            className={`px-8 py-2.5 rounded-xl text-sm font-black transition-all ${activeView === 'assignments' ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'text-slate-400 hover:bg-slate-50'}`}
          >
            משימות פעילות
          </button>
          <button 
            onClick={() => setActiveView('library')}
            className={`px-8 py-2.5 rounded-xl text-sm font-black transition-all ${activeView === 'library' ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'text-slate-400 hover:bg-slate-50'}`}
          >
            ספריית תכנים
          </button>
        </div>
        <div className="flex gap-3">
          {activeView === 'library' && (
            <button 
              onClick={openCreateLibraryModal}
              className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-black text-sm hover:bg-emerald-700 transition-all shadow-lg"
            >
              + הוסף לספריה
            </button>
          )}
          <button 
            onClick={() => setShowAssignModal(true)}
            className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black text-sm hover:bg-slate-800 transition-all shadow-lg"
          >
            + הקצה שיעורי בית
          </button>
        </div>
      </div>

      {activeView === 'assignments' ? (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-400 text-[10px] font-black uppercase">
              <tr>
                <th className="px-6 py-4">תלמיד</th>
                <th className="px-6 py-4">משימה</th>
                <th className="px-6 py-4">מועד הגשה</th>
                <th className="px-6 py-4 text-center">סטטוס</th>
                <th className="px-6 py-4 text-left">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={5} className="py-20 text-center text-slate-400">טוען נתונים...</td></tr>
              ) : assignments.length > 0 ? (
                assignments.map(as => (
                  <tr key={as.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-5 font-bold text-slate-800">{as.studentName}</td>
                    <td className="px-6 py-5 text-sm text-slate-600">{as.homeworkTitle}</td>
                    <td className="px-6 py-5 text-sm font-medium text-slate-500">{as.dueDate}</td>
                    <td className="px-6 py-5 text-center">{getStatusBadge(as.status)}</td>
                    <td className="px-6 py-5 text-left">
                      <button className="p-2 hover:bg-slate-100 rounded-lg text-slate-400">✏️</button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="py-20 text-center text-slate-400">אין משימות פעילות כרגע</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading ? (
            <div className="col-span-full py-20 text-center text-slate-400">טוען נתונים...</div>
          ) : library.length > 0 ? (
            library.map(item => (
              <div key={item.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:border-blue-200 transition-all group relative">
                {/* Delete confirmation overlay */}
                {deleteConfirmId === item.id && (
                  <div className="absolute inset-0 bg-white/95 backdrop-blur-sm rounded-3xl z-10 flex flex-col items-center justify-center p-6 gap-4">
                    <div className="text-lg font-black text-slate-800">מחיקת משימה</div>
                    <p className="text-sm text-slate-500 text-center">האם למחוק את &quot;{item.topic}&quot; מהספריה?</p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        disabled={isSubmitting}
                        className="px-6 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all disabled:opacity-50"
                      >
                        ביטול
                      </button>
                      <button
                        onClick={() => handleDeleteLibraryItem(item.id)}
                        disabled={isSubmitting}
                        className="px-6 py-2.5 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition-all disabled:opacity-50"
                      >
                        {isSubmitting ? 'מוחק...' : 'מחק'}
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex justify-between items-start mb-4">
                  <div className="flex gap-2 flex-wrap">
                    <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-3 py-1 rounded-lg uppercase tracking-widest">{item.topic}</span>
                    {item.grade && <span className="bg-purple-50 text-purple-600 text-[10px] font-black px-3 py-1 rounded-lg">{item.grade}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-300 text-xs font-bold ml-2">{item.level}</span>
                    <button
                      onClick={() => openEditLibraryModal(item)}
                      className="p-1.5 rounded-lg text-slate-300 hover:text-blue-600 hover:bg-blue-50 transition-all opacity-0 group-hover:opacity-100"
                      title="ערוך"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(item.id)}
                      className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                      title="מחק"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                <h3 className="text-xl font-black text-slate-800 mb-2">{item.topic}{item.subTopic ? ` - ${item.subTopic}` : ''}</h3>
                <p className="text-sm text-slate-500 line-clamp-2 mb-6 leading-relaxed">{item.description}</p>
                {item.attachments && item.attachments.length > 0 && (
                  <div className="mb-4 flex gap-2 flex-wrap">
                    {item.attachments.map((att, i) => (
                      <a key={i} href={att.url} target="_blank" rel="noopener noreferrer" className="text-xs bg-slate-50 text-blue-600 px-3 py-1 rounded-lg hover:bg-blue-50 transition-colors">
                        📎 {att.filename}
                      </a>
                    ))}
                  </div>
                )}
                <div className="pt-4 border-t border-slate-50 flex items-center justify-between">
                  <span className="text-slate-300 text-[10px] font-bold">{item.status}</span>
                  <button 
                    onClick={() => {
                      setSelectedHomework(item.id);
                      setShowAssignModal(true);
                    }}
                    className="bg-slate-50 text-slate-400 p-2 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-all shadow-sm"
                  >
                    הקצה
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full py-20 text-center">
              <div className="text-slate-300 text-5xl mb-4">📚</div>
              <p className="text-slate-400 font-bold mb-4">אין משימות בספריה עדיין</p>
              <button
                onClick={openCreateLibraryModal}
                className="bg-emerald-600 text-white px-6 py-3 rounded-2xl font-black text-sm hover:bg-emerald-700 transition-all shadow-lg"
              >
                + הוסף משימה ראשונה
              </button>
            </div>
          )}
        </div>
      )}

      {/* Assign Side Panel */}
      <AppSidePanel
        open={showAssignModal}
        onOpenChange={setShowAssignModal}
        title="הקצאת משימה חדשה"
        width={480}
        loading={isSubmitting}
        footer={
          <div className="flex gap-4 w-full">
            <button
              type="button"
              onClick={() => setShowAssignModal(false)}
              disabled={isSubmitting}
              className="px-8 py-4 bg-slate-50 text-slate-400 rounded-2xl font-bold hover:bg-slate-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={() => handleAssign()}
              disabled={isSubmitting || !selectedHomework || !selectedStudent || !dueDate}
              className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'שומר...' : 'הקצה משימה'}
            </button>
          </div>
        }
      >
        <form onSubmit={handleAssign} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-black text-slate-400 uppercase mr-1">בחר תלמיד</label>
            <StudentPicker
              value={selectedStudent}
              onChange={(student) => setSelectedStudent(student)}
              placeholder="חפש תלמיד לפי שם או טלפון..."
              filterActiveOnly={true}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-slate-400 uppercase mr-1">בחר משימה מהספרייה</label>
            <select 
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-4 focus:ring-blue-50 transition-all"
              value={selectedHomework}
              onChange={(e) => setSelectedHomework(e.target.value)}
              required
            >
              <option value="">בחר...</option>
              {library.map(h => <option key={h.id} value={h.id}>{h.topic}{h.subTopic ? ` - ${h.subTopic}` : ''} ({h.grade})</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-slate-400 uppercase mr-1">מועד הגשה</label>
            <input 
              type="date"
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-4 focus:ring-blue-50 transition-all"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
          </div>
        </form>
      </AppSidePanel>

      {/* Library Create/Edit Side Panel */}
      <AppSidePanel
        open={showLibraryModal}
        onOpenChange={(open) => {
          setShowLibraryModal(open);
          if (!open) {
            setEditingItemId(null);
            setLibraryForm(EMPTY_LIBRARY_FORM);
          }
        }}
        title={editingItemId ? 'עריכת משימה' : 'הוספת משימה לספריה'}
        width={520}
        loading={isSubmitting}
        footer={
          <div className="flex gap-4 w-full">
            <button
              type="button"
              onClick={() => {
                setShowLibraryModal(false);
                setEditingItemId(null);
                setLibraryForm(EMPTY_LIBRARY_FORM);
              }}
              disabled={isSubmitting}
              className="px-8 py-4 bg-slate-50 text-slate-400 rounded-2xl font-bold hover:bg-slate-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ביטול
            </button>
            <button
              type="button"
              onClick={handleSaveLibraryItem}
              disabled={isSubmitting || !libraryForm.topic.trim()}
              className="flex-1 py-4 bg-emerald-600 text-white rounded-2xl font-black shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'שומר...' : editingItemId ? 'עדכן משימה' : 'הוסף לספריה'}
            </button>
          </div>
        }
      >
        <div className="space-y-6">
          {/* Topic */}
          <div className="space-y-2">
            <label className="text-xs font-black text-slate-400 uppercase mr-1">נושא *</label>
            <input
              type="text"
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-4 focus:ring-emerald-50 transition-all"
              placeholder="למשל: אלגברה, גיאומטריה..."
              value={libraryForm.topic}
              onChange={(e) => setLibraryForm(prev => ({ ...prev, topic: e.target.value }))}
            />
          </div>

          {/* Sub Topic */}
          <div className="space-y-2">
            <label className="text-xs font-black text-slate-400 uppercase mr-1">תת נושא</label>
            <input
              type="text"
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-4 focus:ring-emerald-50 transition-all"
              placeholder="למשל: משוואות ריבועיות"
              value={libraryForm.subTopic}
              onChange={(e) => setLibraryForm(prev => ({ ...prev, subTopic: e.target.value }))}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-xs font-black text-slate-400 uppercase mr-1">תיאור</label>
            <textarea
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-4 focus:ring-emerald-50 transition-all min-h-[100px] resize-y"
              placeholder="תיאור המשימה..."
              value={libraryForm.description}
              onChange={(e) => setLibraryForm(prev => ({ ...prev, description: e.target.value }))}
            />
          </div>

          {/* Level & Grade */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-400 uppercase mr-1">רמה</label>
              <input
                type="text"
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-4 focus:ring-emerald-50 transition-all"
                placeholder="למשל: בסיסי, מתקדם"
                value={libraryForm.level}
                onChange={(e) => setLibraryForm(prev => ({ ...prev, level: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-400 uppercase mr-1">כיתה</label>
              <input
                type="text"
                className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-4 focus:ring-emerald-50 transition-all"
                placeholder="למשל: י׳, יא׳"
                value={libraryForm.grade}
                onChange={(e) => setLibraryForm(prev => ({ ...prev, grade: e.target.value }))}
              />
            </div>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <label className="text-xs font-black text-slate-400 uppercase mr-1">סטטוס</label>
            <select
              className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-4 focus:ring-emerald-50 transition-all"
              value={libraryForm.status}
              onChange={(e) => setLibraryForm(prev => ({ ...prev, status: e.target.value }))}
            >
              <option value="פעיל">פעיל</option>
              <option value="טיוטה">טיוטה</option>
              <option value="ארכיון">ארכיון</option>
            </select>
          </div>

          {/* Attachments */}
          <div className="space-y-3">
            <label className="text-xs font-black text-slate-400 uppercase mr-1">קבצים מצורפים</label>
            
            {/* Existing attachments */}
            {libraryForm.attachments.length > 0 && (
              <div className="space-y-2">
                {libraryForm.attachments.map((att, i) => (
                  <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                    <span className="text-lg">📎</span>
                    <span className="flex-1 text-sm font-bold text-slate-700 truncate">{att.filename}</span>
                    {att.isNew && (
                      <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">חדש</span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="p-1 text-slate-300 hover:text-red-500 transition-colors"
                      title="הסר קובץ"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Drop zone / Upload */}
            <div
              className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer ${
                isUploading
                  ? 'border-emerald-300 bg-emerald-50/50'
                  : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => !isUploading && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
              {isUploading ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm font-bold text-emerald-600">מעלה קבצים...</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl">
                    📤
                  </div>
                  <span className="text-sm font-bold text-slate-500">גרור קבצים לכאן או לחץ להעלאה</span>
                  <span className="text-[10px] font-bold text-slate-300">תמונות, PDF, מסמכי Word, Excel (עד 10MB)</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </AppSidePanel>
    </div>
  );
};

export default Homework;
