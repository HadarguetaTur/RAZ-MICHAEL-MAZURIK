
import React, { useState, useEffect, useMemo } from 'react';
import { HomeworkLibraryItem, HomeworkAssignment, Student } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';

const Homework: React.FC = () => {
  const [activeView, setActiveView] = useState<'library' | 'assignments'>('assignments');
  const [library, setLibrary] = useState<HomeworkLibraryItem[]>([]);
  const [assignments, setAssignments] = useState<HomeworkAssignment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAssignModal, setShowAssignModal] = useState(false);

  // Assignment Form State
  const [selectedHomework, setSelectedHomework] = useState<string>('');
  const [selectedStudent, setSelectedStudent] = useState<string>('');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [lib, assign, stds] = await Promise.all([
        nexusApi.getHomeworkLibrary(),
        nexusApi.getHomeworkAssignments(),
        nexusApi.getStudents()
      ]);
      setLibrary(lib);
      setAssignments(assign);
      setStudents(stds);
    } catch (err) {
      alert(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHomework || !selectedStudent || !dueDate) {
      alert('יש למלא את כל השדות');
      return;
    }

    const homeworkItem = library.find(h => h.id === selectedHomework);
    const studentItem = students.find(s => s.id === selectedStudent);

    try {
      const newAssign = await nexusApi.assignHomework({
        studentId: selectedStudent,
        studentName: studentItem?.name,
        homeworkId: selectedHomework,
        homeworkTitle: homeworkItem?.title,
        dueDate: dueDate
      });
      setAssignments([newAssign, ...assignments]);
      setShowAssignModal(false);
      alert('שיעורי הבית הוקצו בהצלחה');
    } catch (err) {
      alert(parseApiError(err));
    }
  };

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
      <div className="flex items-center justify-between">
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
        <button 
          onClick={() => setShowAssignModal(true)}
          className="bg-slate-900 text-white px-8 py-3 rounded-2xl font-black text-sm hover:bg-slate-800 transition-all shadow-lg"
        >
          + הקצה שיעורי בית
        </button>
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
          {library.map(item => (
            <div key={item.id} className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm hover:border-blue-200 transition-all group">
              <div className="flex justify-between items-start mb-4">
                <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-3 py-1 rounded-lg uppercase tracking-widest">{item.subject}</span>
                <span className="text-slate-300 text-xs font-bold">{item.level}</span>
              </div>
              <h3 className="text-xl font-black text-slate-800 mb-2">{item.title}</h3>
              <p className="text-sm text-slate-500 line-clamp-2 mb-6 leading-relaxed">{item.description}</p>
              <div className="pt-4 border-t border-slate-50 flex items-center justify-between">
                <button className="text-blue-600 text-xs font-black hover:underline">פרטים מלאים</button>
                <button 
                  onClick={() => {
                    setSelectedHomework(item.id);
                    setShowAssignModal(true);
                  }}
                  className="bg-slate-50 text-slate-400 p-2 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-all shadow-sm"
                >
                  🚀 הקצה
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Assign Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAssignModal(false)}></div>
          <form onSubmit={handleAssign} className="relative w-full max-w-lg bg-white rounded-[40px] shadow-2xl p-10 space-y-8 animate-in zoom-in-95 duration-300">
            <h2 className="text-3xl font-black text-slate-800">הקצאת משימה חדשה</h2>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase mr-1">בחר תלמיד</label>
                <select 
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-5 py-3.5 text-sm font-bold outline-none focus:ring-4 focus:ring-blue-50 transition-all"
                  value={selectedStudent}
                  onChange={(e) => setSelectedStudent(e.target.value)}
                  required
                >
                  <option value="">בחר...</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.name} ({s.grade})</option>)}
                </select>
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
                  {library.map(h => <option key={h.id} value={h.id}>{h.title} - {h.subject}</option>)}
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
            </div>

            <div className="flex gap-4 pt-4">
               <button type="submit" className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all">הקצה משימה</button>
               <button type="button" onClick={() => setShowAssignModal(false)} className="px-8 py-4 bg-slate-50 text-slate-400 rounded-2xl font-bold hover:bg-slate-100 transition-all">ביטול</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Homework;
