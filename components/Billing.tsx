
import React, { useState, useEffect, useMemo } from 'react';
import { MonthlyBill, BillLineItem } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';

const Billing: React.FC = () => {
  const [bills, setBills] = useState<MonthlyBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState('2024-03');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedBill, setSelectedBill] = useState<MonthlyBill | null>(null);

  useEffect(() => {
    loadBills();
  }, [selectedMonth]);

  const loadBills = async () => {
    setLoading(true);
    try {
      const data = await nexusApi.getMonthlyBills(selectedMonth);
      setBills(data);
    } catch (err) {
      alert(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const filteredBills = useMemo(() => {
    return bills.filter(b => {
      const matchesSearch = b.studentName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [bills, searchTerm, statusFilter]);

  const stats = useMemo(() => {
    return {
      total: bills.reduce((acc, b) => acc + b.totalAmount, 0),
      paid: bills.filter(b => b.status === 'paid').reduce((acc, b) => acc + b.totalAmount, 0),
      pending: bills.filter(b => b.status !== 'paid').reduce((acc, b) => acc + b.totalAmount, 0),
    };
  }, [bills]);

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      paid: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      link_sent: 'bg-blue-50 text-blue-600 border-blue-100',
      draft: 'bg-slate-50 text-slate-400 border-slate-100',
      overdue: 'bg-rose-50 text-rose-600 border-rose-100',
      pending_approval: 'bg-amber-50 text-amber-600 border-amber-100',
    };
    const labels: Record<string, string> = {
      paid: 'שולם',
      link_sent: 'נשלח',
      draft: 'טיוטה',
      overdue: 'פיגור',
      pending_approval: 'ממתין',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${styles[status] || styles.draft}`}>
        {labels[status] || status}
      </span>
    );
  };

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-20">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <div className="bg-white p-5 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center">
          <label className="text-[10px] font-black text-slate-400 uppercase mb-2">בחר חודש לחיוב</label>
          <input 
            type="month" 
            value={selectedMonth} 
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="text-lg font-black text-slate-800 bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 outline-none"
          />
        </div>
        <div className="bg-white p-5 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
          <div className="text-slate-400 text-[10px] font-black uppercase mb-1">סה"כ לחיוב</div>
          <div className="text-2xl md:text-3xl font-black text-slate-800">₪{stats.total.toLocaleString()}</div>
        </div>
        <div className="bg-emerald-50 p-5 md:p-6 rounded-2xl md:rounded-3xl border border-emerald-100 shadow-sm">
          <div className="text-emerald-400 text-[10px] font-black uppercase mb-1">שולם</div>
          <div className="text-2xl md:text-3xl font-black text-emerald-600">₪{stats.paid.toLocaleString()}</div>
        </div>
        <div className="bg-rose-50 p-5 md:p-6 rounded-2xl md:rounded-3xl border border-rose-100 shadow-sm">
          <div className="text-rose-400 text-[10px] font-black uppercase mb-1">ממתין</div>
          <div className="text-2xl md:text-3xl font-black text-rose-600">₪{stats.pending.toLocaleString()}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 bg-white p-4 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3 flex-1 lg:max-w-2xl">
           <input 
             type="text" 
             placeholder="חפש הורה או תלמיד..."
             className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-bold outline-none"
             value={searchTerm}
             onChange={(e) => setSearchTerm(e.target.value)}
           />
           <select 
            className="sm:w-48 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-black outline-none"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">כל הסטטוסים</option>
            <option value="draft">טיוטות</option>
            <option value="link_sent">נשלחו</option>
            <option value="paid">שולמו</option>
          </select>
        </div>
        <button className="h-12 bg-blue-600 text-white px-6 rounded-xl font-black text-sm shadow-lg shadow-blue-100 hover:bg-blue-700 active:scale-95 transition-all">
          צור חיובים חודשיים
        </button>
      </div>

      {/* Responsive Table / Cards */}
      <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-400 text-[10px] font-black uppercase">
              <tr>
                <th className="px-6 py-4">תלמיד / הורה</th>
                <th className="px-6 py-4">שיעורים</th>
                <th className="px-6 py-4">מנויים</th>
                <th className="px-6 py-4">סה"כ</th>
                <th className="px-6 py-4 text-center">סטטוס</th>
                <th className="px-6 py-4 text-left">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="py-16 text-center text-slate-400">טוען...</td></tr>
              ) : filteredBills.map(bill => (
                <tr key={bill.id} className="hover:bg-slate-50/50 cursor-pointer active:bg-slate-100 transition-colors" onClick={() => setSelectedBill(bill)}>
                  <td className="px-6 py-5">
                    <div className="font-bold text-slate-800">{bill.studentName}</div>
                    <div className="text-[10px] text-slate-400 font-bold">{bill.month}</div>
                  </td>
                  <td className="px-6 py-5 text-sm text-slate-600">₪{bill.lessonsAmount}</td>
                  <td className="px-6 py-5 text-sm text-slate-600">₪{bill.subscriptionsAmount}</td>
                  <td className="px-6 py-5 font-black text-slate-900 text-lg">₪{bill.totalAmount}</td>
                  <td className="px-6 py-5 text-center">{getStatusBadge(bill.status)}</td>
                  <td className="px-6 py-5 text-left">
                    <button className="p-2 bg-slate-50 text-slate-400 rounded-lg">👁️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile View Cards */}
        <div className="md:hidden divide-y divide-slate-100">
          {loading ? (
            <div className="p-10 text-center text-slate-400">טוען...</div>
          ) : filteredBills.map(bill => (
            <div key={bill.id} className="p-5 active:bg-slate-50 transition-colors" onClick={() => setSelectedBill(bill)}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-right">
                  <div className="font-black text-slate-800">{bill.studentName}</div>
                  <div className="text-[10px] font-bold text-slate-400">{bill.month}</div>
                </div>
                {getStatusBadge(bill.status)}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex gap-4">
                   <div className="text-[10px] font-bold text-slate-500">שיעורים: ₪{bill.lessonsAmount}</div>
                   <div className="text-[10px] font-bold text-slate-500">מנוי: ₪{bill.subscriptionsAmount}</div>
                </div>
                <div className="text-lg font-black text-slate-900">₪{bill.totalAmount}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bill Drawer / Bottom Sheet */}
      {selectedBill && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setSelectedBill(null)}></div>
          <div className="relative w-full lg:w-[600px] bg-white lg:h-full h-[95vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl animate-in slide-in-from-bottom lg:slide-in-from-left duration-500 flex flex-col overflow-hidden">
            <div className="p-6 md:p-8 bg-slate-50 border-b border-slate-200 shrink-0">
              <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 lg:hidden"></div>
              <div className="flex items-center justify-between mb-6">
                <button onClick={() => setSelectedBill(null)} className="p-2 hover:bg-white rounded-xl transition-all">✕</button>
                <div className="flex gap-2">
                   <button className="hidden sm:block px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold shadow-sm">PDF</button>
                   <button className="px-6 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-100 active:scale-95 transition-all">שלח קישור תשלום</button>
                </div>
              </div>
              <div className="flex items-center gap-4 md:gap-6">
                 <div className="w-16 h-16 md:w-20 md:h-20 bg-blue-600 rounded-2xl md:rounded-3xl flex items-center justify-center text-white text-3xl font-black">
                   {selectedBill.studentName[0]}
                 </div>
                 <div className="flex-1">
                    <h2 className="text-2xl md:text-3xl font-black text-slate-800 leading-tight">{selectedBill.studentName}</h2>
                    <p className="text-slate-400 font-bold text-xs md:text-sm">סיכום חודש {selectedBill.month}</p>
                 </div>
                 <div className="text-left">
                    <div className="text-[9px] md:text-[10px] text-slate-400 font-black uppercase mb-1">סה"כ</div>
                    <div className="text-2xl md:text-4xl font-black text-slate-900 leading-none">₪{selectedBill.totalAmount}</div>
                 </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 custom-scrollbar bg-[#fcfdfe]">
              <section>
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">פירוט שירותים</h3>
                <div className="space-y-2 md:space-y-3">
                  {selectedBill.lineItems?.map((item: BillLineItem) => (
                    <div key={item.id} className="flex items-center justify-between p-4 rounded-xl md:rounded-2xl border border-slate-50 hover:bg-slate-50/50 transition-all">
                      <div className="flex items-center gap-3">
                        <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs">📅</span>
                        <div>
                          <div className="font-bold text-slate-700 text-sm">{item.description}</div>
                          {item.date && <div className="text-[10px] text-slate-400 font-bold">{item.date}</div>}
                        </div>
                      </div>
                      <div className="font-black text-slate-800 text-sm">₪{item.amount}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="p-6 bg-slate-50 rounded-2xl md:rounded-3xl border border-slate-100">
                <h3 className="text-xs font-black text-slate-800 mb-4">הנחה / התאמה ידנית</h3>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input 
                    type="text" 
                    placeholder="סיבת התאמה..."
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none"
                  />
                  <div className="flex gap-2 shrink-0">
                    <input 
                      type="number" 
                      placeholder="₪"
                      className="w-20 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none"
                    />
                    <button className="px-4 py-3 bg-slate-900 text-white rounded-xl text-xs font-bold active:scale-95 transition-all">הוסף</button>
                  </div>
                </div>
              </section>
            </div>

            <div className="p-6 md:p-8 bg-slate-50 border-t border-slate-200 flex gap-3 shrink-0 pb-10 md:pb-8">
               <button className="flex-1 py-4 md:py-5 bg-emerald-600 text-white rounded-2xl font-black shadow-lg active:scale-95 transition-all">סמן כשולם (מזומן)</button>
               <button className="px-6 md:px-8 py-4 md:py-5 bg-white border border-slate-200 text-slate-400 rounded-2xl font-bold" onClick={() => setSelectedBill(null)}>סגור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Billing;
