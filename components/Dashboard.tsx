
import React from 'react';
import { useDashboardData } from '../data/hooks/useDashboardData';

const Dashboard: React.FC = () => {
  const { metrics, isLoading, refresh } = useDashboardData();

  if (isLoading) {
    return (
      <div className="space-y-8 animate-pulse pb-12">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-10 w-48 bg-slate-200 rounded-xl"></div>
            <div className="h-4 w-64 bg-slate-100 rounded-lg"></div>
          </div>
          <div className="h-12 w-32 bg-slate-100 rounded-2xl"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-40 bg-white rounded-[32px] border border-slate-100 shadow-sm"></div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <div className="h-80 bg-white rounded-[32px] border border-slate-100 shadow-sm"></div>
            <div className="h-48 bg-white rounded-[32px] border border-slate-100 shadow-sm"></div>
          </div>
          <div className="space-y-8">
            <div className="h-96 bg-slate-900/5 rounded-[40px]"></div>
            <div className="h-64 bg-white rounded-[32px] border border-slate-100 shadow-sm"></div>
          </div>
        </div>
      </div>
    );
  }

  // Primary KPIs - Students & Daily Operations
  const primaryKpis = [
    { 
      label: 'תלמידים פעילים', 
      value: metrics.students.totalActive.toString(), 
      detail: metrics.students.onHold > 0 ? `${metrics.students.onHold} מושהים` : 'כולם פעילים',
      color: 'blue' 
    },
    { 
      label: 'שיעורים היום', 
      value: metrics.daily.lessonsToday.toString(), 
      detail: `${metrics.daily.completedToday} הושלמו / ${metrics.daily.cancelledToday} בוטלו`, 
      color: 'emerald' 
    },
    { 
      label: 'אישורי נוכחות חסרים', 
      value: metrics.daily.missingAttendance.toString(), 
      detail: 'שיעורי עבר ללא אישור', 
      color: metrics.daily.missingAttendance > 0 ? 'amber' : 'emerald'
    },
    { 
      label: 'חובות בפיגור', 
      value: metrics.billing.overdueCount.toString(), 
      detail: metrics.billing.overdueCount > 0 ? `סה"כ ₪${metrics.billing.overdueTotal.toLocaleString()}` : 'אין חובות בפיגור',
      color: metrics.billing.overdueCount > 0 ? 'rose' : 'emerald'
    },
  ];

  const billingKpis = [
    { 
      label: 'סכום פתוח לתשלום', 
      value: `₪${metrics.billing.openAmount.toLocaleString()}`, 
      detail: `${metrics.billing.billsCount} תלמידים`, 
      color: 'slate' 
    },
    { 
      label: 'שולם החודש', 
      value: `₪${metrics.billing.paidThisMonth.toLocaleString()}`, 
      detail: `${metrics.billing.collectionRate.toFixed(1)}% גבייה`, 
      color: 'emerald' 
    },
    { 
      label: 'ממתינים לשליחה', 
      value: metrics.billing.pendingLinkCount.toString(), 
      detail: 'חשבונות מאושרים', 
      color: metrics.billing.pendingLinkCount > 0 ? 'amber' : 'slate' 
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-12">
      {/* Page Welcome */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tight">בוקר טוב, רז 👋</h2>
          <p className="text-slate-500 text-sm mt-1">סקירה תפעולית וצמיחה ליום {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <button 
          onClick={refresh}
          className="bg-white border border-slate-200 px-6 py-2.5 rounded-2xl text-sm font-black text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
        >
          רענן נתונים
        </button>
      </div>

      {/* Primary KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {primaryKpis.map((kpi, idx) => (
          <div key={idx} className="bg-white p-7 rounded-[32px] border border-slate-200 shadow-sm hover:shadow-md transition-shadow group">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{kpi.label}</div>
              <div className={`w-2 h-2 rounded-full ${
                kpi.color === 'blue' ? 'bg-blue-500' : 
                kpi.color === 'rose' ? 'bg-rose-500' : 
                kpi.color === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
              }`}></div>
            </div>
            <div className="text-4xl font-black text-slate-900 group-hover:scale-105 transition-transform origin-right">{kpi.value}</div>
            <div className="text-[11px] font-bold text-slate-400 mt-2">{kpi.detail}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Growth & Activity Charts */}
        <div className="lg:col-span-2 space-y-8">
          {/* Main Chart Card */}
          <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm p-8">
            <div className="flex items-center justify-between mb-10">
              <h3 className="text-xl font-black text-slate-800">נפח שיעורים שבועי</h3>
              <div className="flex gap-2">
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                  <span className="w-2.5 h-2.5 bg-blue-600 rounded-sm"></span> השבוע
                </span>
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                  <span className="w-2.5 h-2.5 bg-slate-100 rounded-sm"></span> שבוע שעבר
                </span>
              </div>
            </div>
            
            <div className="h-64 flex items-end justify-around gap-6">
              {metrics.charts.weeklyVolume.map((item, i) => (
                <div key={i} className="flex flex-col items-center gap-3 flex-1">
                  <div className="w-full flex flex-col justify-end gap-1 h-full">
                    {/* Previous Week Ghost Bar */}
                    <div style={{ height: `${(item.previous * 4)}%` }} className="w-full bg-slate-50 rounded-t-lg"></div>
                    {/* Current Week Bar */}
                    <div style={{ height: `${(item.current * 4)}%` }} className="w-full bg-blue-600 rounded-t-lg relative group">
                       <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                         {item.current} שיעורים
                       </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-black text-slate-400">
                    {item.day}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Billing Overview */}
          <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-8 border-b border-slate-50 flex items-center justify-between">
              <h3 className="text-xl font-black text-slate-800">מצב כספים</h3>
              <button className="text-blue-600 text-xs font-black hover:underline">ניהול גבייה</button>
            </div>
            <div className="grid grid-cols-3 divide-x divide-x-reverse divide-slate-100">
              {billingKpis.map((kpi, idx) => (
                <div key={idx} className="p-8">
                  <div className="text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">{kpi.label}</div>
                  <div className={`text-2xl font-black ${kpi.color === 'rose' ? 'text-rose-600' : 'text-slate-800'}`}>{kpi.value}</div>
                  <div className="text-[10px] font-bold text-slate-400 mt-1">{kpi.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Operational Tasks & Queues */}
        <div className="space-y-8">
          <div className="bg-slate-900 rounded-[40px] p-8 text-white shadow-2xl shadow-slate-200">
            <h3 className="text-lg font-black mb-6">משימות דחופות</h3>
            <div className="space-y-4">
              {metrics.urgentTasks.length > 0 ? (
                metrics.urgentTasks.map((task, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl hover:bg-white/10 transition-colors cursor-pointer group border border-white/5">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 ${
                        task.type === 'warning' ? 'bg-rose-500/20 text-rose-500' : 
                        task.type === 'payment' ? 'bg-amber-500/20 text-amber-500' : 'bg-blue-500/20 text-blue-500'
                      } rounded-xl flex items-center justify-center text-lg`}>
                        {task.type === 'warning' ? '⚠️' : task.type === 'payment' ? '💳' : '⚡'}
                      </div>
                      <div>
                        <div className="text-sm font-bold">{task.title}</div>
                        <div className="text-[10px] text-white/40">{task.detail}</div>
                      </div>
                    </div>
                    <span className="text-white/20 group-hover:translate-x-[-4px] transition-transform">←</span>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-white/40 text-sm italic">
                  אין משימות דחופות כרגע ✨
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-[32px] border border-slate-200 shadow-sm p-8">
            <h3 className="text-lg font-black text-slate-800 mb-6">מגמת הכנסות</h3>
            <div className="space-y-6">
              {metrics.charts.revenueTrend.map((m, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-600"></div>
                    <div className="text-sm font-bold text-slate-700">{m.month}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-black text-slate-900">₪{m.amount.toLocaleString()}</span>
                    <span className={`text-[10px] font-bold ${m.trend === 'up' ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {m.trend === 'up' ? '↑' : '↓'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-8 pt-6 border-t border-slate-50">
               <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">תחזית לחודש הבא</div>
               <div className="text-lg font-black text-slate-800 italic">₪16,200 ~</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
