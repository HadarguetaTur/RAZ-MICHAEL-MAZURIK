
import React, { useState, useEffect, useMemo } from 'react';
import { Subscription } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';

const Subscriptions: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadSubscriptions();
  }, [statusFilter]);

  const loadSubscriptions = async () => {
    setLoading(true);
    try {
      const data = await nexusApi.getSubscriptions(statusFilter === 'all' ? undefined : statusFilter);
      setSubscriptions(data);
    } catch (err) {
      alert(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const filteredSubscriptions = useMemo(() => {
    return subscriptions.filter(s => 
      s.planName.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [subscriptions, searchTerm]);

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      cancelled: 'bg-rose-50 text-rose-600 border-rose-100',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border ${styles[status] || 'bg-slate-50 text-slate-400'}`}>
        {status === 'active' ? 'פעיל' : 'מבוטל'}
      </span>
    );
  };

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-20">
      {/* Informational Note (Mobile Responsive) */}
      <div className="bg-blue-600 p-6 md:p-8 rounded-2xl md:rounded-3xl text-white shadow-xl shadow-blue-100 relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-xl md:text-2xl font-black mb-2">ניהול מנויים וריטיינרים</h2>
          <p className="opacity-90 max-w-2xl text-xs md:text-lg leading-relaxed">שינויים משפיעים על חשבונות עתידיים בלבד.</p>
        </div>
        <div className="absolute left-[-30px] top-[-30px] text-9xl opacity-10 select-none">🔄</div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-white p-4 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
        <input 
          type="text" 
          placeholder="חפש תוכנית..."
          className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-bold outline-none"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <div className="flex gap-2">
          <select 
            className="flex-1 md:w-48 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-black outline-none"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="active">מנויים פעילים</option>
            <option value="all">הכל</option>
          </select>
          <button className="h-12 bg-slate-900 text-white px-6 rounded-xl font-black text-sm shadow-lg active:scale-95 transition-all">+ חדש</button>
        </div>
      </div>

      {/* Desktop Table / Mobile Cards */}
      <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-400 text-[10px] font-black uppercase">
              <tr>
                <th className="px-6 py-4">סוג מנוי</th>
                <th className="px-6 py-4">חודשי</th>
                <th className="px-6 py-4 text-center">סטטוס</th>
                <th className="px-6 py-4 text-left">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={4} className="py-20 text-center text-slate-300 font-bold">טוען...</td></tr>
              ) : filteredSubscriptions.map(sub => (
                <tr key={sub.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-5 font-bold text-slate-800">{sub.planName}</td>
                  <td className="px-6 py-5 font-black text-slate-900 text-lg">₪{sub.price}</td>
                  <td className="px-6 py-5 text-center">{getStatusBadge(sub.status)}</td>
                  <td className="px-6 py-5 text-left">
                    <button className="px-4 py-2 bg-slate-50 text-slate-400 text-xs font-black rounded-lg hover:bg-slate-100">נהל</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile View Cards */}
        <div className="md:hidden divide-y divide-slate-50">
          {loading ? (
            <div className="p-10 text-center text-slate-300">טוען...</div>
          ) : filteredSubscriptions.map(sub => (
            <div key={sub.id} className="p-5 flex items-center justify-between active:bg-slate-50 transition-colors">
              <div className="text-right">
                <div className="font-black text-slate-800 text-base mb-1">{sub.planName}</div>
                <div className="text-xl font-black text-slate-900">₪{sub.price}</div>
              </div>
              <div className="flex flex-col items-end gap-3">
                 {getStatusBadge(sub.status)}
                 <button className="text-[10px] font-black text-blue-500 uppercase">עריכה</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Subscriptions;
