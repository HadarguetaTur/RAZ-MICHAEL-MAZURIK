
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Subscription, Student } from '../types';
import { parseApiError } from '../services/nexusApi';
import { useSubscriptions } from '../data/hooks/useSubscriptions';
import { createSubscription, updateSubscription } from '../data/mutations';
import { subscriptionsService, parseMonthlyAmount } from '../services/subscriptionsService';
import StudentPicker from './StudentPicker';
import { useStudents } from '../hooks/useStudents';
import { getStudentByRecordId } from '../data/resources/students';
import Toast, { ToastType } from './Toast';
import AppSidePanel from './ui/AppSidePanel';
import { useConfirmDialog } from '../hooks/useConfirmDialog';

const Subscriptions: React.FC = () => {
  const { confirm } = useConfirmDialog();
  const subscriptionsHook = useSubscriptions();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused' | 'expired'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [selectedSubscription, setSelectedSubscription] = useState<Subscription | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [sortField, setSortField] = useState<'endDate' | 'startDate' | 'amount' | 'name'>('endDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Form state
  const [formData, setFormData] = useState<Partial<Subscription>>({
    studentId: '',
    subscriptionStartDate: '',
    subscriptionEndDate: '',
    monthlyAmount: '',
    subscriptionType: '',
    pauseSubscription: false,
    pauseDate: '',
  });
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const { getStudentById, students, isLoading: isLoadingStudents, refreshStudents } = useStudents({ autoLoad: true, loadAllPages: true });
  const [loadingStudentIds, setLoadingStudentIds] = useState<Set<string>>(new Set());
  const [studentNamesByFallback, setStudentNamesByFallback] = useState<Record<string, string>>({});
  const fetchedIdsRef = useRef<Set<string>>(new Set());

  const loadSubscriptions = async () => {
    setLoading(true);
    try {
      const data = await subscriptionsService.listSubscriptions();
      setSubscriptions(data);
    } catch (err) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // Ensure students are loaded before loading subscriptions
  useEffect(() => {
    // Wait for students to load before loading subscriptions
    if (!isLoadingStudents) {
      // Load subscriptions once students have finished loading (even if no students found)
      // This ensures the students cache is ready before we try to resolve names
      loadSubscriptions();
    }
  }, [isLoadingStudents]);

  /**
   * Build students cache map for efficient lookup
   * This memoizes the map so it only rebuilds when students change
   */
  const studentsByIdMap = useMemo(() => {
    const map = new Map<string, string>();
    students.forEach(student => {
      if (student.id && student.name) {
        map.set(student.id, student.name);
      }
    });
    return map;
  }, [students]);

  // Fetch missing student names by record ID when we have studentId but not in cache
  useEffect(() => {
    if (!subscriptions.length) return;
    const toFetch: string[] = [];
    subscriptions.forEach(sub => {
      const id = typeof sub.studentId === 'string' ? sub.studentId : (Array.isArray(sub.studentId) && sub.studentId.length ? (typeof sub.studentId[0] === 'string' ? sub.studentId[0] : (sub.studentId[0] as { id?: string })?.id) : '') || '';
      if (id && id.startsWith('rec') && !studentsByIdMap.get(id) && !fetchedIdsRef.current.has(id)) {
        toFetch.push(id);
      }
    });
    toFetch.forEach(id => {
      fetchedIdsRef.current.add(id);
      getStudentByRecordId(id).then(s => {
        if (s?.name) {
          setStudentNamesByFallback(prev => ({ ...prev, [id]: s.name }));
        }
      });
    });
  }, [subscriptions, studentsByIdMap]);

  /**
   * Resolve student name from subscription record
   * Priority:
   * 1. fullName lookup field (if present and non-empty)
   * 2. Resolve via students cache using studentId
   * 3. Resolve via fallback (fetched by record ID)
   * 4. Fallback to "—"
   */
  const resolveStudentName = (subscription: Subscription): string => {
    // 1. Try lookup field first (if present and non-empty)
    if (subscription.fullName && subscription.fullName.trim() !== '') {
      return subscription.fullName;
    }

    // 2. Resolve via students cache using studentId
    if (subscription.studentId) {
      // Handle both single ID and array of IDs safely
      let studentId: string | undefined;
      
      if (Array.isArray(subscription.studentId)) {
        // Array of IDs - take first one
        studentId = subscription.studentId.length > 0 
          ? (typeof subscription.studentId[0] === 'string' ? subscription.studentId[0] : subscription.studentId[0]?.id || '')
          : undefined;
      } else {
        // Single ID
        studentId = typeof subscription.studentId === 'string' ? subscription.studentId : subscription.studentId?.id || '';
      }
      
      if (studentId) {
        // Validate studentId format (should be Airtable record ID starting with 'rec')
        if (!studentId.startsWith('rec') && import.meta.env.DEV) {
          console.warn(`[Subscriptions] Invalid studentId format for subscription ${subscription.id}:`, studentId);
        }
        
        // Try cache map first (most efficient)
        const cachedName = studentsByIdMap.get(studentId);
        if (cachedName) {
          return cachedName;
        }
        
        // Fallback to getStudentById (in case cache hasn't loaded yet)
        const student = getStudentById(studentId);
        if (student?.name) {
          return student.name;
        }
        // Fallback: name fetched by record ID when not in bulk cache
        const fallbackName = studentNamesByFallback[studentId];
        if (fallbackName) return fallbackName;
        
        // Try to refresh students cache if not already loading this student
        // This helps in case the student was added after initial load
        if (!loadingStudentIds.has(studentId) && !isLoadingStudents) {
          setLoadingStudentIds(prev => new Set(prev).add(studentId));
          refreshStudents().finally(() => {
            setLoadingStudentIds(prev => {
              const next = new Set(prev);
              next.delete(studentId);
              return next;
            });
          });
        }
        
        // Log if student not found
        if (import.meta.env.DEV) {
          console.warn(`[Subscriptions] Student not found for subscription ${subscription.id}:`, {
            studentId,
            studentsCacheSize: studentsByIdMap.size,
            totalStudents: students.length,
            subscriptionFullName: subscription.fullName || '(empty)',
            isLoadingStudents,
          });
        }
      } else {
        if (import.meta.env.DEV) {
          console.warn(`[Subscriptions] Empty or invalid studentId for subscription ${subscription.id}:`, subscription.studentId);
        }
      }
    } else {
      if (import.meta.env.DEV) {
        console.warn(`[Subscriptions] No studentId for subscription ${subscription.id}`);
      }
    }

    // 3. Fallback
    return '—';
  };

  // Consistent status calculation function
  type SubscriptionStatus = 'paused' | 'expired' | 'active' | 'scheduled';
  const getSubscriptionStatus = (subscription: Subscription): SubscriptionStatus => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of day for comparison

    // 1. Paused if pause_subscription === true
    if (subscription.pauseSubscription === true) {
      return 'paused';
    }

    // 2. Else Expired if subscription_end_date < today
    if (subscription.subscriptionEndDate) {
      const endDate = new Date(subscription.subscriptionEndDate);
      endDate.setHours(0, 0, 0, 0);
      if (endDate < today) {
        return 'expired';
      }
    }

    // 3. Else Active if subscription_start_date <= today <= subscription_end_date
    if (subscription.subscriptionStartDate) {
      const startDate = new Date(subscription.subscriptionStartDate);
      startDate.setHours(0, 0, 0, 0);
      
      if (subscription.subscriptionEndDate) {
        const endDate = new Date(subscription.subscriptionEndDate);
        endDate.setHours(0, 0, 0, 0);
        
        if (startDate <= today && today <= endDate) {
          return 'active';
        }
        
        // 4. Else Scheduled if start date is in the future
        if (startDate > today) {
          return 'scheduled';
        }
      } else {
        // No end date - if started, it's active
        if (startDate <= today) {
          return 'active';
        } else {
          return 'scheduled';
        }
      }
    } else {
      // No start date - if no end date or end date is in future, treat as active
      if (!subscription.subscriptionEndDate) {
        return 'active';
      }
      const endDate = new Date(subscription.subscriptionEndDate);
      endDate.setHours(0, 0, 0, 0);
      if (endDate >= today) {
        return 'active';
      }
    }

    // Default fallback
    return 'active';
  };

  // Calculate KPIs using consistent status logic
  const kpis = useMemo(() => {
    const active = subscriptions.filter(s => getSubscriptionStatus(s) === 'active');
    const paused = subscriptions.filter(s => getSubscriptionStatus(s) === 'paused');
    const expired = subscriptions.filter(s => getSubscriptionStatus(s) === 'expired');
    
    // Calculate Expected Monthly Income - sum of monthly_amount for Active only
    // Use parseMonthlyAmount helper for safe parsing (handles both string and number formats)
    const expectedMonthlyIncome = active.reduce((sum, sub) => {
      return sum + parseMonthlyAmount(sub.monthlyAmount);
    }, 0);

    // Expiring soon (within 14 days) - only active subscriptions
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in14Days = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    const expiringSoon = subscriptions.filter(s => {
      if (getSubscriptionStatus(s) !== 'active') return false;
      if (!s.subscriptionEndDate) return false;
      const endDate = new Date(s.subscriptionEndDate);
      endDate.setHours(0, 0, 0, 0);
      return endDate >= today && endDate <= in14Days;
    });

    return {
      active: active.length,
      paused: paused.length,
      expired: expired.length,
      expectedMonthlyIncome,
      expiringSoon: expiringSoon.length,
    };
  }, [subscriptions]);

  // Get unique subscription types from existing records
  const subscriptionTypes = useMemo(() => {
    const types = new Set<string>();
    subscriptions.forEach(sub => {
      if (sub.subscriptionType) {
        types.add(sub.subscriptionType);
      }
    });
    return Array.from(types).sort();
  }, [subscriptions]);

  const filteredAndSortedSubscriptions = useMemo(() => {
    let filtered = subscriptions;

    // Filter by status using consistent status logic
    if (statusFilter !== 'all') {
      filtered = filtered.filter(s => getSubscriptionStatus(s) === statusFilter);
    }

    // Filter by type
    if (typeFilter !== 'all') {
      filtered = filtered.filter(s => s.subscriptionType === typeFilter);
    }

    // Filter by search term (student name)
    // Use resolveStudentName to search in both lookup field and resolved names
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(s => {
        const studentName = resolveStudentName(s);
        return studentName.toLowerCase().includes(term);
      });
    }

    // Sort subscriptions
    const sorted = [...filtered].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortField) {
        case 'endDate':
          aValue = a.subscriptionEndDate ? new Date(a.subscriptionEndDate).getTime() : 0;
          bValue = b.subscriptionEndDate ? new Date(b.subscriptionEndDate).getTime() : 0;
          break;
        case 'startDate':
          aValue = a.subscriptionStartDate ? new Date(a.subscriptionStartDate).getTime() : 0;
          bValue = b.subscriptionStartDate ? new Date(b.subscriptionStartDate).getTime() : 0;
          break;
        case 'amount':
          aValue = parseMonthlyAmount(a.monthlyAmount);
          bValue = parseMonthlyAmount(b.monthlyAmount);
          break;
        case 'name':
          aValue = resolveStudentName(a).toLowerCase();
          bValue = resolveStudentName(b).toLowerCase();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [subscriptions, searchTerm, statusFilter, typeFilter, sortField, sortDirection, studentsByIdMap, getStudentById]);

  const getStatusBadge = (subscription: Subscription) => {
    const status = getSubscriptionStatus(subscription);
    
    switch (status) {
      case 'paused':
        return (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black border bg-amber-50 text-amber-600 border-amber-100">
            מושעה
          </span>
        );
      case 'expired':
        return (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black border bg-rose-50 text-rose-600 border-rose-100">
            פג תוקף
          </span>
        );
      case 'scheduled':
        return (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black border bg-blue-50 text-blue-600 border-blue-100">
            מתוכנן
          </span>
        );
      case 'active':
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black border bg-emerald-50 text-emerald-600 border-emerald-100">
            פעיל
          </span>
        );
    }
  };

  const handleCreate = () => {
    setSelectedSubscription(null);
    setFormData({
      studentId: '',
      subscriptionStartDate: '',
      subscriptionEndDate: '',
      monthlyAmount: '',
      subscriptionType: '',
      pauseSubscription: false,
      pauseDate: '',
    });
    setSelectedStudent(null);
    setIsModalOpen(true);
  };

  const handleEdit = (subscription: Subscription) => {
    setSelectedSubscription(subscription);
    setFormData({
      studentId: subscription.studentId,
      subscriptionStartDate: subscription.subscriptionStartDate || '',
      subscriptionEndDate: subscription.subscriptionEndDate || '',
      monthlyAmount: subscription.monthlyAmount || '',
      subscriptionType: subscription.subscriptionType || '',
      pauseSubscription: subscription.pauseSubscription || false,
      pauseDate: subscription.pauseDate || '',
    });
    
    // Load student if we have studentId (synchronous lookup from cache)
    if (subscription.studentId) {
      const student = getStudentById(subscription.studentId);
      setSelectedStudent(student || null);
    } else {
      setSelectedStudent(null);
    }
    
    setIsModalOpen(true);
  };

  // Validate monthly amount (currency string)
  const validateMonthlyAmount = (amount: string): boolean => {
    if (!amount || amount.trim() === '') return true; // Optional field
    const parsed = parseMonthlyAmount(amount);
    return parsed > 0; // Must be a valid positive number
  };

  const handleSave = async () => {
    // Validation: Student is required
    if (!formData.studentId || !selectedStudent) {
      setToast({ message: 'נא לבחור תלמיד', type: 'error' });
      return;
    }

    // Validation: End date >= start date
    if (formData.subscriptionStartDate && formData.subscriptionEndDate) {
      const startDate = new Date(formData.subscriptionStartDate);
      const endDate = new Date(formData.subscriptionEndDate);
      if (endDate < startDate) {
        setToast({ message: 'תאריך הסיום חייב להיות אחרי או שווה לתאריך ההתחלה', type: 'error' });
        return;
      }
    }

    // Validation: Monthly amount is valid number/currency
    if (formData.monthlyAmount && !validateMonthlyAmount(formData.monthlyAmount)) {
      setToast({ message: 'סכום חודשי לא תקין. נא להזין מספר תקין (לדוגמה: ₪480.00)', type: 'error' });
      return;
    }

    setIsSaving(true);
    try {
      if (selectedSubscription) {
        // Update existing
        await updateSubscription(selectedSubscription.id, {
          ...formData,
          studentId: selectedStudent.id,
        });
        // Refresh from Airtable to get latest data
        await loadSubscriptions();
        setToast({ message: 'המנוי עודכן בהצלחה', type: 'success' });
      } else {
        // Create new
        await createSubscription({
          ...formData,
          studentId: selectedStudent.id,
        });
        // Refresh from Airtable to get latest data
        await loadSubscriptions();
        setToast({ message: 'המנוי נוצר בהצלחה', type: 'success' });
      }
      setIsModalOpen(false);
      setSelectedSubscription(null);
      setSelectedStudent(null);
    } catch (err) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePause = async (id: string, pauseDate?: string) => {
    const confirmed = await confirm({
      title: 'השהיית מנוי',
      message: 'האם אתה בטוח שברצונך להשהות מנוי זה?',
      variant: 'warning',
      confirmLabel: 'השהה מנוי',
      cancelLabel: 'ביטול'
    });
    if (!confirmed) return;
    
    setProcessingId(id);
    try {
      const today = new Date().toISOString().split('T')[0];
      await subscriptionsService.updateSubscription(id, {
        pauseSubscription: true,
        pauseDate: pauseDate || today,
      });
      await subscriptionsHook.refresh();
      await loadSubscriptions(); // sync local state so table updates without page refresh
      setToast({ message: 'המנוי הושהה בהצלחה', type: 'success' });
    } catch (err) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleResume = async (id: string) => {
    const confirmed = await confirm({
      title: 'חידוש מנוי',
      message: 'האם אתה בטוח שברצונך לחדש מנוי זה?',
      variant: 'info',
      confirmLabel: 'חדש מנוי',
      cancelLabel: 'ביטול'
    });
    if (!confirmed) return;
    
    setProcessingId(id);
    try {
      await subscriptionsService.updateSubscription(id, {
        pauseSubscription: false,
        pauseDate: '', // Clear pause date
      });
      await subscriptionsHook.refresh();
      await loadSubscriptions(); // sync local state so table updates without page refresh
      setToast({ message: 'המנוי חודש בהצלחה', type: 'success' });
    } catch (err) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleEnd = async (id: string) => {
    const confirmed = await confirm({
      title: 'סיום מנוי',
      message: 'האם אתה בטוח שברצונך לסיים מנוי זה? המנוי יסומן כפג תוקף.',
      variant: 'danger',
      confirmLabel: 'סיים מנוי',
      cancelLabel: 'ביטול'
    });
    if (!confirmed) return;
    
    setProcessingId(id);
    try {
      const today = new Date().toISOString().split('T')[0];
      await subscriptionsService.updateSubscription(id, {
        subscriptionEndDate: today,
        pauseSubscription: false, // Unpause if paused
      });
      await subscriptionsHook.refresh();
      await loadSubscriptions(); // sync local state so table updates without page refresh
      setToast({ message: 'המנוי הסתיים בהצלחה', type: 'success' });
    } catch (err) {
      setToast({ message: parseApiError(err), type: 'error' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleSort = (field: 'endDate' | 'startDate' | 'amount' | 'name') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('he-IL');
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-20">
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 md:gap-6">
        <div className="bg-white p-5 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">מנויים פעילים</div>
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
          </div>
          <div className="text-3xl md:text-4xl font-black text-slate-900">{kpis.active}</div>
        </div>

        <div className="bg-white p-5 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">מושעים</div>
            <div className="w-2 h-2 rounded-full bg-amber-500"></div>
          </div>
          <div className="text-3xl md:text-4xl font-black text-slate-900">{kpis.paused}</div>
        </div>

        <div className="bg-white p-5 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">פגי תוקף</div>
            <div className="w-2 h-2 rounded-full bg-rose-500"></div>
          </div>
          <div className="text-3xl md:text-4xl font-black text-slate-900">{kpis.expired}</div>
        </div>

        <div className="bg-emerald-50 p-5 md:p-6 rounded-2xl md:rounded-3xl border border-emerald-100 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">הכנסה חודשית צפויה</div>
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
          </div>
          <div className="text-3xl md:text-4xl font-black text-emerald-600">₪{kpis.expectedMonthlyIncome.toLocaleString()}</div>
          <div className="text-[11px] font-bold text-emerald-500 mt-1">סכום המנויים הפעילים</div>
        </div>

        <div className="bg-amber-50 p-5 md:p-6 rounded-2xl md:rounded-3xl border border-amber-100 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-black text-amber-600 uppercase tracking-widest">מסתיימים בקרוב</div>
            <div className="w-2 h-2 rounded-full bg-amber-500"></div>
          </div>
          <div className="text-3xl md:text-4xl font-black text-amber-600">{kpis.expiringSoon}</div>
          <div className="text-[11px] font-bold text-amber-500 mt-1">ב-14 הימים הקרובים</div>
        </div>
      </div>

      {/* Controls Row */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-white p-4 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm">
        <input 
          type="text" 
          placeholder="חפש תלמיד..."
          className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <div className="flex gap-2">
          <select 
            className="flex-1 md:w-40 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-black outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">כל הסטטוסים</option>
            <option value="active">פעילים</option>
            <option value="paused">מושעים</option>
            <option value="expired">פגי תוקף</option>
          </select>
          <select 
            className="flex-1 md:w-40 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-sm font-black outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="all">כל הסוגים</option>
            {subscriptionTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <button 
            onClick={handleCreate}
            className="h-12 bg-slate-900 text-white px-6 rounded-xl font-black text-sm shadow-lg active:scale-95 transition-all hover:bg-slate-800"
          >
            + מנוי חדש
          </button>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-400 text-[10px] font-black uppercase">
              <tr>
                <th className="px-6 py-4">
                  <button 
                    onClick={() => handleSort('name')}
                    className="flex items-center gap-2 hover:text-slate-600 transition-colors"
                  >
                    תלמיד
                    {sortField === 'name' && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
                  </button>
                </th>
                <th className="px-6 py-4">סוג מנוי</th>
                <th className="px-6 py-4">
                  <button 
                    onClick={() => handleSort('amount')}
                    className="flex items-center gap-2 hover:text-slate-600 transition-colors"
                  >
                    סכום חודשי
                    {sortField === 'amount' && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
                  </button>
                </th>
                <th className="px-6 py-4">
                  <button 
                    onClick={() => handleSort('startDate')}
                    className="flex items-center gap-2 hover:text-slate-600 transition-colors"
                  >
                    תאריך התחלה
                    {sortField === 'startDate' && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
                  </button>
                </th>
                <th className="px-6 py-4">
                  <button 
                    onClick={() => handleSort('endDate')}
                    className="flex items-center gap-2 hover:text-slate-600 transition-colors"
                  >
                    תאריך סיום
                    {sortField === 'endDate' && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
                  </button>
                </th>
                <th className="px-6 py-4 text-center">סטטוס</th>
                <th className="px-6 py-4 text-left">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                // Loading skeleton
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={idx} className="animate-pulse">
                    <td className="px-6 py-5"><div className="h-4 bg-slate-200 rounded w-24"></div></td>
                    <td className="px-6 py-5"><div className="h-4 bg-slate-200 rounded w-16"></div></td>
                    <td className="px-6 py-5"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                    <td className="px-6 py-5"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                    <td className="px-6 py-5"><div className="h-4 bg-slate-200 rounded w-20"></div></td>
                    <td className="px-6 py-5 text-center"><div className="h-5 bg-slate-200 rounded-full w-16 mx-auto"></div></td>
                    <td className="px-6 py-5"><div className="h-8 bg-slate-200 rounded w-20"></div></td>
                  </tr>
                ))
              ) : filteredAndSortedSubscriptions.length === 0 ? (
                // Empty state
                <tr>
                  <td colSpan={7} className="py-20">
                    <div className="flex flex-col items-center justify-center text-center">
                      <span className="text-5xl mb-4">📭</span>
                      <h3 className="text-lg font-black text-slate-800 mb-2">לא נמצאו מנויים</h3>
                      <p className="text-sm text-slate-500">
                        {searchTerm || statusFilter !== 'all' || typeFilter !== 'all' 
                          ? 'נסה לשנות את הפילטרים או החיפוש'
                          : 'אין מנויים במערכת כרגע'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : filteredAndSortedSubscriptions.map(sub => (
                <tr key={sub.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-5 font-bold text-slate-800">
                    {resolveStudentName(sub)}
                  </td>
                  <td className="px-6 py-5 text-slate-600">{sub.subscriptionType || '-'}</td>
                  <td className="px-6 py-5 font-black text-slate-900 text-lg">
                    {sub.monthlyAmount || '-'}
                  </td>
                  <td className="px-6 py-5 text-sm text-slate-600">{formatDate(sub.subscriptionStartDate)}</td>
                  <td className="px-6 py-5 text-sm text-slate-600">{formatDate(sub.subscriptionEndDate)}</td>
                  <td className="px-6 py-5 text-center">{getStatusBadge(sub)}</td>
                  <td className="px-6 py-5 text-left">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleEdit(sub)}
                        disabled={isSaving || processingId !== null}
                        className="px-3 py-1.5 bg-slate-50 text-slate-600 text-xs font-black rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        עריכה
                      </button>
                      {(() => {
                        const status = getSubscriptionStatus(sub);
                        const isProcessing = processingId === sub.id || isSaving;
                        if (status === 'paused') {
                          return (
                            <button 
                              onClick={() => handleResume(sub.id)}
                              disabled={isProcessing}
                              className="px-3 py-1.5 bg-emerald-50 text-emerald-600 text-xs font-black rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {isProcessing ? '...' : 'חידוש'}
                            </button>
                          );
                        } else if (status === 'active' || status === 'scheduled') {
                          return (
                            <>
                              <button 
                                onClick={() => handlePause(sub.id)}
                                disabled={isProcessing}
                                className="px-3 py-1.5 bg-amber-50 text-amber-600 text-xs font-black rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isProcessing ? '...' : 'השהיה'}
                              </button>
                              <button 
                                onClick={() => handleEnd(sub.id)}
                                disabled={isProcessing}
                                className="px-3 py-1.5 bg-rose-50 text-rose-600 text-xs font-black rounded-lg hover:bg-rose-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isProcessing ? '...' : 'סיום'}
                              </button>
                            </>
                          );
                        }
                        // Expired subscriptions don't show pause/resume/end buttons
                        return null;
                      })()}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile View Cards */}
        <div className="md:hidden divide-y divide-slate-50">
          {loading ? (
            // Loading skeleton for mobile
            Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="p-5 animate-pulse">
                <div className="flex items-start justify-between mb-3">
                  <div className="text-right flex-1">
                    <div className="h-5 bg-slate-200 rounded w-32 mb-2"></div>
                    <div className="h-4 bg-slate-200 rounded w-24 mb-1"></div>
                    <div className="h-6 bg-slate-200 rounded w-20"></div>
                  </div>
                  <div className="h-6 bg-slate-200 rounded-full w-16"></div>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="h-3 bg-slate-200 rounded w-24"></div>
                  <div className="h-3 bg-slate-200 rounded w-24"></div>
                </div>
                <div className="flex gap-2">
                  <div className="h-8 bg-slate-200 rounded flex-1"></div>
                  <div className="h-8 bg-slate-200 rounded flex-1"></div>
                </div>
              </div>
            ))
          ) : filteredAndSortedSubscriptions.length === 0 ? (
            // Empty state for mobile
            <div className="p-10">
              <div className="flex flex-col items-center justify-center text-center">
                <span className="text-5xl mb-4">📭</span>
                <h3 className="text-lg font-black text-slate-800 mb-2">לא נמצאו מנויים</h3>
                <p className="text-sm text-slate-500">
                  {searchTerm || statusFilter !== 'all' || typeFilter !== 'all' 
                    ? 'נסה לשנות את הפילטרים או החיפוש'
                    : 'אין מנויים במערכת כרגע'}
                </p>
              </div>
            </div>
          ) : filteredAndSortedSubscriptions.map(sub => (
            <div key={sub.id} className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="text-right flex-1">
                  <div className="font-black text-slate-800 text-base mb-1">
                    {resolveStudentName(sub)}
                  </div>
                  <div className="text-sm text-slate-600 mb-1">{sub.subscriptionType || '-'}</div>
                  <div className="text-xl font-black text-slate-900">{sub.monthlyAmount || '-'}</div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {getStatusBadge(sub)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 mb-3">
                <div>
                  <span className="font-bold">התחלה: </span>
                  {formatDate(sub.subscriptionStartDate)}
                </div>
                <div>
                  <span className="font-bold">סיום: </span>
                  {formatDate(sub.subscriptionEndDate)}
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => handleEdit(sub)}
                  disabled={isSaving || processingId !== null}
                  className="flex-1 px-3 py-2 bg-slate-50 text-slate-600 text-xs font-black rounded-lg hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  עריכה
                </button>
                {(() => {
                  const status = getSubscriptionStatus(sub);
                  const isProcessing = processingId === sub.id || isSaving;
                  if (status === 'paused') {
                    return (
                      <button 
                        onClick={() => handleResume(sub.id)}
                        disabled={isProcessing}
                        className="flex-1 px-3 py-2 bg-emerald-50 text-emerald-600 text-xs font-black rounded-lg hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isProcessing ? '...' : 'חידוש'}
                      </button>
                    );
                  } else if (status === 'active' || status === 'scheduled') {
                    return (
                      <>
                        <button 
                          onClick={() => handlePause(sub.id)}
                          disabled={isProcessing}
                          className="flex-1 px-3 py-2 bg-amber-50 text-amber-600 text-xs font-black rounded-lg hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isProcessing ? '...' : 'השהיה'}
                        </button>
                        <button 
                          onClick={() => handleEnd(sub.id)}
                          disabled={isProcessing}
                          className="flex-1 px-3 py-2 bg-rose-50 text-rose-600 text-xs font-black rounded-lg hover:bg-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isProcessing ? '...' : 'סיום'}
                        </button>
                      </>
                    );
                  }
                  // Expired subscriptions don't show pause/resume/end buttons
                  return null;
                })()}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Create/Edit Side Panel */}
      <AppSidePanel
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        title={selectedSubscription ? 'עריכת מנוי' : 'מנוי חדש'}
        width={600}
        loading={isSaving}
        footer={
          <div className="flex gap-3 w-full">
            <button
              onClick={() => setIsModalOpen(false)}
              disabled={isSaving}
              className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-xl font-black hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ביטול
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !selectedStudent}
              className={`flex-1 py-4 rounded-xl font-black shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                isSaving || !selectedStudent
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'
              }`}
            >
              {isSaving ? 'שומר...' : (selectedSubscription ? 'שמור שינויים' : 'צור מנוי')}
            </button>
          </div>
        }
      >
        <div className="space-y-6">
          {/* Student Picker */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">
              תלמיד *
            </label>
            <StudentPicker
              value={selectedStudent}
              onChange={(student) => {
                setSelectedStudent(student);
                setFormData(prev => ({ ...prev, studentId: student?.id || '' }));
              }}
              placeholder="חפש תלמיד..."
            />
          </div>

          {/* Subscription Type */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">
              סוג מנוי
            </label>
            <select
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
              value={formData.subscriptionType || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, subscriptionType: e.target.value }))}
            >
              <option value="">בחר סוג מנוי</option>
              <option value="קבוצתי">קבוצתי</option>
              <option value="זוגי">זוגי</option>
              <option value="פרטני">פרטני</option>
            </select>
          </div>

          {/* Monthly Amount */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">
              סכום חודשי
            </label>
            <input
              type="text"
              placeholder="₪480.00"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
              value={formData.monthlyAmount || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, monthlyAmount: e.target.value }))}
            />
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">
              תאריך התחלה
            </label>
            <input
              type="date"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
              value={formData.subscriptionStartDate || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, subscriptionStartDate: e.target.value }))}
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">
              תאריך סיום
            </label>
            <input
              type="date"
              min={formData.subscriptionStartDate || undefined}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
              value={formData.subscriptionEndDate || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, subscriptionEndDate: e.target.value }))}
            />
            {formData.subscriptionStartDate && formData.subscriptionEndDate && 
             new Date(formData.subscriptionEndDate) < new Date(formData.subscriptionStartDate) && (
              <p className="text-xs text-rose-600 mt-1">תאריך הסיום חייב להיות אחרי תאריך ההתחלה</p>
            )}
          </div>

          {/* Pause Subscription */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="pauseSubscription"
              className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-100"
              checked={formData.pauseSubscription || false}
              onChange={(e) => setFormData(prev => ({ 
                ...prev, 
                pauseSubscription: e.target.checked,
                pauseDate: e.target.checked ? new Date().toISOString().split('T')[0] : ''
              }))}
            />
            <label htmlFor="pauseSubscription" className="text-sm font-bold text-slate-700">
              השהות מנוי
            </label>
          </div>

          {formData.pauseSubscription && (
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 tracking-widest">
                תאריך השהיה
              </label>
              <input
                type="date"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 font-bold outline-none focus:bg-white focus:ring-2 focus:ring-blue-100"
                value={formData.pauseDate || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, pauseDate: e.target.value }))}
              />
            </div>
          )}
        </div>
      </AppSidePanel>

      {/* Toast Notification */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

export default Subscriptions;
