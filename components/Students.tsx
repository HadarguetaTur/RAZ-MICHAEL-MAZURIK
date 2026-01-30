import React, { useState, useEffect, useMemo } from 'react';
import { Student, Lesson } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';
import StudentCard from './StudentCard';
import StudentFormModal from './StudentFormModal';
import { useToast } from '../hooks/useToast';

const Students: React.FC = () => {
  const toast = useToast();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const studentsData = await nexusApi.getStudents();
      setStudents(studentsData);
    } catch (err) {
      toast.error(parseApiError(err));
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
        <div className="relative flex-1 max-w-lg text-right">
          <input
            type="text"
            placeholder="חפש תלמיד או הורה..."
            className="w-full pr-12 pl-4 py-3.5 md:py-4 rounded-xl md:rounded-[24px] border border-slate-200 focus:outline-none focus:ring-4 focus:ring-blue-50 transition-all bg-white font-bold text-right"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            dir="rtl"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 text-xl">🔍</span>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="bg-blue-600 text-white px-8 md:px-10 py-3.5 md:py-4 rounded-xl md:rounded-[22px] font-black text-sm hover:bg-blue-700 transition-all shadow-lg active:scale-95"
        >
          + הוסף תלמיד חדש
        </button>
      </div>

      <div className="bg-white rounded-2xl md:rounded-[40px] border border-slate-200 shadow-sm overflow-hidden" dir="rtl">
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

      {/* Student Card Component */}
      {selectedStudent && (
        <StudentCard 
          student={selectedStudent} 
          onClose={() => setSelectedStudent(null)} 
          onEdit={(updatedStudent) => {
            setStudents(prev => prev.map(s => s.id === updatedStudent.id ? updatedStudent : s));
            setSelectedStudent(updatedStudent);
          }}
        />
      )}

      {/* Add Student Modal */}
      {showAddModal && (
        <StudentFormModal
          onClose={() => setShowAddModal(false)}
          onSuccess={(newStudent) => {
            setStudents(prev => [newStudent, ...prev]); // Add to beginning of list
            setShowAddModal(false);
          }}
        />
      )}
    </div>
  );
};

export default Students;
