
import React, { useState, useEffect } from 'react';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const NAV_ITEMS = [
  { id: 'calendar', label: 'יומן שיעורים' },
  { id: 'inbox', label: 'תיבת הודעות' },
  { id: 'dashboard', label: 'לוח בקרה' },
  { id: 'billing', label: 'חיובים ותשלומים' },
  { id: 'subscriptions', label: 'ניהול מנויים' },
  { id: 'homework', label: 'שיעורי בית' },
  { id: 'students', label: 'תלמידים' },
  { id: 'availability', label: 'ניהול זמינות' },
  { id: 'errors', label: 'מרכז שגיאות' },
  { id: 'settings', label: 'הגדרות' },
];

const Layout: React.FC<LayoutProps> = ({ children, activeTab, setActiveTab }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 1024) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-white border-l border-slate-200">
      <div className="p-8 border-b border-slate-100 flex flex-col gap-1 shrink-0">
        <span className="font-extrabold text-xl tracking-tight text-slate-900 leading-none">בית ספר למתמטיקה</span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold">מערכת ניהול</span>
      </div>
      
      <nav className="flex-1 py-6 px-4 space-y-1 overflow-y-auto custom-scrollbar">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => { setActiveTab(item.id); setIsMobileMenuOpen(false); }}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group ${
              activeTab === item.id 
                ? 'bg-blue-600 text-white font-bold shadow-md' 
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            <span className="text-[14px] font-semibold">{item.label}</span>
            {item.id === 'inbox' && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-black ${activeTab === item.id ? 'bg-white text-blue-600' : 'bg-rose-500 text-white'}`}>3</span>
            )}
          </button>
        ))}
      </nav>
      
      <div className="p-6 border-t border-slate-100 text-center shrink-0">
        <div className="text-[10px] font-bold text-slate-300 tracking-widest uppercase">Nexus Lessons v2.0</div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-[#fcfdfe] text-slate-900 overflow-hidden" dir="rtl">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-72 shrink-0 z-20 h-full">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)} />
      )}
      
      {/* Mobile Sidebar */}
      <aside className={`fixed inset-y-0 right-0 w-72 bg-white z-50 transform transition-transform duration-300 ease-in-out lg:hidden flex flex-col shadow-2xl ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <SidebarContent />
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 z-30 sticky top-0 shrink-0">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsMobileMenuOpen(true)} className="lg:hidden p-2 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
            </button>
            <div className="flex flex-col">
               <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest hidden md:block">ניהול מרכז למידה</div>
               <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                 {NAV_ITEMS.find(i => i.id === activeTab)?.label}
               </h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
             <div className="flex flex-col items-end text-right">
               <span className="text-sm font-bold text-slate-900 leading-tight">רז מנהל</span>
               <span className="text-[10px] text-slate-400 font-medium tracking-tight">מנהל מערכת</span>
             </div>
             <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center font-bold text-slate-400 border border-slate-100 select-none">R</div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 lg:p-10 bg-[#f8fafc] custom-scrollbar">
          <div className="max-w-[1600px] mx-auto h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Layout;
