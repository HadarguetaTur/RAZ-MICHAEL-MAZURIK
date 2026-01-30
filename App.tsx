
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

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('calendar');

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
