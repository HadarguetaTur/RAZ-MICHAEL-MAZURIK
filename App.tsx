
import React, { useState } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import Calendar from './components/Calendar';
import Students from './components/Students';
import Inbox from './components/Inbox';
import Subscriptions from './components/Subscriptions';
import Billing from './components/Billing';
import Homework from './components/Homework';
import Availability from './components/Availability';
import ErrorCenter from './components/ErrorCenter';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('calendar');

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'calendar':
        return <Calendar />;
      case 'inbox':
        return <Inbox />;
      case 'students':
        return <Students />;
      case 'subscriptions':
        return <Subscriptions />;
      case 'billing':
        return <Billing />;
      case 'homework':
        return <Homework />;
      case 'availability':
        return <Availability />;
      case 'errors':
        return <ErrorCenter />;
      case 'settings':
        return (
          <div className="max-w-3xl bg-white p-10 rounded-3xl border border-slate-200 shadow-sm animate-in fade-in duration-500">
            <h2 className="text-2xl font-black text-slate-800 mb-10">הגדרות מערכת</h2>
            <div className="space-y-8">
              <div className="flex justify-between items-center py-6 border-b border-slate-50">
                <div>
                  <div className="font-bold text-slate-800 text-lg">שם המורה / עסק</div>
                  <div className="text-sm text-slate-400 mt-1">השם שיופיע בקבלות, התראות ודפי תשלום</div>
                </div>
                <input type="text" defaultValue="רז לימודים" className="border-2 border-slate-100 rounded-xl px-4 py-2.5 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-bold text-slate-700" />
              </div>
              <div className="flex justify-between items-center py-6 border-b border-slate-50">
                <div>
                  <div className="font-bold text-slate-800 text-lg">התראות וואטסאפ</div>
                  <div className="text-sm text-slate-400 mt-1">שלח תזכורת אוטומטית 24 שעות לפני תחילת שיעור</div>
                </div>
                <button className="w-14 h-8 bg-blue-600 rounded-full relative shadow-inner shadow-blue-800/20">
                  <div className="absolute left-1 top-1 w-6 h-6 bg-white rounded-full shadow-md"></div>
                </button>
              </div>
              <div className="flex justify-between items-center py-6">
                <div>
                  <div className="font-bold text-slate-800 text-lg">חיבור ל-Airtable</div>
                  <div className="text-sm text-slate-400 mt-1">סטטוס סנכרון הנתונים מול בסיס הנתונים הראשי</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="flex items-center gap-2 text-emerald-600 text-sm font-black bg-emerald-50 px-4 py-1.5 rounded-full">
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                    מחובר ותקין
                  </span>
                  <span className="text-[10px] text-slate-300">סנכרון אחרון: לפני 2 דק׳</span>
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return (
           <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4">
              <span className="text-6xl">🚧</span>
              <div className="text-xl font-bold italic text-slate-300">העמוד בבנייה...</div>
           </div>
        );
    }
  };

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
      {renderContent()}
    </Layout>
  );
};

export default App;
