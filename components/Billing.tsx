import React, { useState, useEffect } from 'react';
import { MonthlyBill, BillLineItem } from '../types';
import { nexusApi, parseApiError } from '../services/nexusApi';
import { BillingBreakdown } from '../services/billingDetailsService';
import { ChargesReportKPIs } from '../services/billingService';
import { getMonthlyBills, getBillingKPIs } from '../data/resources/billing';
import { updateBillStatus, createMonthlyCharges as createMonthlyChargesMutation, updateBillAdjustment, deleteBill as deleteBillMutation } from '../data/mutations';
import { generateBillingPdf } from '../services/pdfGenerator';
import { openWhatsApp, normalizePhoneToE164 } from '../services/whatsappUtils';
import { useToast } from '../hooks/useToast';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { exportToCsv } from '../utils/csvExport';

const Billing: React.FC = () => {
  const toast = useToast();
  const { confirm } = useConfirmDialog();
  const [bills, setBills] = useState<MonthlyBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState('2024-03');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedBill, setSelectedBill] = useState<MonthlyBill | null>(null);
  const [isCreatingCharges, setIsCreatingCharges] = useState(false);
  const [adjustmentAmount, setAdjustmentAmount] = useState<string>('');
  const [adjustmentReason, setAdjustmentReason] = useState<string>('');
  const [isEditingAdjustment, setIsEditingAdjustment] = useState(false);
  const [savingAdjustment, setSavingAdjustment] = useState(false);
  const [billingDetails, setBillingDetails] = useState<BillingBreakdown | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  /** Cache breakdowns by billId so table shows correct total even when drawer is closed */
  const [breakdownsCache, setBreakdownsCache] = useState<Record<string, BillingBreakdown>>({});
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [recalculatingBillId, setRecalculatingBillId] = useState<string | null>(null);
  const [kpis, setKpis] = useState<ChargesReportKPIs | null>(null);
  const [loadingKpis, setLoadingKpis] = useState(false);

  // --- Helper Components (defined inside to ensure access to handleToggleStatus and updatingIds) ---
  const getStatusBadge = (bill: MonthlyBill) => {
    let status = 'draft';
    if (bill.paid) status = 'paid';
    else if (bill.linkSent) status = 'link_sent';
    else if (bill.approved) status = 'pending_send';
    
    const styles: Record<string, string> = {
      paid: 'bg-emerald-50 text-emerald-600 border-emerald-100',
      link_sent: 'bg-blue-50 text-blue-600 border-blue-100',
      pending_send: 'bg-rose-50 text-rose-600 border-rose-100 animate-pulse',
      draft: 'bg-slate-50 text-slate-400 border-slate-100',
    };
    const labels: Record<string, string> = {
      paid: 'שולם',
      link_sent: 'נשלח',
      pending_send: 'ממתין לשליחה',
      draft: 'טיוטה',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border transition-all ${styles[status] || styles.draft}`}>
        {labels[status] || status}
      </span>
    );
  };

  /** Display total: use cached or current billingDetails (with subscription logic) when available, else table value */
  const getDisplayTotal = (bill: MonthlyBill): number => {
    const breakdown = billingDetails && bill.id === selectedBill?.id ? billingDetails : breakdownsCache[bill.id];
    if (breakdown) {
      const computedTotal = breakdown.totals.lessonsTotal +
        breakdown.totals.subscriptionsTotal +
        (bill.cancellationsAmount || 0) +
        (bill.manualAdjustmentAmount || 0);
      return computedTotal;
    }
    return bill.totalAmount;
  };

  const StatusCheckbox = ({ 
    billId, 
    field, 
    value, 
    label 
  }: { 
    billId: string, 
    field: 'approved' | 'linkSent' | 'paid', 
    value: boolean, 
    label: string 
  }) => {
    const isUpdating = updatingIds.has(`${billId}-${field}`);
    const activeColor = field === 'paid' ? 'bg-emerald-600 border-emerald-600' : 'bg-blue-600 border-blue-600';
    const textColor = field === 'paid' ? 'text-emerald-600' : 'text-blue-600';
    
    return (
      <button 
        type="button"
        className="flex flex-col items-center gap-1 cursor-pointer group bg-transparent border-none outline-none p-0"
        onClick={(e) => {
          e.stopPropagation();
          if (!isUpdating) handleToggleStatus(billId, field, !value);
        }}
      >
        <div className={`
          w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all
          ${value 
            ? activeColor + ' text-white' 
            : 'border-slate-200 bg-white group-hover:border-blue-300'}
          ${isUpdating ? 'opacity-50' : ''}
        `}>
          {isUpdating ? (
            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : value ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : null}
        </div>
        <span className={`text-[9px] font-black uppercase transition-colors ${value ? textColor : 'text-slate-400'}`}>
          {label}
        </span>
      </button>
    );
  };
  // -------------------------------------------------------------------------------------------

  // Force cache clear on first load after major logic updates
  useEffect(() => {
    const CACHE_CLEANUP_KEY = 'billing_cache_cleanup_v3';
    if (!localStorage.getItem(CACHE_CLEANUP_KEY)) {
      // Clear billing related cache
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('billing') || key.includes('kpis'))) {
          localStorage.removeItem(key);
        }
      }
      localStorage.setItem(CACHE_CLEANUP_KEY, 'true');
      // Reload page to ensure clean state
      window.location.reload();
    }
  }, []);

  useEffect(() => {
    setBreakdownsCache({});
    loadBills();
    loadKPIs();
  }, [selectedMonth, statusFilter, searchTerm]);

  const loadKPIs = async () => {
    setLoadingKpis(true);
    try {
      const data = await getBillingKPIs(selectedMonth);
      setKpis(data);
    } catch (err) {
      console.error('[Billing] Error loading KPIs:', err);
    } finally {
      setLoadingKpis(false);
    }
  };

  // Auto-create charges on 1st of month for previous month
  useEffect(() => {
    const checkAndCreateMonthlyCharges = async () => {
      const now = new Date();
      const today = now.getDate();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      
      // בדיקה אם היום הוא 1 לחודש
      if (today === 1) {
        // חודש שעבר
        const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
        const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
        const billingMonth = `${lastMonthYear}-${String(lastMonth).padStart(2, '0')}`;
        
        // בדיקה אם כבר נוצרו חיובים לחודש הזה היום
        const lastRunKey = `billing_auto_${billingMonth}`;
        const lastRun = localStorage.getItem(lastRunKey);
        const todayStr = now.toISOString().split('T')[0];
        
        if (lastRun !== todayStr) {
          try {
            const result = await nexusApi.createMonthlyCharges(billingMonth);
            localStorage.setItem(lastRunKey, todayStr);
            
            // רענון הרשימה אם זה החודש הנבחר
            if (selectedMonth === billingMonth) {
              await loadBills();
              await loadKPIs();
            }
          } catch (err) {
            console.error(`[Auto Billing] Failed to create charges for ${billingMonth}:`, err);
          }
        }
      }
    };
    
    // בדיקה ראשונית
    checkAndCreateMonthlyCharges();
    
    // בדיקה כל שעה (למקרה שהמשתמש פתח את האפליקציה אחרי 1 לחודש)
    const interval = setInterval(checkAndCreateMonthlyCharges, 60 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [selectedMonth]);

  const loadBills = async () => {
    setLoading(true);
    try {
      // Pass filters to API for server-side filtering
      const filters = {
        statusFilter: statusFilter as 'all' | 'draft' | 'sent' | 'paid' | 'link_sent',
        searchQuery: searchTerm || undefined,
      };
      
      
      const data = await getMonthlyBills(selectedMonth, filters);
      
      
      setBills(data);
    } catch (err) {
      console.error('[Billing] Error loading bills:', err);
      toast.error(parseApiError(err));
      setBills([]); // Set empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleRowClick = async (bill: MonthlyBill) => {
    setSelectedBill(bill);
    setAdjustmentAmount(bill.manualAdjustmentAmount?.toString() || '');
    setAdjustmentReason(bill.manualAdjustmentReason || '');
    setIsEditingAdjustment(false);
    setBillingDetails(null);

    // DEV: Log the selected BillingRowDTO vs current breakdown (if any)

    setLoadingDetails(true);
    try {
      const breakdown = await nexusApi.getBillingBreakdown(bill.studentId, bill.month);
      setBillingDetails(breakdown);
      setBreakdownsCache(prev => ({ ...prev, [bill.id]: breakdown }));

    } catch (error) {
      console.error('[Billing] Failed to load billing details:', error);
      toast.error('לא ניתן לטעון את פירוט החיוב. נסו שוב או רעננו את העמוד.');
      setBillingDetails({
        lessons: [],
        subscriptions: [],
        paidCancellations: [],
        totals: {
          lessonsTotal: 0,
          subscriptionsTotal: 0,
          cancellationsTotal: null,
        },
      });
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedBill || !billingDetails) {
      console.warn('[Billing] Cannot generate PDF: missing bill or details');
      return;
    }

    try {
      // CRITICAL: totals source of truth is the charges row (selectedBill),
      // but line-level breakdown comes from lessons/cancellations/subscriptions tables.
      const sanitizedBreakdown = {
        lessons: billingDetails.lessons.map(l => ({
          id: '',
          date: l.date,
          startTime: '',
          type: l.type,
          status: l.status,
          amount: l.lineAmount,
        })),
        subscriptions: billingDetails.subscriptions.map(s => ({
          id: '',
          type: s.type,
          monthlyAmount: s.amount,
          startDate: s.startDate,
          endDate: s.endDate || undefined,
          isActive: !s.paused,
        })),
        cancellations: billingDetails.paidCancellations.map(c => ({
          id: '',
          date: c.date,
          isLate: c.isLt24h,
          charge: 0, // TODO: extract from cancellation if available
          hoursBefore: c.hoursBefore || 0,
        })),
        manualAdjustment:
          (selectedBill.manualAdjustmentAmount !== undefined &&
            selectedBill.manualAdjustmentAmount !== null) ||
          selectedBill.manualAdjustmentReason
            ? {
                amount: selectedBill.manualAdjustmentAmount || 0,
                reason: selectedBill.manualAdjustmentReason || '',
                date: selectedBill.manualAdjustmentDate || '',
              }
            : undefined,
        totals: {
          lessonsTotal: billingDetails.totals.lessonsTotal,
          subscriptionsTotal: billingDetails.totals.subscriptionsTotal,
          cancellationsTotal: billingDetails.totals.cancellationsTotal ?? selectedBill.cancellationsAmount ?? 0,
          manualAdjustmentTotal: selectedBill.manualAdjustmentAmount || 0,
          // Grand total: same calculation as summary (prefer billingDetails for consistency)
          grandTotal:
            billingDetails.totals.lessonsTotal +
            billingDetails.totals.subscriptionsTotal +
            (billingDetails.totals.cancellationsTotal ?? selectedBill.cancellationsAmount ?? 0) +
            (selectedBill.manualAdjustmentAmount || 0),
        },
      };

      const pdfGrandTotal = sanitizedBreakdown.totals.grandTotal;
      const blob = await generateBillingPdf(
        selectedBill.studentName || '',
        selectedBill.month || '',
        pdfGrandTotal,
        sanitizedBreakdown
      );

      // Download PDF
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `פירוט_חיוב_${selectedBill.studentName}_${selectedBill.month}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[Billing] Failed to generate PDF:', error);
      toast.error(`שגיאה ביצירת PDF: ${error instanceof Error ? error.message : 'שגיאה לא ידועה'}`);
    }
  };

  const handleSendPaymentLink = async () => {
    if (!selectedBill) return;

    // 1. Download PDF first
    await handleDownloadPdf();

    // 2. Prepare WhatsApp message (with payment link)
    const paymentLink = import.meta.env.VITE_PAYMENT_LINK || 'https://pay.grow.link/0caae66323d44f2feb12b471e167be5a-Mjk5ODA4OQ';
    const parentName = selectedBill.parentName || selectedBill.studentName;
    const totalAmount = getDisplayTotal(selectedBill);
    const phone = selectedBill.parentPhone;

    const message = `היי ${parentName} מצורף קישור לתשלום, ופירוט החיוב. הסכום לתשלום החודש הוא ₪${totalAmount}. קישור לתשלום: ${paymentLink} אודה להסדרת התשלום בהקדם.`;

    if (!phone) {
      toast.error('לא נמצא מספר טלפון להורה. אנא עדכן את פרטי התלמיד.');
      return;
    }

    const normalizedPhone = normalizePhoneToE164(phone);
    if (!normalizedPhone) {
      toast.error('מספר הטלפון של ההורה לא תקין.');
      return;
    }

    // 3. Open WhatsApp
    openWhatsApp(normalizedPhone, message);
  };

  const handleCreateMonthlyCharges = async () => {
    // אם זה חודש נוכחי, יצור חיובים עד עכשיו
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    const targetMonth = selectedMonth === currentMonth 
      ? currentMonth  // במהלך החודש - עד עכשיו
      : selectedMonth; // חודש שעבר - כל החודש
    
    const confirmed = await confirm({
      title: 'יצירת חיובים חודשיים',
      message: `האם ליצור חיובים חודשיים לחודש ${targetMonth}?`,
      variant: 'info',
      confirmLabel: 'צור חיובים',
      cancelLabel: 'ביטול'
    });
    if (!confirmed) return;
    
    setIsCreatingCharges(true);
    try {
      const result = await createMonthlyChargesMutation(targetMonth);
      toast.success(`נוצרו ${result.createdCount} חיובים חדשים. ${result.skippedCount} חיובים כבר קיימים.`);
      // רענון הרשימה
      await loadBills();
      await loadKPIs();
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setIsCreatingCharges(false);
    }
  };

  const handleToggleStatus = async (billId: string, field: 'approved' | 'linkSent' | 'paid', value: boolean) => {
    // 1. Optimistic update for immediate feedback
    setBills(prev => prev.map(b => 
      b.id === billId ? { ...b, [field]: value } : b
    ));

    // Also update selectedBill if it's the same bill
    if (selectedBill && selectedBill.id === billId) {
      setSelectedBill({ ...selectedBill, [field]: value });
    }

    setUpdatingIds(prev => new Set(prev).add(`${billId}-${field}`));
    
    try {
      await updateBillStatus(billId, { [field]: value }, selectedMonth);
      
      // Refresh KPIs to reflect the change in totals
      loadKPIs();
    } catch (err) {
      console.error('[Billing] Failed to update status:', err);
      
      // 2. Revert optimistic update on failure
      setBills(prev => prev.map(b => 
        b.id === billId ? { ...b, [field]: !value } : b
      ));
      
      // Revert selectedBill too
      if (selectedBill && selectedBill.id === billId) {
        setSelectedBill({ ...selectedBill, [field]: !value });
      }
      
      const apiErr = parseApiError(err);
      toast.error(`נכשל בעדכון הסטטוס - ${apiErr}`);
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(`${billId}-${field}`);
        return next;
      });
    }
  };

  const handleDeleteBill = async (billId: string, billMonth?: string) => {
    const bill = bills.find(b => b.id === billId);
    const billDisplayName = bill?.studentName || 'החיוב';
    
    const confirmed = await confirm({
      title: 'מחיקת חיוב',
      message: `האם אתה בטוח שברצונך למחוק את החיוב של ${billDisplayName}? פעולה זו לא ניתנת לביטול.`,
      variant: 'danger',
      confirmLabel: 'מחק חיוב',
      cancelLabel: 'ביטול'
    });
    if (!confirmed) return;

    setDeletingIds(prev => new Set(prev).add(billId));
    
    try {
      await deleteBillMutation(billId, billMonth || selectedMonth);
      
      // Remove from local state
      setBills(prev => prev.filter(b => b.id !== billId));
      
      // Close drawer if the deleted bill was selected
      if (selectedBill?.id === billId) {
        setSelectedBill(null);
      }
      
      // Refresh KPIs to reflect the change
      await loadKPIs();
      toast.success('החיוב נמחק בהצלחה');
    } catch (err) {
      console.error('[Billing] Failed to delete bill:', err);
      const apiErr = parseApiError(err);
      toast.error(`נכשל במחיקת החיוב - ${apiErr}`);
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(billId);
        return next;
      });
    }
  };

  // No need for client-side filtering anymore - API handles it
  const filteredBills = bills;

  return (
    <div className="space-y-6 md:space-y-8 animate-in fade-in duration-500 pb-20">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {/* Card 1: Month Selector */}
        <div className="bg-white p-5 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center">
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase mb-2 block">בחר חודש לחיוב</label>
            <input 
              type="month" 
              value={selectedMonth} 
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full text-lg font-black text-slate-800 bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 outline-none"
            />
          </div>
        </div>

        {/* Card 2: Total to Bill */}
        <div className="bg-white p-5 md:p-6 rounded-2xl md:rounded-3xl border border-slate-200 shadow-sm flex flex-col justify-center">
          <div>
            <div className="text-slate-400 text-[10px] font-black uppercase mb-1">סה"כ לחיוב</div>
            <div className="text-2xl md:text-3xl font-black text-slate-800">
              {loadingKpis ? '...' : `₪${(kpis?.totalToBill ?? 0).toLocaleString()}`}
            </div>
          </div>
        </div>

        {/* Card 3: Paid */}
        <div className="bg-emerald-50 p-5 md:p-6 rounded-2xl md:rounded-3xl border border-emerald-100 shadow-sm flex flex-col justify-center">
          <div>
            <div className="text-emerald-400 text-[10px] font-black uppercase mb-1">שולם</div>
            <div className="text-2xl md:text-3xl font-black text-emerald-600">
              {loadingKpis ? '...' : `₪${(kpis?.paidTotal ?? 0).toLocaleString()}`}
            </div>
          </div>
        </div>

        {/* Card 4: Pending */}
        <div className="bg-rose-50 p-5 md:p-6 rounded-2xl md:rounded-3xl border border-rose-100 shadow-sm flex flex-col justify-center">
          <div>
            <div className="text-rose-400 text-[10px] font-black uppercase mb-1">ממתין לתשלום</div>
            <div className="text-2xl md:text-3xl font-black text-rose-600">
              {loadingKpis ? '...' : `₪${(kpis?.pendingTotal ?? 0).toLocaleString()}`}
            </div>
          </div>
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
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (filteredBills.length === 0) return;
              const headers = [
                { key: 'studentName', label: 'תלמיד' },
                { key: 'parentName', label: 'הורה' },
                { key: 'month', label: 'חודש' },
                { key: 'lessonsCount', label: 'מספר שיעורים' },
                { key: 'lessonsAmount', label: 'סכום שיעורים (₪)' },
                { key: 'subscriptionsAmount', label: 'מנויים (₪)' },
                { key: 'cancellationsAmount', label: 'ביטולים (₪)' },
                { key: 'manualAdjustmentAmount', label: 'התאמה ידנית (₪)' },
                { key: 'totalAmount', label: 'סה"כ (₪)' },
                { key: 'statusLabel', label: 'סטטוס' },
              ];
              const rows = filteredBills.map(bill => {
                let statusLabel = 'טיוטה';
                if (bill.paid) statusLabel = 'שולם';
                else if (bill.linkSent) statusLabel = 'נשלח';
                else if (bill.approved) statusLabel = 'ממתין לשליחה';
                return {
                  studentName: bill.studentName,
                  parentName: bill.parentName || '',
                  month: bill.month,
                  lessonsCount: bill.lessonsCount || 0,
                  lessonsAmount: bill.lessonsAmount || 0,
                  subscriptionsAmount: bill.subscriptionsAmount || 0,
                  cancellationsAmount: bill.cancellationsAmount || 0,
                  manualAdjustmentAmount: bill.manualAdjustmentAmount || 0,
                  totalAmount: getDisplayTotal(bill),
                  statusLabel,
                };
              });
              exportToCsv(`חיובים_${selectedMonth}.csv`, headers, rows);
            }}
            disabled={filteredBills.length === 0}
            className="h-12 bg-white border border-slate-200 text-slate-600 px-5 rounded-xl font-black text-sm hover:bg-slate-50 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ייצוא CSV
          </button>
          <button 
            onClick={handleCreateMonthlyCharges}
            disabled={isCreatingCharges}
            className={`h-12 bg-blue-600 text-white px-6 rounded-xl font-black text-sm shadow-lg shadow-blue-100 hover:bg-blue-700 active:scale-95 transition-all ${
              isCreatingCharges ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {isCreatingCharges ? 'יוצר חיובים...' : 'צור חיובים חודשיים'}
          </button>
        </div>
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
                <th className="px-6 py-4 text-center">מאושר</th>
                <th className="px-6 py-4 text-center">נשלח</th>
                <th className="px-6 py-4 text-center">שולם</th>
                <th className="px-6 py-4 text-left">פעולות</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="py-16 text-center text-slate-400">טוען...</td></tr>
              ) : filteredBills.length === 0 ? (
                <tr><td colSpan={8} className="py-16 text-center text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <div className="text-lg font-bold">אין חיובים להצגה</div>
                    <div className="text-sm">נסה לשנות את החודש או את הפילטרים</div>
                  </div>
                </td></tr>
              ) : filteredBills.map(bill => (
                <tr key={bill.id} className="hover:bg-slate-50/50 cursor-pointer active:bg-slate-100 transition-colors" onClick={() => handleRowClick(bill)}>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="font-bold text-slate-800">{bill.studentName}</div>
                      {getStatusBadge(bill)}
                    </div>
                    <div className="text-[10px] text-slate-400 font-bold">{bill.month}</div>
                  </td>
                  <td className="px-6 py-5 text-sm text-slate-600">
                    <div>{bill.lessonsCount || 0} שיעורים</div>
                    <div className="text-[10px] text-slate-400">₪{bill.lessonsAmount || 0}</div>
                  </td>
                  <td className="px-6 py-5 text-sm text-slate-600">
                    <div>₪{bill.subscriptionsAmount || 0}</div>
                    {bill.cancellationsAmount ? (
                      <div className="text-[10px] text-rose-400">ביטולים: ₪{bill.cancellationsAmount}</div>
                    ) : null}
                  </td>
                  <td className="px-6 py-5 font-black text-slate-900 text-lg">₪{getDisplayTotal(bill)}</td>
                  <td className="px-2 py-5 text-center">
                    <StatusCheckbox 
                      billId={bill.id} 
                      field="approved" 
                      value={bill.approved} 
                      label="מאושר" 
                    />
                  </td>
                  <td className="px-2 py-5 text-center">
                    <StatusCheckbox 
                      billId={bill.id} 
                      field="linkSent" 
                      value={bill.linkSent} 
                      label="נשלח" 
                    />
                  </td>
                  <td className="px-2 py-5 text-center">
                    <StatusCheckbox 
                      billId={bill.id} 
                      field="paid" 
                      value={bill.paid} 
                      label="שולם" 
                    />
                  </td>
                  <td className="px-6 py-5 text-left">
                    <div className="flex gap-2">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteBill(bill.id, bill.month);
                        }}
                        disabled={deletingIds.has(bill.id)}
                        className={`p-2 bg-slate-50 text-slate-400 rounded-lg hover:bg-rose-50 hover:text-rose-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                          deletingIds.has(bill.id) ? 'opacity-50' : ''
                        }`}
                        title="מחק חיוב"
                      >
                        {deletingIds.has(bill.id) ? (
                          <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          '🗑️'
                        )}
                      </button>
                    </div>
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
          ) : filteredBills.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              <div className="flex flex-col items-center gap-2">
                <div className="text-lg font-bold">אין חיובים להצגה</div>
                <div className="text-sm">נסה לשנות את החודש או את הפילטרים</div>
              </div>
            </div>
          ) : filteredBills.map(bill => (
            <div key={bill.id} className="p-5 active:bg-slate-50 transition-colors" onClick={() => handleRowClick(bill)}>
              <div className="flex items-center justify-between mb-3">
                <div className="text-right">
                  <div className="font-black text-slate-800 flex items-center gap-2">
                    {bill.studentName}
                    {getStatusBadge(bill)}
                  </div>
                  <div className="text-[10px] font-bold text-slate-400">{bill.month}</div>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                   <div className="flex gap-4">
                      <div className="text-[10px] font-bold text-slate-500">שיעורים: {bill.lessonsCount || 0}</div>
                      <div className="text-[10px] font-bold text-slate-500">מנוי: ₪{bill.subscriptionsAmount}</div>
                   </div>
                   <div className="flex gap-4 mt-2">
                     <StatusCheckbox billId={bill.id} field="approved" value={bill.approved} label="מאושר" />
                     <StatusCheckbox billId={bill.id} field="linkSent" value={bill.linkSent} label="נשלח" />
                     <StatusCheckbox billId={bill.id} field="paid" value={bill.paid} label="שולם" />
                   </div>
                </div>
                <div className="text-lg font-black text-slate-900 text-left">
                  <div className="text-[9px] text-slate-400 font-black uppercase text-left">סה"כ</div>
                  ₪{getDisplayTotal(bill)}
                </div>
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
                <button
                  onClick={() => setSelectedBill(null)}
                  className="p-2 hover:bg-white rounded-xl transition-all"
                >
                  ✕
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={handleDownloadPdf}
                    disabled={!billingDetails || loadingDetails}
                    className="hidden sm:block px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold shadow-sm hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    PDF
                  </button>
                  <button
                    onClick={handleSendPaymentLink}
                    disabled={!billingDetails || loadingDetails}
                    className="px-6 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-100 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    שלח קישור תשלום
                  </button>
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
                    <div className="text-2xl md:text-4xl font-black text-slate-900 leading-none">₪{getDisplayTotal(selectedBill)}</div>
                 </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 custom-scrollbar bg-[#fcfdfe]">
              {/* Summary from Charges Table (Always visible) */}
              <section className="bg-blue-50/30 p-6 rounded-2xl border border-blue-100">
                <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-4">
                  נתונים מצטברים מטבלת &quot;חיובים&quot;
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-4 rounded-xl border border-blue-50">
                    <div className="text-[9px] font-black text-slate-400 uppercase mb-1">סה&quot;כ לתשלום החודש</div>
                    <div className="text-xl font-black text-slate-900">₪{getDisplayTotal(selectedBill)}</div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-blue-50">
                    <div className="text-[9px] font-black text-slate-400 uppercase mb-1">שיעורים שבוצעו</div>
                    <div className="text-xl font-black text-slate-900">{selectedBill.lessonsCount || 0}</div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-blue-50">
                    <div className="text-[9px] font-black text-slate-400 uppercase mb-1">מנוי חודשי</div>
                    <div className="text-xl font-black text-slate-900">₪{selectedBill.subscriptionsAmount}</div>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-blue-50">
                    <div className="text-[9px] font-black text-slate-400 uppercase mb-1">התאמה ידנית</div>
                    <div className={`text-xl font-black ${selectedBill.manualAdjustmentAmount && selectedBill.manualAdjustmentAmount < 0 ? 'text-emerald-600' : 'text-blue-600'}`}>
                      {selectedBill.manualAdjustmentAmount && selectedBill.manualAdjustmentAmount > 0 ? '+' : ''}
                      ₪{selectedBill.manualAdjustmentAmount || 0}
                    </div>
                  </div>
                </div>
                {selectedBill.manualAdjustmentReason && (
                  <div className="mt-3 text-[10px] font-bold text-slate-500 bg-white/50 p-2 rounded-lg border border-blue-50/50">
                    סיבת התאמה: {selectedBill.manualAdjustmentReason}
                  </div>
                )}
              </section>

              {loadingDetails ? (
                <div className="flex items-center justify-center py-16 text-slate-400">
                  טוען פירוט...
                </div>
              ) : billingDetails ? (
                <>
                  {/* Lessons Section - Always show section header, even if empty */}
                  <section>
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">
                      שיעורים ({billingDetails.lessons.length})
                    </h3>
                    {billingDetails.lessons.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200">
                              <th className="text-right py-2 px-3 text-[10px] font-black text-slate-400 uppercase">
                                תאריך
                              </th>
                              <th className="text-right py-2 px-3 text-[10px] font-black text-slate-400 uppercase">
                                סוג שיעור
                              </th>
                              <th className="text-right py-2 px-3 text-[10px] font-black text-slate-400 uppercase">
                                מחיר יחידה
                              </th>
                              <th className="text-right py-2 px-3 text-[10px] font-black text-slate-400 uppercase">
                                סכום לחיוב
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {billingDetails.lessons.map((lesson, idx) => (
                              <tr
                                key={idx}
                                className="border-b border-slate-50 hover:bg-slate-50/50"
                              >
                                <td className="py-3 px-3 text-slate-700 font-bold">{lesson.date}</td>
                                <td className="py-3 px-3 text-slate-700">{lesson.type}</td>
                                <td className="py-3 px-3 text-slate-500">₪{lesson.unitPrice}</td>
                                <td className="py-3 px-3 text-slate-800 font-black">
                                  ₪{lesson.lineAmount}
                                </td>
                              </tr>
                            ))}
                            <tr className="bg-slate-50 font-bold text-slate-700">
                              <td colSpan={3} className="py-3 px-3 text-right">
                                סה&quot;כ שיעורים:
                              </td>
                              <td className="py-3 px-3 text-right font-black">
                                ₪{billingDetails.totals.lessonsTotal.toLocaleString()}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="py-4 text-center text-slate-400 text-sm">
                        אין שיעורים לחודש זה
                      </div>
                    )}
                  </section>

                  {/* Subscriptions Section - Always show section header, even if empty */}
                  <section>
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">
                      מנויים ({billingDetails.subscriptions.filter(s => !s.paused).length} פעיל)
                    </h3>
                    {billingDetails.subscriptions.length > 0 ? (
                      <div className="space-y-2 md:space-y-3">
                        {billingDetails.subscriptions.map((sub, idx) => (
                          <div
                            key={idx}
                            className={`flex items-center justify-between p-4 rounded-xl md:rounded-2xl border transition-all ${
                              !sub.paused
                                ? 'border-emerald-100 bg-emerald-50/30'
                                : 'border-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs ${
                                  !sub.paused
                                    ? 'bg-emerald-100 text-emerald-600'
                                    : 'bg-slate-50 text-slate-400'
                                }`}
                              >
                                📋
                              </span>
                              <div>
                                <div className="font-bold text-slate-700 text-sm">
                                  מנוי {sub.type}{' '}
                                  {!sub.paused ? '(פעיל)' : '(מושהה/לא פעיל)'}
                                </div>
                                <div className="text-[10px] text-slate-400 font-bold">
                                  מתאריך: {sub.startDate}
                                  {sub.endDate && ` עד ${sub.endDate}`}
                                </div>
                              </div>
                            </div>
                            <div
                              className={`font-black text-sm ${
                                !sub.paused ? 'text-emerald-700' : 'text-slate-500'
                              }`}
                            >
                              ₪{sub.amount}
                            </div>
                          </div>
                        ))}
                        {billingDetails.totals.subscriptionsTotal > 0 && (
                          <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl font-bold text-emerald-700">
                            <span>סה&quot;כ מנויים:</span>
                            <span>
                              ₪{billingDetails.totals.subscriptionsTotal.toLocaleString()}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="py-4 text-center text-slate-400 text-sm">
                        אין מנויים פעילים לחודש זה
                      </div>
                    )}
                  </section>

                  {/* Paid Cancellations Section - Always show section header, even if empty */}
                  <section>
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">
                      ביטולים בתשלום ({billingDetails.paidCancellations.length})
                    </h3>
                    {billingDetails.paidCancellations.length > 0 ? (
                      <div className="space-y-2 md:space-y-3">
                        {billingDetails.paidCancellations.map((c, idx) => (
                          <div
                            key={idx}
                            className={`flex items-center justify-between p-4 rounded-xl md:rounded-2xl border transition-all ${
                              c.isLt24h
                                ? 'border-rose-100 bg-rose-50/30'
                                : 'border-slate-50'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span
                                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs ${
                                  c.isLt24h
                                    ? 'bg-rose-100 text-rose-600'
                                    : 'bg-slate-50 text-slate-400'
                                }`}
                              >
                                🚫
                              </span>
                              <div>
                                <div className="font-bold text-slate-700 text-sm">
                                  ביטול {c.isLt24h ? '<24 שעות' : '≥24 שעות'}
                                </div>
                                <div className="text-[10px] text-slate-400 font-bold">
                                  תאריך: {c.date}
                                </div>
                                {c.hoursBefore != null && (
                                  <div className="text-[10px] text-slate-400 font-bold">
                                    {c.hoursBefore} שעות לפני השיעור
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center justify-between p-3 bg-rose-50 rounded-xl font-bold text-rose-700">
                          <span>סה&quot;כ ביטולים בתשלום:</span>
                          <span>{billingDetails.paidCancellations.length}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="py-4 text-center text-slate-400 text-sm">
                        אין ביטולים בתשלום לחודש זה
                      </div>
                    )}
                  </section>

                  {/* Manual Adjustments Section */}
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        התאמה ידנית
                      </h3>
                      {!isEditingAdjustment && (
                        <button
                          onClick={() => setIsEditingAdjustment(true)}
                          className="text-[10px] font-bold text-blue-600 hover:text-blue-700 px-3 py-1 rounded-lg hover:bg-blue-50 transition-all"
                        >
                          {selectedBill.manualAdjustmentAmount ? 'ערוך' : 'הוסף התאמה'}
                        </button>
                      )}
                    </div>

                    {isEditingAdjustment ? (
                      <div className="bg-white p-4 rounded-xl md:rounded-2xl border border-blue-100 space-y-4">
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 uppercase mb-2">
                            סכום התאמה (₪)
                          </label>
                          <input
                            type="number"
                            step="1"
                            value={adjustmentAmount}
                            onChange={(e) => setAdjustmentAmount(e.target.value)}
                            placeholder="0"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                          />
                          <div className="text-[9px] text-slate-400 mt-1">
                            השתמש בערך שלילי להפחתה, חיובי לתוספת
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-slate-400 uppercase mb-2">
                            סיבת ההתאמה
                          </label>
                          <textarea
                            value={adjustmentReason}
                            onChange={(e) => setAdjustmentReason(e.target.value)}
                            placeholder="הסבר את סיבת ההתאמה..."
                            rows={3}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 resize-none"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              setSavingAdjustment(true);
                              try {
                                const amount = parseFloat(adjustmentAmount) || 0;
                                await updateBillAdjustment(selectedBill.id, {
                                  amount,
                                  reason: adjustmentReason || '',
                                });
                                
                                // Refresh the bills list to get updated data
                                const filters = {
                                  statusFilter: statusFilter as 'all' | 'draft' | 'sent' | 'paid',
                                  searchQuery: searchTerm || undefined,
                                };
                                const updatedBills = await getMonthlyBills(selectedMonth, filters);
                                setBills(updatedBills);
                                
                                // Find the updated bill in the refreshed list
                                const updatedBill = updatedBills.find(b => b.id === selectedBill.id);
                                
                                if (updatedBill) {
                                  setSelectedBill(updatedBill);
                                  setAdjustmentAmount(updatedBill.manualAdjustmentAmount?.toString() || '');
                                  setAdjustmentReason(updatedBill.manualAdjustmentReason || '');
                                } else {
                                  // If not found, update manually
                                  setSelectedBill({
                                    ...selectedBill,
                                    manualAdjustmentAmount: amount,
                                    manualAdjustmentReason: adjustmentReason || undefined,
                                    manualAdjustmentDate: new Date().toISOString().split('T')[0],
                                    totalAmount: (selectedBill.lessonsAmount || 0) + 
                                                (selectedBill.subscriptionsAmount || 0) + 
                                                (selectedBill.cancellationsAmount || 0) + 
                                                amount,
                                  });
                                }
                                
                                setIsEditingAdjustment(false);
                                
                                // Refresh KPIs to reflect the change
                                await loadKPIs();
                              } catch (err) {
                                toast.error(parseApiError(err));
                              } finally {
                                setSavingAdjustment(false);
                              }
                            }}
                            disabled={savingAdjustment}
                            className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-black shadow-lg shadow-blue-100 hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {savingAdjustment ? 'שומר...' : 'שמור התאמה'}
                          </button>
                          <button
                            onClick={() => {
                              setIsEditingAdjustment(false);
                              setAdjustmentAmount(selectedBill.manualAdjustmentAmount?.toString() || '');
                              setAdjustmentReason(selectedBill.manualAdjustmentReason || '');
                            }}
                            disabled={savingAdjustment}
                            className="px-6 py-3 bg-white border border-slate-200 text-slate-400 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all disabled:opacity-50"
                          >
                            ביטול
                          </button>
                        </div>
                      </div>
                    ) : (
                      // Display existing adjustment if exists
                      (selectedBill.manualAdjustmentAmount !== undefined &&
                        selectedBill.manualAdjustmentAmount !== null &&
                        selectedBill.manualAdjustmentAmount !== 0) ||
                      selectedBill.manualAdjustmentReason ||
                      selectedBill.manualAdjustmentDate ? (
                        <div
                          className={`flex items-center justify-between p-4 rounded-xl md:rounded-2xl border transition-all ${
                            ((selectedBill as any).manualAdjustmentAmount || 0) >= 0
                              ? 'border-blue-100 bg-blue-50/30'
                              : 'border-emerald-100 bg-emerald-50/30'
                          }`}
                        >
                          <div className="flex items-center gap-3 flex-1">
                            <span
                              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs shrink-0 ${
                                (selectedBill.manualAdjustmentAmount || 0) >= 0
                                  ? 'bg-blue-100 text-blue-600'
                                  : 'bg-emerald-100 text-emerald-600'
                              }`}
                            >
                              ✏️
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-bold text-slate-700 mb-2">
                                סכום התאמה ידנית: ₪{selectedBill.manualAdjustmentAmount ?? 0}
                              </div>
                              <div className="text-[10px] text-slate-500 font-bold mb-1">
                                סיבה: {selectedBill.manualAdjustmentReason || '—'}
                              </div>
                              {selectedBill.manualAdjustmentDate && (
                                <div className="text-[10px] text-slate-500 font-bold">
                                  תאריך: {selectedBill.manualAdjustmentDate}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-slate-50 p-6 rounded-xl border border-slate-100 text-center">
                          <div className="text-sm text-slate-400 mb-2">אין התאמה ידנית</div>
                          <div className="text-[10px] text-slate-300">לחץ על "הוסף התאמה" כדי להוסיף</div>
                        </div>
                      )
                    )}
                  </section>

                  {/* Totals Summary - prefer billingDetails (with subscription logic) when available */}
                  <section className="p-6 bg-slate-50 rounded-2xl md:rounded-3xl border border-slate-100">
                    {(() => {
                      const summaryLessons = billingDetails ? billingDetails.totals.lessonsTotal : (selectedBill.lessonsAmount || 0);
                      const summarySubs = billingDetails ? billingDetails.totals.subscriptionsTotal : (selectedBill.subscriptionsAmount || 0);
                      const summaryCancellations = selectedBill.cancellationsAmount || 0;
                      const summaryAdjustment = selectedBill.manualAdjustmentAmount || 0;
                      const summaryTotal = summaryLessons + summarySubs + summaryCancellations + summaryAdjustment;
                      return (
                    <>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-black text-slate-800">סיכום</h3>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!selectedBill?.studentId || !selectedBill?.month || recalculatingBillId) return;
                          setRecalculatingBillId(selectedBill.id);
                          try {
                            await nexusApi.recalculateBill(selectedBill.studentId, selectedBill.month);
                            toast.success('החיוב חושב מחדש בהצלחה');
                            const filters = {
                              statusFilter: statusFilter as 'all' | 'draft' | 'sent' | 'paid',
                              searchQuery: searchTerm || undefined,
                            };
                            const updatedBills = await getMonthlyBills(selectedMonth, filters);
                            setBills(updatedBills);
                            const updated = updatedBills.find(b => b.id === selectedBill.id);
                            if (updated) setSelectedBill(updated);
                            await loadKPIs();
                          } catch (err) {
                            toast.error(parseApiError(err));
                          } finally {
                            setRecalculatingBillId(null);
                          }
                        }}
                        disabled={!!recalculatingBillId}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {recalculatingBillId === selectedBill?.id ? 'מחשב...' : 'חשב מחדש'}
                      </button>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">שיעורים:</span>
                        <span className="font-bold text-slate-800">
                          ₪{summaryLessons.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">מנויים:</span>
                        <span className="font-bold text-slate-800">
                          ₪{summarySubs.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">ביטולים:</span>
                        <span className="font-bold text-slate-800">
                          ₪{summaryCancellations.toLocaleString()}
                        </span>
                      </div>
                      {summaryAdjustment !== 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-600">התאמה ידנית:</span>
                            <span
                              className={`font-bold ${
                                summaryAdjustment >= 0
                                  ? 'text-blue-800'
                                  : 'text-emerald-800'
                              }`}
                            >
                              {summaryAdjustment >= 0 ? '+' : ''}
                              ₪{summaryAdjustment}
                            </span>
                          </div>
                        )}
                      <div className="flex items-center justify-between text-lg pt-2 border-t border-slate-200">
                        <span className="font-black text-slate-900">סה&quot;כ:</span>
                        <span className="font-black text-slate-900">
                          ₪{summaryTotal.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    </>
                    );
                    })()}
                  </section>
                </>
              ) : (
                // Fallback: show line items from charges table if breakdown is unavailable
                <>
                  <section>
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">
                      פירוט חיובים מטבלת &quot;חיובים&quot;
                    </h3>
                    <div className="space-y-2 md:space-y-3">
                      {selectedBill.lineItems && selectedBill.lineItems.length > 0 ? (
                        selectedBill.lineItems.map((item: BillLineItem) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-4 rounded-xl md:rounded-2xl border border-slate-50 hover:bg-slate-50/50 transition-all"
                          >
                            <div className="flex items-center gap-3">
                              <span className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center text-xs">
                                📅
                              </span>
                              <div>
                                <div className="font-bold text-slate-700 text-sm">{item.description}</div>
                                {item.date && (
                                  <div className="text-[10px] text-slate-400 font-bold">{item.date}</div>
                                )}
                              </div>
                            </div>
                            <div className="font-black text-slate-800 text-sm">₪{item.amount}</div>
                          </div>
                        ))
                      ) : (
                        <div className="py-8 text-center text-slate-400 text-sm">
                          אין פירוט זמין מרשומת החיוב.
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Totals Summary - always show, even in fallback */}
                  <section className="p-6 bg-slate-50 rounded-2xl md:rounded-3xl border border-slate-100">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-black text-slate-800">סיכום</h3>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!selectedBill?.studentId || !selectedBill?.month || recalculatingBillId) return;
                          setRecalculatingBillId(selectedBill.id);
                          try {
                            await nexusApi.recalculateBill(selectedBill.studentId, selectedBill.month);
                            toast.success('החיוב חושב מחדש בהצלחה');
                            const filters = {
                              statusFilter: statusFilter as 'all' | 'draft' | 'sent' | 'paid',
                              searchQuery: searchTerm || undefined,
                            };
                            const updatedBills = await getMonthlyBills(selectedMonth, filters);
                            setBills(updatedBills);
                            const updated = updatedBills.find(b => b.id === selectedBill.id);
                            if (updated) setSelectedBill(updated);
                            await loadKPIs();
                          } catch (err) {
                            toast.error(parseApiError(err));
                          } finally {
                            setRecalculatingBillId(null);
                          }
                        }}
                        disabled={!!recalculatingBillId}
                        className="text-[10px] font-bold text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {recalculatingBillId === selectedBill?.id ? 'מחשב...' : 'חשב מחדש'}
                      </button>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">שיעורים:</span>
                        <span className="font-bold text-slate-800">
                          ₪{(selectedBill.lessonsAmount || 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">מנויים:</span>
                        <span className="font-bold text-slate-800">
                          ₪{(selectedBill.subscriptionsAmount || 0).toLocaleString()}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">ביטולים:</span>
                        <span className="font-bold text-slate-800">
                          ₪{(selectedBill.cancellationsAmount || 0).toLocaleString()}
                        </span>
                      </div>
                      {selectedBill.manualAdjustmentAmount !== undefined &&
                        selectedBill.manualAdjustmentAmount !== null &&
                        selectedBill.manualAdjustmentAmount !== 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-600">התאמה ידנית:</span>
                            <span
                              className={`font-bold ${
                                selectedBill.manualAdjustmentAmount >= 0
                                  ? 'text-blue-800'
                                  : 'text-emerald-800'
                              }`}
                            >
                              {selectedBill.manualAdjustmentAmount >= 0 ? '+' : ''}
                              ₪{selectedBill.manualAdjustmentAmount}
                            </span>
                          </div>
                        )}
                      <div className="flex items-center justify-between text-lg pt-2 border-t border-slate-200">
                        <span className="font-black text-slate-900">סה&quot;כ:</span>
                        <span className="font-black text-slate-900">
                          ₪{selectedBill.totalAmount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </section>
                </>
              )}
            </div>

            <div className="p-6 md:p-8 bg-slate-50 border-t border-slate-200 flex gap-3 shrink-0 pb-10 md:pb-8">
               <button 
                 onClick={() => {
                   if (selectedBill && !selectedBill.paid) {
                     handleToggleStatus(selectedBill.id, 'paid', true);
                   }
                 }}
                 disabled={selectedBill ? (updatingIds.has(`${selectedBill.id}-paid`) || selectedBill.paid) : false}
                 className={`flex-1 py-4 md:py-5 bg-emerald-600 text-white rounded-2xl font-black shadow-lg active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                   selectedBill && updatingIds.has(`${selectedBill.id}-paid`) ? 'opacity-50' : ''
                 }`}
               >
                 {selectedBill && updatingIds.has(`${selectedBill.id}-paid`) ? 'מעדכן...' : selectedBill?.paid ? 'שולם ✓' : 'סמן כשולם (מזומן)'}
               </button>
               <button 
                 onClick={() => {
                   if (selectedBill) {
                     handleDeleteBill(selectedBill.id, selectedBill.month);
                   }
                 }}
                 disabled={selectedBill ? deletingIds.has(selectedBill.id) : false}
                 className={`px-6 md:px-8 py-4 md:py-5 bg-rose-600 text-white rounded-2xl font-bold hover:bg-rose-700 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                   selectedBill && deletingIds.has(selectedBill.id) ? 'opacity-50' : ''
                 }`}
               >
                 {selectedBill && deletingIds.has(selectedBill.id) ? 'מוחק...' : 'מחק חיוב'}
               </button>
               <button className="px-6 md:px-8 py-4 md:py-5 bg-white border border-slate-200 text-slate-400 rounded-2xl font-bold" onClick={() => setSelectedBill(null)}>סגור</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Billing;
