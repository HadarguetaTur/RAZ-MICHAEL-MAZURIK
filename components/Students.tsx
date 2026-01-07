
import React, { useState, useEffect, useMemo } from 'react';
import { Student, Lesson, LessonStatus } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';

const Students: React.FC = () => {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [profileTab, setProfileTab] = useState<'overview' | 'history' | 'homework' | 'tests'>('overview');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const studentsData = await nexusApi.getStudents();
      setStudents(studentsData);
    } catch (err) {
      alert(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const filteredStudents = useMemo(() => {
    return students.filter(s => 
      s.name.includes(searchTerm) || 
      (s.parentName && s.parentName.includes(searchTerm)) || 
      s.phone.includes(searchTerm)
    );
  }, [students, searchTerm]);

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
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border tracking-tight ${styles[status] || styles.inactive}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div className="space-y-6 md:space-y-10 animate-in fade-in duration-700 pb-20">
      {/* Directory Control */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6">
        <div className="relative flex-1 max-w-lg">
          <input
            type="text"
            placeholder="חפש תלמיד או הורה..."
            className="w-full pr-12 pl-4 py-3.5 md:py-4 rounded-xl md:rounded-[24px] border border-slate-200 focus:outline-none focus:ring-4 focus:ring-blue-50 transition-all bg-white font-bold"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 text-xl">🔍</span>
        </div>
        <button className="bg-blue-600 text-white px-8 md:px-10 py-3.5 md:py-4 rounded-xl md:rounded-[22px] font-black text-sm hover:bg-blue-700 transition-all shadow-lg active:scale-95">
          + הוסף תלמיד חדש
        </button>
      </div>

      <div className="bg-white rounded-2xl md:rounded-[40px] border border-slate-200 shadow-sm overflow-hidden">
        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50/50 text-slate-400 text-[11px] font-black uppercase border-b border-slate-100">
              <tr>
                <th className="px-10 py-6">תלמיד</th>
                <th className="px-10 py-6">הורה</th>
                <th className="px-10 py-6">סטטוס</th>
                <th className="px-10 py-6">יתרה</th>
                <th className="px-10 py-6 text-left">ניהול</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={5} className="py-20 text-center text-slate-300 font-bold">טוען...</td></tr>
              ) : filteredStudents.map(student => (
                <tr key={student.id} className="hover:bg-blue-50/30 transition-all cursor-pointer" onClick={() => setSelectedStudent(student)}>
                  <td className="px-10 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600 font-black">
                        {student.name[0]}
                      </div>
                      <div>
                        <div className="font-black text-slate-800">{student.name}</div>
                        <div className="text-[10px] text-slate-400 font-black uppercase tracking-tighter mt-0.5">{student.grade}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-5 text-sm font-bold text-slate-600">{student.parentName}</td>
                  <td className="px-10 py-5">{getStatusBadge(student.status)}</td>
                  <td className="px-10 py-5 font-black text-slate-800">₪{student.balance}</td>
                  <td className="px-10 py-5 text-left">
                    <button className="w-10 h-10 bg-slate-50 text-slate-400 rounded-xl hover:bg-white hover:shadow-md transition-all">👁️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile View Cards */}
        <div className="md:hidden divide-y divide-slate-50">
          {loading ? (
            <div className="py-10 text-center text-slate-300">טוען...</div>
          ) : filteredStudents.map(student => (
            <div key={student.id} className="p-4 flex items-center justify-between active:bg-slate-50 transition-colors" onClick={() => setSelectedStudent(student)}>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center font-black">
                  {student.name[0]}
                </div>
                <div className="text-right">
                  <div className="font-black text-slate-800 text-base">{student.name}</div>
                  <div className="text-[10px] font-bold text-slate-400">{student.grade} • {student.parentName}</div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                 {getStatusBadge(student.status)}
                 <div className="text-sm font-black text-slate-800">₪{student.balance}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Profile Sidebar / Bottom Sheet */}
      {selectedStudent && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setSelectedStudent(null)}></div>
          <div className="relative w-full lg:w-2/3 xl:w-1/2 bg-white lg:h-full h-[95vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl animate-in slide-in-from-bottom lg:slide-in-from-left duration-500 flex flex-col overflow-hidden">
            <div className="p-6 md:p-10 border-b border-slate-100 shrink-0">
              <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 lg:hidden"></div>
              <div className="flex items-center justify-between mb-8">
                <button onClick={() => setSelectedStudent(null)} className="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center bg-white border border-slate-200 text-slate-400 rounded-xl transition-all">✕</button>
                <div className="flex gap-2">
                   <button className="hidden sm:block px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600">דוח התקדמות</button>
                   <button className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black">עריכה</button>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="w-20 h-20 md:w-24 md:h-24 bg-blue-600 rounded-3xl flex items-center justify-center text-white text-3xl md:text-4xl font-black">
                  {selectedStudent.name[0]}
                </div>
                <div>
                  <h2 className="text-2xl md:text-3xl font-black text-slate-800">{selectedStudent.name}</h2>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-slate-400 font-bold text-xs uppercase">{selectedStudent.grade}</span>
                    {getStatusBadge(selectedStudent.status)}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex px-4 md:px-10 border-b border-slate-100 overflow-x-auto shrink-0 no-scrollbar">
              {['overview', 'history', 'homework'].map(tab => (
                <button
                  key={tab}
                  onClick={() => setProfileTab(tab as any)}
                  className={`px-6 py-4 md:py-5 text-sm font-black transition-all relative shrink-0 ${
                    profileTab === tab ? 'text-blue-600' : 'text-slate-400'
                  }`}
                >
                  {tab === 'overview' ? 'סקירה' : tab === 'history' ? 'שיעורים' : 'משימות'}
                  {profileTab === tab && <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-t-full"></div>}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-10 custom-scrollbar bg-[#fcfdfe]">
              {profileTab === 'overview' && (
                <div className="space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-8">
                    <div className="p-6 bg-white border border-slate-100 rounded-2xl md:rounded-[32px] shadow-sm">
                      <div className="text-[10px] text-slate-400 font-black uppercase mb-4 tracking-widest">פרטי קשר</div>
                      <div className="space-y-3">
                        <div className="text-sm font-bold text-slate-400">הורה: {selectedStudent.parentName}</div>
                        <div className="text-lg font-black text-slate-800">{selectedStudent.phone}</div>
                        <div className="text-xs font-bold text-slate-500 truncate">{selectedStudent.email}</div>
                      </div>
                    </div>
                    <div className="p-6 bg-white border border-slate-100 rounded-2xl md:rounded-[32px] shadow-sm">
                      <div className="text-[10px] text-slate-400 font-black uppercase mb-4 tracking-widest">פיננסי</div>
                      <div className="space-y-4">
                        <div className="text-3xl font-black text-slate-900 tracking-tighter">₪{selectedStudent.balance}</div>
                        <div className="text-xs font-black text-slate-400 uppercase">{selectedStudent.subscriptionType}</div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                     <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest block">הערות פדגוגיות</label>
                     <textarea 
                       className="w-full bg-white border border-slate-100 rounded-2xl md:rounded-[32px] p-6 text-sm font-medium min-h-[140px] outline-none shadow-sm"
                       defaultValue={selectedStudent.notes || 'אין הערות רשומות.'}
                     />
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 md:p-10 border-t border-slate-100 bg-white flex gap-3 shrink-0 pb-10 md:pb-10">
               <button className="flex-1 py-4 md:py-5 bg-emerald-600 text-white rounded-2xl font-black shadow-lg shadow-emerald-100 flex items-center justify-center gap-3 active:scale-95">
                 <span className="text-lg">📱</span>
                 <span>WhatsApp</span>
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Students;
