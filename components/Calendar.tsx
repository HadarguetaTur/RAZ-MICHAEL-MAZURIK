
import React, { useState, useEffect, useMemo } from 'react';
import { Lesson, LessonStatus, Teacher, Student, LessonType } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';

const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 08:00 to 21:00
const DAYS_HEBREW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const Calendar: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'day' | 'agenda' | 'recurring'>(window.innerWidth < 768 ? 'agenda' : 'week');
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editState, setEditState] = useState<Partial<Lesson & { endDate?: string }>>({ studentIds: [], lessonType: 'private' });
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const weekDates = useMemo(() => {
    const dates = [];
    const firstDay = new Date(currentDate);
    firstDay.setDate(currentDate.getDate() - currentDate.getDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(firstDay);
      d.setDate(firstDay.getDate() + i);
      dates.push(d);
    }
    return dates;
  }, [currentDate]);

  const currentMonthDisplay = useMemo(() => {
    return currentDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  }, [currentDate]);

  const startDate = weekDates[0].toISOString().split('T')[0];
  const endDateStr = weekDates[6].toISOString().split('T')[0];

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [lessonsData, teachersData, studentsData] = await Promise.all([
          nexusApi.getLessons(startDate, endDateStr),
          nexusApi.getTeachers(),
          nexusApi.getStudents()
        ]);
        setLessons(lessonsData);
        setTeachers(teachersData);
        setStudents(studentsData);
      } catch (err: any) {
        console.error(parseApiError(err));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [startDate, endDateStr]);

  const filteredLessons = useMemo(() => {
    return lessons.filter(l => {
      const matchesSearch = l.studentName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRecurring = viewMode !== 'recurring' || l.lessonType === 'recurring' || l.isPrivate === false; 
      return matchesSearch && matchesRecurring;
    });
  }, [lessons, searchTerm, viewMode]);

  const checkConflict = (date: string, startTime: string, duration: number, excludeId?: string) => {
    const startNum = parseInt(startTime.split(':')[0]) * 60 + parseInt(startTime.split(':')[1]);
    const endNum = startNum + duration;
    return lessons.some(l => {
      if (l.id === excludeId || l.status === LessonStatus.CANCELLED) return false;
      if (l.date !== date) return false;
      const lStart = parseInt(l.startTime.split(':')[0]) * 60 + parseInt(l.startTime.split(':')[1]);
      const lEnd = lStart + l.duration;
      return (startNum < lEnd && endNum > lStart);
    });
  };

  const handleSave = async () => {
    const ids = editState.studentIds || [];
    if (ids.length === 0 || !editState.date || !editState.startTime) {
      alert('נא למלא את כל שדות החובה ולבחור לפחות תלמיד אחד');
      return;
    }
    
    if (editState.lessonType === 'recurring' && !editState.endDate) {
      alert('נא להזין תאריך סיום לשיעור מחזורי');
      return;
    }

    if (checkConflict(editState.date!, editState.startTime!, editState.duration || 60, selectedLesson?.id)) {
      alert('קיימת התנגשות עם שיעור אחר בשעה זו');
      return;
    }

    setIsSaving(true);
    try {
      const selectedStudentData = students.filter(s => ids.includes(s.id));
      const names = selectedStudentData.map(s => s.name).join(', ');

      if (selectedLesson) {
        const updated = await nexusApi.updateLesson(selectedLesson.id, {
          ...editState,
          studentName: names,
          studentId: ids[0]
        });
        setLessons(prev => prev.map(l => l.id === selectedLesson.id ? updated : l));
      } else {
        const newLesson: Lesson = {
          id: Math.random().toString(36).substr(2, 9),
          studentId: ids[0],
          studentIds: ids,
          studentName: names,
          date: editState.date!,
          startTime: editState.startTime!,
          duration: editState.duration || 60,
          status: LessonStatus.SCHEDULED,
          subject: editState.subject || 'מתמטיקה',
          isChargeable: true,
          isPrivate: editState.lessonType === 'private',
          lessonType: editState.lessonType || 'private',
          notes: editState.notes || ''
        };
        setLessons(prev => [...prev, newLesson]);
      }
      setSelectedLesson(null);
      setIsCreating(false);
    } catch (err: any) {
      alert(parseApiError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedLesson) return;
    if (!confirm('האם אתה בטוח שברצונך לבטל את השיעור?')) return;
    setIsSaving(true);
    try {
      const updated = await nexusApi.updateLesson(selectedLesson.id, { status: LessonStatus.CANCELLED });
      setLessons(prev => prev.map(l => l.id === selectedLesson.id ? updated : l));
      setSelectedLesson(null);
    } catch (err: any) {
      alert(parseApiError(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSlotClick = (date: Date, hour: number) => {
    const timeStr = `${hour < 10 ? '0' : ''}${hour}:00`;
    setEditState({
      date: date.toISOString().split('T')[0],
      startTime: timeStr,
      duration: 60,
      status: LessonStatus.SCHEDULED,
      subject: 'מתמטיקה',
      lessonType: 'private',
      studentIds: [],
      notes: ''
    });
    setIsCreating(true);
    setSelectedLesson(null);
  };

  const toggleStudentSelection = (id: string) => {
    setEditState(prev => {
      const current = prev.studentIds || [];
      const isSelected = current.includes(id);
      if (prev.lessonType === 'private') {
        return { ...prev, studentIds: [id] };
      }
      return {
        ...prev,
        studentIds: isSelected ? current.filter(sid => sid !== id) : [...current, id]
      };
    });
  };

  const navigate = (direction: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(currentDate.getDate() + direction * (viewMode === 'day' ? 1 : 7));
    setCurrentDate(newDate);
  };

  return (
    <div className="flex flex-col h-full gap-6 animate-in fade-in duration-500 w-full overflow-visible">
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col lg:flex-row items-center justify-between gap-6 w-full">
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto">
          <button 
            onClick={() => {
              setEditState({ date: new Date().toISOString().split('T')[0], startTime: '10:00', duration: 60, lessonType: 'private', studentIds: [], notes: '', subject: 'מתמטיקה' });
              setIsCreating(true);
              setSelectedLesson(null);
            }}
            className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-bold text-sm shadow-md hover:bg-blue-700 transition-all w-full sm:w-auto text-center"
          >
            שיעור חדש
          </button>
          <div className="flex items-center bg-slate-50 p-1.5 rounded-2xl border border-slate-100 w-full sm:w-auto">
            <button onClick={() => navigate(-1)} className="px-3 py-2 hover:bg-white rounded-xl transition-all text-slate-400">←</button>
            <button onClick={() => setCurrentDate(new Date())} className="px-6 py-2 text-slate-700 font-bold text-sm rounded-xl">היום</button>
            <button onClick={() => navigate(1)} className="px-3 py-2 hover:bg-white rounded-xl transition-all text-slate-400">→</button>
          </div>
          <div className="hidden lg:block h-8 w-px bg-slate-100 mx-2"></div>
          <div className="text-lg font-black text-slate-800 shrink-0">
            {currentMonthDisplay}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:flex-1 lg:max-w-xl">
          <div className="relative w-full">
            <input 
              type="text" 
              placeholder="חפש תלמיד..."
              className="w-full pr-12 pl-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:bg-white outline-none transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <select 
            className="w-full sm:w-40 px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all"
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as any)}
          >
            <option value="agenda">כל השיעורים</option>
            <option value="recurring">שיעורים מחזוריים</option>
            <option value="day">יום</option>
            <option value="week">שבוע</option>
          </select>
        </div>
      </div>

      <div className="flex-1 bg-white rounded-[32px] border border-slate-200 shadow-sm flex flex-col w-full overflow-hidden">
        {(viewMode === 'agenda' || viewMode === 'recurring') ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            {weekDates.map((date, dayIdx) => {
              const dayLessons = filteredLessons.filter(l => new Date(l.date).toDateString() === date.toDateString());
              if (dayLessons.length === 0) return null;
              return (
                <div key={dayIdx} className="space-y-3">
                  <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest pt-2 px-2">
                    {DAYS_HEBREW[date.getDay()]}, {date.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
                  </h3>
                  {dayLessons.map(lesson => (
                    <button
                      key={lesson.id}
                      onClick={() => { setSelectedLesson(lesson); setEditState({ ...lesson, studentIds: lesson.studentIds || [lesson.studentId] }); }}
                      className={`w-full bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between text-right hover:border-blue-200 transition-all ${lesson.status === LessonStatus.CANCELLED ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-center gap-6">
                         <div className="w-12 h-12 bg-slate-50 text-slate-900 rounded-xl flex items-center justify-center border border-slate-100">
                            <span className="text-xs font-bold">{lesson.startTime}</span>
                         </div>
                         <div className="text-right">
                            <div className="font-bold text-slate-900">{lesson.studentName}</div>
                            <div className="text-[10px] font-medium text-slate-400">{lesson.subject} • {lesson.duration} דק׳ • {
                              lesson.lessonType === 'private' ? 'פרטי' : 
                              lesson.lessonType === 'pair' ? 'זוגי' : 
                              lesson.lessonType === 'recurring' ? 'מחזורי' : 'קבוצתי'
                            }</div>
                         </div>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-[10px] font-bold border ${
                        lesson.status === LessonStatus.COMPLETED ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                        lesson.status === LessonStatus.CANCELLED ? 'bg-slate-50 text-slate-400 border-slate-200' : 
                        'bg-blue-50 text-blue-600 border-blue-100'
                      }`}>
                        {lesson.status}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex flex-col w-full overflow-x-auto overflow-y-hidden custom-scrollbar">
            <div className={`flex border-b border-slate-100 bg-slate-50/30 sticky top-0 z-20 shrink-0 ${viewMode === 'week' ? 'min-w-[800px] md:min-w-0' : 'min-w-full'}`}>
              <div className="w-16 md:w-20 border-l border-slate-100 shrink-0"></div>
              {(viewMode === 'day' ? [currentDate] : weekDates).map((date, idx) => (
                <div key={idx} className={`flex-1 py-4 text-center border-l border-slate-100 last:border-l-0 ${date.toDateString() === new Date().toDateString() ? 'bg-blue-50/30' : ''}`}>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{DAYS_HEBREW[date.getDay()]}</div>
                  <div className={`text-lg font-extrabold ${date.toDateString() === new Date().toDateString() ? 'text-blue-600' : 'text-slate-900'}`}>
                    {date.getDate()}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto relative custom-scrollbar">
              <div className={`flex ${viewMode === 'week' ? 'min-w-[800px] md:min-w-0' : 'min-w-full'}`}>
                <div className="w-16 md:w-20 bg-slate-50/10 sticky right-0 z-10 border-l border-slate-100 shrink-0">
                  {HOURS.map(hour => (
                    <div key={hour} className="h-24 text-[10px] text-slate-400 font-bold text-center pt-3 border-b border-slate-100/50">
                      {hour}:00
                    </div>
                  ))}
                </div>
                {(viewMode === 'day' ? [currentDate] : weekDates).map((date, dayIdx) => (
                  <div key={dayIdx} className="flex-1 border-l border-slate-100 last:border-l-0 relative min-h-[1344px]">
                    {HOURS.map(hour => (
                      <div 
                        key={hour} 
                        className="h-24 border-b border-slate-100/30 cursor-crosshair hover:bg-slate-50/50 transition-colors"
                        onClick={() => handleSlotClick(date, hour)}
                      ></div>
                    ))}
                    {filteredLessons
                      .filter(l => new Date(l.date).toDateString() === date.toDateString() && l.status !== LessonStatus.CANCELLED)
                      .map(lesson => {
                        const hour = parseInt(lesson.startTime.split(':')[0]);
                        const mins = parseInt(lesson.startTime.split(':')[1]);
                        const topOffset = (hour - 8) * 96 + (mins / 60) * 96;
                        const height = (lesson.duration / 60) * 96;
                        return (
                          <button
                            key={lesson.id}
                            onClick={() => { setSelectedLesson(lesson); setEditState({ ...lesson, studentIds: lesson.studentIds || [lesson.studentId] }); }}
                            style={{ top: `${topOffset}px`, height: `${height}px` }}
                            className={`absolute left-1.5 right-1.5 rounded-2xl p-4 text-right border-r-4 shadow-sm border border-slate-200 flex flex-col justify-between overflow-hidden bg-white hover:z-10 transition-all ${
                              lesson.lessonType === 'recurring' ? 'border-indigo-600' : 
                              lesson.lessonType === 'group' ? 'border-amber-600' : 'border-blue-600'
                            }`}
                          >
                            <div className="font-bold text-sm leading-tight text-slate-900 line-clamp-2">{lesson.studentName}</div>
                            <div className="hidden sm:flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
                               <div className="text-[10px] font-bold text-slate-400">{lesson.startTime}</div>
                               <div className="text-[10px] font-bold bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full">{lesson.subject}</div>
                            </div>
                          </button>
                        );
                      })
                    }
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {(selectedLesson || isCreating) && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[2px]" onClick={() => { setSelectedLesson(null); setIsCreating(false); }}></div>
          <div className="relative w-full lg:w-[500px] bg-white lg:h-full h-[95vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-left duration-300">
            <div className="p-8 border-b border-slate-100 relative shrink-0">
               <button onClick={() => { setSelectedLesson(null); setIsCreating(false); }} className="absolute left-8 top-8 p-2 text-slate-300 hover:text-slate-900 transition-colors">
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
               </button>
               <h3 className="font-bold text-2xl text-slate-900 mt-6">{isCreating ? 'קביעת שיעור חדש' : 'פרטי שיעור'}</h3>
            </div>

            <div className="flex-1 p-8 space-y-8 overflow-y-auto custom-scrollbar">
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">סוג שיעור</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['private', 'pair', 'group', 'recurring'] as LessonType[]).map(type => (
                    <button 
                      key={type}
                      type="button"
                      onClick={() => setEditState(p => ({ ...p, lessonType: type, studentIds: type === 'private' ? (p.studentIds?.slice(0, 1)) : p.studentIds }))}
                      className={`py-2 text-[10px] font-bold border rounded-xl transition-all ${
                        editState.lessonType === type ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      {type === 'private' ? 'פרטי' : type === 'pair' ? 'זוגי' : type === 'group' ? 'קבוצתי' : 'מחזורי'}
                    </button>
                  ))}
                </div>
              </div>

              {editState.lessonType === 'recurring' && (
                <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl space-y-4">
                  <div className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">הגדרות מחזוריות</div>
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">סוג שיעור במחזור</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['private', 'pair', 'group'].map(t => (
                        <button 
                          key={t}
                          type="button"
                          onClick={() => setEditState(p => ({ ...p, isPrivate: t === 'private' }))}
                          className={`py-2 text-[10px] font-bold border rounded-xl transition-all ${
                            (t === 'private' && editState.isPrivate) || (t !== 'private' && !editState.isPrivate) ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-100 text-slate-400'
                          }`}
                        >
                          {t === 'private' ? 'פרטי' : t === 'pair' ? 'זוגי' : 'קבוצתי'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">תאריך סיום (עד...)</label>
                    <input 
                      type="date" 
                      className="w-full bg-white border border-slate-200 rounded-xl p-3 font-bold outline-none" 
                      value={editState.endDate || ''} 
                      onChange={(e) => setEditState(p => ({ ...p, endDate: e.target.value }))} 
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {editState.lessonType === 'private' ? 'תלמיד' : 'תלמידים (בחירה מרובה)'}
                </label>
                <div className="max-h-[200px] overflow-y-auto border border-slate-100 rounded-2xl p-2 bg-slate-50 space-y-1 custom-scrollbar">
                  {students.map(s => {
                    const isSelected = editState.studentIds?.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleStudentSelection(s.id)}
                        className={`w-full flex items-center justify-between p-3 rounded-xl transition-all text-right ${
                          isSelected ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <span className="font-bold text-sm">{s.name}</span>
                        <span className={`text-[10px] font-medium ${isSelected ? 'text-white/70' : 'text-slate-400'}`}>{s.grade}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{editState.lessonType === 'recurring' ? 'תאריך התחלה' : 'תאריך'}</label>
                  <input type="date" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" value={editState.date || ''} onChange={(e) => setEditState(p => ({ ...p, date: e.target.value }))} />
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">שעת התחלה</label>
                  <input type="time" step="900" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" value={editState.startTime || ''} onChange={(e) => setEditState(p => ({ ...p, startTime: e.target.value }))} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">משך (דקות)</label>
                  <select className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" value={editState.duration || 60} onChange={(e) => setEditState(p => ({ ...p, duration: parseInt(e.target.value) }))}>
                    <option value={30}>30 דק׳</option>
                    <option value={45}>45 דק׳</option>
                    <option value={60}>60 דק׳</option>
                    <option value={90}>90 דק׳</option>
                    <option value={120}>120 דק׳</option>
                  </select>
                </div>
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">מקצוע</label>
                  <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" value={editState.subject || ''} onChange={(e) => setEditState(p => ({ ...p, subject: e.target.value }))} />
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">הערות לשיעור</label>
                <textarea className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-medium min-h-[120px] outline-none focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" placeholder="הערות..." value={editState.notes || ''} onChange={(e) => setEditState(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex flex-col gap-3 shrink-0">
              <button disabled={isSaving} onClick={handleSave} className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg hover:bg-blue-700 transition-all flex items-center justify-center">
                {isSaving ? 'מעבד...' : (isCreating ? 'צור שיעור' : 'שמור שינויים')}
              </button>
              {!isCreating && (
                <button disabled={isSaving} onClick={handleCancel} className="w-full py-4 text-rose-600 font-bold hover:bg-rose-50 rounded-2xl transition-all">בטל שיעור</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Calendar;
