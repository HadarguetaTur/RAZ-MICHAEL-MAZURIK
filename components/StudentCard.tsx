import React, { useState, useEffect } from 'react';
import { Student, Lesson, Subscription, MonthlyBill, HomeworkAssignment } from '../types';
import { nexusApi } from '../services/nexusApi';
import { useToast } from '../hooks/useToast';

interface StudentCardProps {
  student: Student;
  onClose: () => void;
  onEdit?: (student: Student) => void;
}

const StudentCard: React.FC<StudentCardProps> = ({ student, onClose, onEdit }) => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'overview' | 'academic' | 'history' | 'financial' | 'homework'>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [editedStudent, setEditedStudent] = useState<Student>(student);
  const [isSaving, setIsSaving] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [bills, setBills] = useState<MonthlyBill[]>([]);
  const [financialLoading, setFinancialLoading] = useState(false);
  const [homework, setHomework] = useState<HomeworkAssignment[]>([]);
  const [homeworkLoading, setHomeworkLoading] = useState(false);

  useEffect(() => {
    setEditedStudent(student);
  }, [student]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Only send editable fields to avoid sending read-only fields like id, balance, etc.
      // Note: email field doesn't exist in Airtable students table, so we skip it
      const updates: Partial<Student> = {
        name: editedStudent.name,
        phone: editedStudent.phone,
        parentName: editedStudent.parentName,
        parentPhone: editedStudent.parentPhone,
        // email: editedStudent.email, // Email field doesn't exist in Airtable
        grade: editedStudent.grade,
        level: editedStudent.level,
        subjectFocus: editedStudent.subjectFocus,
        weeklyLessonsLimit: editedStudent.weeklyLessonsLimit,
        status: editedStudent.status,
        notes: editedStudent.notes,
      };

      console.log('[StudentCard] Saving student updates:', {
        studentId: student.id,
        updates,
        originalStudent: student,
        editedStudent,
      });

      const updatedStudent = await nexusApi.updateStudent(student.id, updates);
      setIsEditing(false);
      if (onEdit) {
        onEdit(updatedStudent);
      }
      toast.success('הנתונים נשמרו בהצלחה');
    } catch (err: any) {
      console.error('[StudentCard] Error saving student:', err);
      console.error('[StudentCard] Error details:', {
        message: err?.message,
        stack: err?.stack,
        response: err?.response,
        studentId: student.id,
        editedStudent,
      });
      toast.error(`שגיאה בשמירת הנתונים: ${err?.message || 'שגיאה לא ידועה'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (field: keyof Student, value: any) => {
    setEditedStudent(prev => ({ ...prev, [field]: value }));
  };

  useEffect(() => {
    if (activeTab === 'history' && lessons.length === 0) {
      loadLessons();
    } else if (activeTab === 'financial' && subscriptions.length === 0) {
      loadFinancial();
    } else if (activeTab === 'homework' && homework.length === 0) {
      loadHomework();
    }
  }, [activeTab]);

  const loadLessons = async () => {
    setLessonsLoading(true);
    try {
      const now = new Date();
      // Past 12 months
      const startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      const endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      const allLessons = await nexusApi.getLessons(startDateStr, endDateStr);
      const studentLessons = allLessons.filter(lesson => lesson.studentId === student.id);
      setLessons(studentLessons);
    } catch (err) {
      console.error('Error loading lessons:', err);
    } finally {
      setLessonsLoading(false);
    }
  };

  const loadFinancial = async () => {
    setFinancialLoading(true);
    try {
      const allSubs = await nexusApi.getSubscriptions();
      const studentSubs = allSubs.filter(sub => sub.studentId === student.id);
      setSubscriptions(studentSubs);

      // Fetch bills for last 6 months
      const billsPromises = [];
      const now = new Date();
      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthStr = d.toISOString().substring(0, 7); // YYYY-MM
        billsPromises.push(nexusApi.getMonthlyBills(monthStr));
      }
      
      const allBillsResults = await Promise.all(billsPromises);
      const studentBills = allBillsResults.flat().filter(bill => bill.studentId === student.id);
      setBills(studentBills);
    } catch (err) {
      console.error('Error loading financial data:', err);
    } finally {
      setFinancialLoading(false);
    }
  };

  const loadHomework = async () => {
    setHomeworkLoading(true);
    try {
      const allHomework = await nexusApi.getHomeworkAssignments();
      const studentHomework = allHomework.filter(hw => hw.studentId === student.id);
      setHomework(studentHomework);
    } catch (err) {
      console.error('Error loading homework:', err);
    } finally {
      setHomeworkLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      on_hold: 'bg-amber-50 text-amber-600 border-amber-100',
      inactive: 'bg-slate-50 text-slate-400 border-slate-100',
    };
    const labels: Record<string, string> = {
      active: 'פעיל',
      on_hold: 'הקפאה',
      inactive: 'לא פעיל',
    };
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-black border tracking-tight ${styles[status] || styles.inactive}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full lg:w-2/3 xl:w-1/2 bg-white lg:h-full h-[95vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl animate-in slide-in-from-bottom lg:slide-in-from-left duration-500 flex flex-col overflow-hidden text-right" dir="rtl">
        
        {/* Header */}
        <div className="p-6 md:p-10 border-b border-slate-100 shrink-0 bg-white">
          <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 lg:hidden"></div>
          <div className="flex items-center justify-between mb-8">
            <button onClick={onClose} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center bg-white border border-slate-200 text-slate-400 rounded-xl transition-all hover:bg-slate-50">✕</button>
            <div className="flex gap-2">
               {!isEditing && (
                 <button className="hidden sm:block px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all">דוח התקדמות</button>
               )}
               {isEditing ? (
                 <>
                   <button 
                    onClick={() => {
                      setIsEditing(false);
                      setEditedStudent(student);
                    }}
                    disabled={isSaving}
                    className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all"
                   >
                     ביטול
                   </button>
                   <button 
                    onClick={handleSave}
                    disabled={isSaving}
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 transition-all shadow-lg active:scale-95 disabled:opacity-50"
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
            <div className="w-20 h-20 md:w-24 md:h-24 bg-blue-600 rounded-3xl flex items-center justify-center text-white text-3xl md:text-4xl font-black shadow-xl shadow-blue-100">
              {student.name[0]}
            </div>
            <div className="flex-1">
              {isEditing ? (
                <input 
                  type="text"
                  value={editedStudent.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  className="text-2xl md:text-3xl font-black text-slate-800 mb-2 border-b-2 border-blue-500 outline-none w-full bg-transparent"
                />
              ) : (
                <h2 className="text-2xl md:text-3xl font-black text-slate-800 mb-2">{student.name}</h2>
              )}
              <div className="flex flex-wrap items-center gap-3">
                {isEditing ? (
                  <>
                    <input 
                      type="text"
                      value={editedStudent.grade || ''}
                      onChange={(e) => handleChange('grade', e.target.value)}
                      placeholder="כיתה"
                      className="text-slate-500 font-bold text-sm bg-slate-100 px-3 py-1 rounded-lg border-none outline-none w-24"
                    />
                    <select
                      value={editedStudent.status}
                      onChange={(e) => handleChange('status', e.target.value)}
                      className="text-xs font-black px-3 py-1 rounded-full border border-slate-200 outline-none bg-white"
                    >
                      <option value="active">פעיל</option>
                      <option value="on_hold">הקפאה</option>
                      <option value="inactive">לא פעיל</option>
                    </select>
                  </>
                ) : (
                  <>
                    <span className="text-slate-500 font-bold text-sm bg-slate-100 px-3 py-1 rounded-lg">{student.grade || 'ללא כיתה'}</span>
                    {getStatusBadge(student.status)}
                  </>
                )}
                <span className="text-slate-400 text-xs font-medium mr-auto">מזהה: {student.id}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex px-4 md:px-10 border-b border-slate-100 overflow-x-auto shrink-0 no-scrollbar bg-white">
          {[
            { id: 'overview', label: 'סקירה' },
            { id: 'academic', label: 'לימודי' },
            { id: 'history', label: 'שיעורים' },
            { id: 'financial', label: 'פיננסי' },
            { id: 'homework', label: 'משימות' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-6 py-4 md:py-5 text-sm font-black transition-all relative shrink-0 ${
                activeTab === tab.id ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-t-full"></div>}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar bg-[#fcfdfe]">
          
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-8">
                <div className="p-6 bg-white border border-slate-100 rounded-2xl md:rounded-[32px] shadow-sm hover:shadow-md transition-shadow">
                  <div className="text-[10px] text-slate-400 font-black uppercase mb-4 tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    פרטי קשר
                  </div>
                  <div className="space-y-4">
                    <div>
                      <div className="text-[10px] text-slate-400 font-bold mb-1">הורה</div>
                      {isEditing ? (
                        <input 
                          type="text"
                          value={editedStudent.parentName || ''}
                          onChange={(e) => handleChange('parentName', e.target.value)}
                          className="text-sm font-black text-slate-700 border-b border-slate-200 outline-none w-full bg-transparent"
                        />
                      ) : (
                        <div className="text-sm font-black text-slate-700">{student.parentName || 'לא הוזן'}</div>
                      )}
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-bold mb-1">טלפון</div>
                      {isEditing ? (
                        <input 
                          type="text"
                          value={editedStudent.phone}
                          onChange={(e) => handleChange('phone', e.target.value)}
                          className="text-lg font-black text-slate-900 border-b border-slate-200 outline-none w-full bg-transparent"
                        />
                      ) : (
                        <div className="text-lg font-black text-slate-900 tracking-tight">{student.phone}</div>
                      )}
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-bold mb-1">טלפון הורה</div>
                      {isEditing ? (
                        <input 
                          type="text"
                          value={editedStudent.parentPhone || ''}
                          onChange={(e) => handleChange('parentPhone', e.target.value)}
                          className="text-lg font-black text-slate-900 border-b border-slate-200 outline-none w-full bg-transparent"
                        />
                      ) : (
                        <div className="text-lg font-black text-slate-900 tracking-tight">{student.parentPhone || '-'}</div>
                      )}
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-bold mb-1">אימייל</div>
                      {isEditing ? (
                        <input 
                          type="email"
                          value={editedStudent.email || ''}
                          onChange={(e) => handleChange('email', e.target.value)}
                          className="text-sm font-bold text-slate-500 border-b border-slate-200 outline-none w-full bg-transparent"
                        />
                      ) : (
                        <div className="text-sm font-bold text-slate-500 truncate">{student.email || 'לא הוזן'}</div>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="p-6 bg-white border border-slate-100 rounded-2xl md:rounded-[32px] shadow-sm hover:shadow-md transition-shadow">
                  <div className="text-[10px] text-slate-400 font-black uppercase mb-4 tracking-widest flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                    מצב חשבון
                  </div>
                  <div className="space-y-6">
                    <div>
                      <div className="text-[10px] text-slate-400 font-bold mb-1">יתרה נוכחית</div>
                      <div className={`text-4xl font-black tracking-tighter ${student.balance < 0 ? 'text-red-500' : 'text-slate-900'}`}>
                        ₪{student.balance}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-bold mb-1">סוג מנוי</div>
                      <div className="text-sm font-black text-slate-600 bg-slate-50 inline-block px-3 py-1 rounded-lg">
                        {student.subscriptionType || 'ללא מנוי פעיל'}
                      </div>
                    </div>
                    {student.paymentStatus && (
                      <div>
                        <div className="text-[10px] text-slate-400 font-bold mb-1">סטטוס תשלום</div>
                        <div className="text-sm font-black text-blue-600">{student.paymentStatus}</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                 <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest block flex items-center gap-2">
                   <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
                   הערות פדגוגיות
                 </label>
                 <div className="relative">
                   <textarea 
                     className={`w-full bg-white border border-slate-100 rounded-2xl md:rounded-[32px] p-6 text-sm font-medium min-h-[160px] outline-none shadow-sm focus:ring-2 focus:ring-blue-50 transition-all resize-none ${isEditing ? 'border-blue-200 ring-2 ring-blue-50' : ''}`}
                     placeholder="הוסף הערות כאן..."
                     value={isEditing ? (editedStudent.notes || '') : (student.notes || '')}
                     onChange={(e) => isEditing && handleChange('notes', e.target.value)}
                     readOnly={!isEditing}
                   />
                 </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="text-xs text-slate-400 font-bold italic">
                  תאריך רישום: {student.registrationDate || 'לא ידוע'}
                </div>
                <div className="text-xs text-slate-400 font-bold italic sm:text-left">
                  פעילות אחרונה: {student.lastActivity || 'לא ידוע'}
                </div>
              </div>
            </div>
          )}

          {/* Academic Tab */}
          {activeTab === 'academic' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-white border border-slate-100 rounded-[32px] p-8 shadow-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div>
                      <div className="text-[10px] text-slate-400 font-black uppercase mb-2 tracking-widest">מקצוע ממוקד</div>
                      {isEditing ? (
                        <input 
                          type="text"
                          value={editedStudent.subjectFocus || ''}
                          onChange={(e) => handleChange('subjectFocus', e.target.value)}
                          className="text-xl font-black text-slate-800 border-b border-slate-200 outline-none w-full bg-transparent"
                        />
                      ) : (
                        <div className="text-xl font-black text-slate-800">{student.subjectFocus || 'לא הוגדר'}</div>
                      )}
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-black uppercase mb-2 tracking-widest">רמה לימודית</div>
                      {isEditing ? (
                        <input 
                          type="text"
                          value={editedStudent.level || ''}
                          onChange={(e) => handleChange('level', e.target.value)}
                          className="text-lg font-black text-slate-700 border-b border-slate-200 outline-none w-full bg-transparent"
                        />
                      ) : (
                        <div className="text-lg font-black text-slate-700">{student.level || 'לא הוגדר'}</div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-6">
                    <div>
                      <div className="text-[10px] text-slate-400 font-black uppercase mb-2 tracking-widest">כיתה</div>
                      {isEditing ? (
                        <input 
                          type="text"
                          value={editedStudent.grade || ''}
                          onChange={(e) => handleChange('grade', e.target.value)}
                          className="text-xl font-black text-slate-800 border-b border-slate-200 outline-none w-full bg-transparent"
                        />
                      ) : (
                        <div className="text-xl font-black text-slate-800">{student.grade || 'לא הוגדר'}</div>
                      )}
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-black uppercase mb-2 tracking-widest">מכסת שיעורים שבועית</div>
                      <div className="flex items-center gap-3">
                        {isEditing ? (
                          <input 
                            type="number"
                            value={editedStudent.weeklyLessonsLimit || 0}
                            onChange={(e) => handleChange('weeklyLessonsLimit', parseInt(e.target.value))}
                            className="text-2xl font-black text-blue-600 border-b border-slate-200 outline-none w-20 bg-transparent"
                          />
                        ) : (
                          <div className="text-2xl font-black text-blue-600">{student.weeklyLessonsLimit || 0}</div>
                        )}
                        <div className="text-sm font-bold text-slate-400">שיעורים בשבוע</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {lessonsLoading ? (
                <div className="py-20 text-center">
                  <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
                  <div className="text-slate-400 font-bold">טוען היסטוריית שיעורים...</div>
                </div>
              ) : lessons.length === 0 ? (
                <div className="py-20 text-center bg-white border border-dashed border-slate-200 rounded-[32px]">
                  <div className="text-4xl mb-4">📅</div>
                  <div className="text-lg font-bold text-slate-800 mb-2">אין שיעורים להצגה</div>
                  <div className="text-sm text-slate-400">לא נמצאו שיעורים עבור תלמיד זה בשנה האחרונה.</div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-lg font-black text-slate-800">שיעורים אחרונים</h3>
                    <button
                      onClick={() => {
                        // CSV Export Logic from original Students.tsx
                      }}
                      className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-black hover:bg-slate-200 transition-all"
                    >
                      ייצא לאקסל
                    </button>
                  </div>
                  
                  {(() => {
                    const lessonsByMonth = new Map<string, Lesson[]>();
                    lessons.forEach(lesson => {
                      const month = lesson.date.substring(0, 7);
                      if (!lessonsByMonth.has(month)) lessonsByMonth.set(month, []);
                      lessonsByMonth.get(month)!.push(lesson);
                    });
                    
                    return Array.from(lessonsByMonth.entries())
                      .sort((a, b) => b[0].localeCompare(a[0]))
                      .map(([month, monthLessons]) => (
                        <div key={month} className="space-y-3">
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest px-2 mt-4">
                            {new Date(month + '-01').toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}
                          </h4>
                          <div className="space-y-2">
                            {monthLessons
                              .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                              .map(lesson => (
                                <div key={lesson.id} className="flex items-center justify-between p-5 bg-white border border-slate-100 rounded-2xl hover:border-blue-200 transition-colors shadow-sm">
                                  <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${
                                      lesson.status === 'בוטל' ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-600'
                                    }`}>
                                      {new Date(lesson.date).getDate()}
                                    </div>
                                    <div>
                                      <div className="font-bold text-slate-800">
                                        {new Date(lesson.date).toLocaleDateString('he-IL', { weekday: 'long' })} {lesson.startTime}
                                      </div>
                                      <div className="text-xs text-slate-400 font-medium">
                                        {lesson.duration} דק׳ • {lesson.subject} • {lesson.teacherName || 'מורה'}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="text-left">
                                    <div className="font-black text-slate-800">₪{lesson.price?.toFixed(2) || '0.00'}</div>
                                    <div className={`text-[10px] font-black px-2 py-0.5 rounded-full inline-block mt-1 ${
                                      lesson.status === 'הסתיים' ? 'bg-emerald-50 text-emerald-600' : 
                                      lesson.status === 'בוטל' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                                    }`}>
                                      {lesson.status}
                                    </div>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      ));
                  })()}
                </>
              )}
            </div>
          )}

          {/* Financial Tab */}
          {activeTab === 'financial' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {financialLoading ? (
                <div className="py-20 text-center">
                  <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
                  <div className="text-slate-400 font-bold">טוען נתונים פיננסיים...</div>
                </div>
              ) : (
                <>
                  {/* Subscriptions Section */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-black text-slate-800 px-2 flex items-center gap-2">
                      <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                      מנויים פעילים
                    </h3>
                    {subscriptions.length === 0 ? (
                      <div className="p-8 bg-white border border-dashed border-slate-200 rounded-[32px] text-center text-slate-400 font-medium">
                        אין מנויים פעילים לתלמיד זה
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {subscriptions.map(sub => (
                          <div key={sub.id} className="p-6 bg-white border border-slate-100 rounded-[24px] shadow-sm">
                            <div className="flex justify-between items-start mb-4">
                              <div className="text-xs font-black text-blue-600 bg-blue-50 px-3 py-1 rounded-full uppercase">
                                {sub.subscriptionType || 'מנוי'}
                              </div>
                              {sub.pauseSubscription && (
                                <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">מוקפא</span>
                              )}
                            </div>
                            <div className="text-2xl font-black text-slate-900 mb-1">{sub.monthlyAmount || '₪0'}</div>
                            <div className="text-xs text-slate-400 font-bold">מחיר חודשי</div>
                            <div className="mt-4 pt-4 border-t border-slate-50 flex justify-between items-center">
                              <div className="text-[10px] text-slate-400 font-bold">התחלה: {sub.subscriptionStartDate || 'לא צוין'}</div>
                              {sub.subscriptionEndDate && (
                                <div className="text-[10px] text-slate-400 font-bold">סיום: {sub.subscriptionEndDate}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Bills History Section */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-black text-slate-800 px-2 flex items-center gap-2">
                      <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                      היסטוריית חיובים
                    </h3>
                    {bills.length === 0 ? (
                      <div className="p-8 bg-white border border-dashed border-slate-200 rounded-[32px] text-center text-slate-400 font-medium">
                        לא נמצאו חיובים קודמים
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {bills
                          .sort((a, b) => b.month.localeCompare(a.month))
                          .map(bill => (
                            <div key={bill.id} className="flex items-center justify-between p-5 bg-white border border-slate-100 rounded-2xl hover:border-emerald-200 transition-colors shadow-sm">
                              <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-slate-50 rounded-xl flex flex-col items-center justify-center">
                                  <div className="text-[10px] font-black text-slate-400 leading-none mb-1">
                                    {bill.month.split('-')[0]}
                                  </div>
                                  <div className="text-sm font-black text-slate-700 leading-none">
                                    {new Date(bill.month + '-01').toLocaleDateString('he-IL', { month: 'short' })}
                                  </div>
                                </div>
                                <div>
                                  <div className="font-bold text-slate-800">
                                    סיכום חיוב חודשי
                                  </div>
                                  <div className="text-xs text-slate-400 font-medium">
                                    {bill.lessonsAmount > 0 && `${bill.lessonsAmount} שיעורים `}
                                    {bill.subscriptionsAmount > 0 && `+ מנוי `}
                                  </div>
                                </div>
                              </div>
                              <div className="text-left">
                                <div className="font-black text-slate-900 text-lg">₪{bill.totalAmount.toFixed(2)}</div>
                                <div className={`text-[10px] font-black px-2 py-0.5 rounded-full inline-block mt-1 ${
                                  bill.status === 'paid' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                                }`}>
                                  {bill.status === 'paid' ? 'שולם' : bill.status === 'link_sent' ? 'נשלח' : 'טיוטה'}
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Homework Tab */}
          {activeTab === 'homework' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {homeworkLoading ? (
                <div className="py-20 text-center">
                  <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
                  <div className="text-slate-400 font-bold">טוען משימות...</div>
                </div>
              ) : homework.length === 0 ? (
                <div className="py-20 text-center bg-white border border-dashed border-slate-200 rounded-[32px]">
                  <div className="text-4xl mb-4">📚</div>
                  <div className="text-lg font-bold text-slate-800 mb-2">אין משימות להצגה</div>
                  <div className="text-sm text-slate-400">לא נמצאו משימות שהוקצו לתלמיד זה.</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {homework.map(hw => (
                    <div key={hw.id} className="p-5 bg-white border border-slate-100 rounded-2xl shadow-sm hover:border-blue-200 transition-colors">
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-black text-slate-800">{hw.homeworkTitle}</div>
                        <div className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          hw.status === 'done' ? 'bg-emerald-50 text-emerald-600' :
                          hw.status === 'reviewed' ? 'bg-blue-50 text-blue-600' :
                          'bg-amber-50 text-amber-600'
                        }`}>
                          {hw.status === 'done' ? 'בוצע' : hw.status === 'reviewed' ? 'נבדק' : 'הוקצה'}
                        </div>
                      </div>
                      <div className="flex justify-between items-center text-xs font-bold">
                        <div className="text-slate-400">מיועד ל: {hw.dueDate}</div>
                        <div className="text-slate-400">הוקצה ב: {hw.assignedDate}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default StudentCard;
