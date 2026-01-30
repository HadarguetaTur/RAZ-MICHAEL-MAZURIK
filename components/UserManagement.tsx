import React, { useState, useEffect, useMemo } from 'react';
import { Entity, EntityPermission } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';
import EntityCard from './EntityCard';
import EntityFormModal from './EntityFormModal';
import { useToast } from '../hooks/useToast';

const PERMISSION_LABELS: Record<EntityPermission, string> = {
  admin: 'מנהל',
  teacher: 'מורה',
  parent: 'הורה',
  student: 'תלמיד',
};

const PERMISSION_STYLES: Record<EntityPermission, string> = {
  admin: 'bg-red-50 text-red-600 border-red-100',
  teacher: 'bg-violet-50 text-violet-600 border-violet-100',
  parent: 'bg-blue-50 text-blue-600 border-blue-100',
  student: 'bg-emerald-50 text-emerald-600 border-emerald-100',
};

const UserManagement: React.FC = () => {
  const toast = useToast();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPermission, setFilterPermission] = useState<EntityPermission | 'all'>('all');
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const entitiesData = await nexusApi.getEntities();
      setEntities(entitiesData);
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const filteredEntities = useMemo(() => {
    return entities.filter(e => {
      const matchesSearch = 
        e.name.includes(searchTerm) || 
        e.phone.includes(searchTerm);
      const matchesFilter = filterPermission === 'all' || e.permission === filterPermission;
      return matchesSearch && matchesFilter;
    });
  }, [entities, searchTerm, filterPermission]);

  const getPermissionBadge = (permission: EntityPermission) => {
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border tracking-tight ${PERMISSION_STYLES[permission] || 'bg-slate-50 text-slate-400 border-slate-100'}`}>
        {PERMISSION_LABELS[permission] || permission}
      </span>
    );
  };

  const permissionCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entities.length };
    entities.forEach(e => {
      counts[e.permission] = (counts[e.permission] || 0) + 1;
    });
    return counts;
  }, [entities]);

  return (
    <div className="space-y-6 md:space-y-10 animate-in fade-in duration-700 pb-20">
      {/* Header Control */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-6">
        <div className="relative flex-1 max-w-lg text-right">
          <input
            type="text"
            placeholder="חפש משתמש..."
            className="w-full pr-12 pl-4 py-3.5 md:py-4 rounded-xl md:rounded-[24px] border border-slate-200 focus:outline-none focus:ring-4 focus:ring-violet-50 transition-all bg-white font-bold text-right"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            dir="rtl"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 opacity-30 text-xl">🔍</span>
        </div>
        <button 
          onClick={() => setShowAddModal(true)}
          className="bg-violet-600 text-white px-8 md:px-10 py-3.5 md:py-4 rounded-xl md:rounded-[22px] font-black text-sm hover:bg-violet-700 transition-all shadow-lg active:scale-95"
        >
          + הוסף משתמש חדש
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'admin', 'teacher', 'parent', 'student'] as const).map((perm) => (
          <button
            key={perm}
            onClick={() => setFilterPermission(perm)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              filterPermission === perm
                ? 'bg-violet-600 text-white shadow-md'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {perm === 'all' ? 'הכל' : PERMISSION_LABELS[perm]}
            <span className={`mr-2 px-1.5 py-0.5 rounded-full text-[10px] ${
              filterPermission === perm ? 'bg-white/20' : 'bg-slate-100'
            }`}>
              {permissionCounts[perm] || 0}
            </span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl md:rounded-[40px] border border-slate-200 shadow-sm overflow-hidden" dir="rtl">
        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50/50 text-slate-400 text-[11px] font-black uppercase border-b border-slate-100">
              <tr>
                <th className="px-10 py-6">משתמש</th>
                <th className="px-10 py-6">טלפון</th>
                <th className="px-10 py-6">הרשאה</th>
                <th className="px-10 py-6 text-left">ניהול</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={4} className="py-20 text-center text-slate-300 font-bold">טוען...</td></tr>
              ) : filteredEntities.length === 0 ? (
                <tr><td colSpan={4} className="py-20 text-center text-slate-300 font-bold">לא נמצאו משתמשים</td></tr>
              ) : filteredEntities.map(entity => (
                <tr key={entity.id} className="hover:bg-violet-50/30 transition-all cursor-pointer" onClick={() => setSelectedEntity(entity)}>
                  <td className="px-10 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-violet-100 rounded-xl flex items-center justify-center text-violet-600 font-black">
                        {entity.name[0] || '?'}
                      </div>
                      <div>
                        <div className="font-black text-slate-800">{entity.name}</div>
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter mt-0.5">
                          {entity.id.slice(0, 10)}...
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-5 text-sm font-bold text-slate-600" dir="ltr">{entity.phone}</td>
                  <td className="px-10 py-5">{getPermissionBadge(entity.permission)}</td>
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
          ) : filteredEntities.length === 0 ? (
            <div className="py-10 text-center text-slate-300">לא נמצאו משתמשים</div>
          ) : filteredEntities.map(entity => (
            <div key={entity.id} className="p-4 flex items-center justify-between active:bg-slate-50 transition-colors" onClick={() => setSelectedEntity(entity)}>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-violet-50 text-violet-600 rounded-xl flex items-center justify-center font-black">
                  {entity.name[0] || '?'}
                </div>
                <div className="text-right">
                  <div className="font-black text-slate-800 text-base">{entity.name}</div>
                  <div className="text-[10px] font-bold text-slate-400" dir="ltr">{entity.phone}</div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {getPermissionBadge(entity.permission)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Entity Card Component */}
      {selectedEntity && (
        <EntityCard 
          entity={selectedEntity} 
          onClose={() => setSelectedEntity(null)} 
          onEdit={(updatedEntity) => {
            setEntities(prev => prev.map(e => e.id === updatedEntity.id ? updatedEntity : e));
            setSelectedEntity(updatedEntity);
          }}
          onDelete={(entityId) => {
            setEntities(prev => prev.filter(e => e.id !== entityId));
          }}
        />
      )}

      {/* Add Entity Modal */}
      {showAddModal && (
        <EntityFormModal
          onClose={() => setShowAddModal(false)}
          onSuccess={(newEntity) => {
            setEntities(prev => [newEntity, ...prev]);
            setShowAddModal(false);
          }}
        />
      )}
    </div>
  );
};

export default UserManagement;
