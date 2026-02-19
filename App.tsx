
import React, { useState } from 'react';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import Calendar from './components/Calendar';
import Students from './components/Students';
import Subscriptions from './components/Subscriptions';
import Billing from './components/Billing';
import Homework from './components/Homework';
import Availability from './components/Availability';
import UserManagement from './components/UserManagement';
import { useAuth } from './hooks/useAuth';
import Login from './components/Login';

const App: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const [activeTab, setActiveTab] = useState('calendar');

  // Show loading while checking auth
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#f8fafc' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm font-semibold text-slate-400">טוען...</span>
        </div>
      </div>
    );
  }

  // Show login if not authenticated
  if (!isAuthenticated) {
    return <Login />;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'calendar':
        return <Calendar />;
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
      case 'users':
        return <UserManagement />;
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
