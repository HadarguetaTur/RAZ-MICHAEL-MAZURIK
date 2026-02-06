/**
 * Unified hook for Dashboard data aggregation
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLessons } from './useLessons';
import { useBilling } from './useBilling';
import { getBillingKPIs, getMonthlyBills } from '../resources/billing';
import { invalidateLessons } from '../resources/lessons';
import { invalidateBilling } from '../resources/billing';
import { MonthlyBill } from '../../types';
import { ChargesReportKPIs } from '../../services/billingService';
import { useStudents } from '../../hooks/useStudents';
import { nexusApi } from '../../services/nexusApi';
import { getSlotInventory } from '../resources/slotInventory';

export interface DashboardMetrics {
  daily: {
    lessonsToday: number;
    completedToday: number;
    cancelledToday: number;
    missingAttendance: number;
    remindersSentPercent: number;
    lastMinuteCancellations: number;
  };
  students: {
    totalActive: number;
    onHold: number;
    inactive: number;
    withBalance: number;
  };
  billing: {
    openAmount: number;
    paidThisMonth: number;
    overdueCount: number;
    overdueTotal: number;
    billsCount: number;
    collectionRate: number;
    pendingLinkCount: number;
    totalLessonsAmount?: number;
    totalSubscriptionsAmount?: number;
  };
  cancellations: {
    totalCancellations: number;
    lateCancellations: number;
    latePercent: number;
    revenueFromLate: number;
  };
  lessonsStats: {
    scheduled: number;
    completed: number;
    cancelled: number;
  };
  occupancy: {
    open: number;
    occupied: number;
    total: number;
    percentOccupied: number;
  };
  studentsByGrade: Record<string, number>;
  studentsBySubject: Record<string, number>;
  teachers: {
    lessonsByTeacher: Record<string, number>;
    slotsByTeacher: Record<string, { open: number; occupied: number }>;
    studentsByTeacher: Record<string, number>;
    teacherNames: Record<string, string>;
  };
  charts: {
    weeklyVolume: { day: string; current: number; previous: number }[];
    revenueTrend: { month: string; amount: number; trend: 'up' | 'down' }[];
  };
  urgentTasks: {
    title: string;
    detail: string;
    type: 'warning' | 'payment' | 'system';
    count: number;
  }[];
}

export function useDashboardData() {
  // Stabilize 'today' to the start of the current minute to avoid infinite re-renders
  const today = useMemo(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    return now;
  }, []);

  const startOfToday = useMemo(() => new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString(), [today]);
  const endOfToday = useMemo(() => new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString(), [today]);
  
  const currentMonthStr = useMemo(() => today.toISOString().slice(0, 7), [today]); // YYYY-MM

  // Calculate week ranges
  const weekRanges = useMemo(() => {
    const getStartOfWeek = (date: Date) => {
      const d = new Date(date);
      const day = d.getDay(); // 0 (Sun) to 6 (Sat)
      d.setDate(d.getDate() - day);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const startOfCurrentWeek = getStartOfWeek(today);
    const endOfCurrentWeek = new Date(startOfCurrentWeek);
    endOfCurrentWeek.setDate(endOfCurrentWeek.getDate() + 6);
    endOfCurrentWeek.setHours(23, 59, 59, 999);

    const startOfPrevWeek = new Date(startOfCurrentWeek);
    startOfPrevWeek.setDate(startOfPrevWeek.getDate() - 7);
    const endOfPrevWeek = new Date(startOfPrevWeek);
    endOfPrevWeek.setDate(endOfPrevWeek.getDate() + 6);
    endOfPrevWeek.setHours(23, 59, 59, 999);

    return {
      current: { start: startOfCurrentWeek.toISOString(), end: endOfCurrentWeek.toISOString() },
      prev: { start: startOfPrevWeek.toISOString(), end: endOfPrevWeek.toISOString() }
    };
  }, [today]);

  // Fetch Lessons for Today
  const { data: lessonsTodayData, isLoading: lessonsLoading, refresh: refreshLessonsToday } = useLessons({
    start: startOfToday,
    end: endOfToday
  });

  // Fetch Lessons for Current Week
  const { data: currentWeekLessons, isLoading: currentWeekLoading, refresh: refreshCurrentWeek } = useLessons(weekRanges.current);

  // Fetch Lessons for Previous Week
  const { data: prevWeekLessons, isLoading: prevWeekLoading, refresh: refreshPrevWeek } = useLessons(weekRanges.prev);


  // Fetch Billing KPIs for current month
  const { kpis: billingKpis, isLoading: billingLoading, refresh: refreshBilling } = useBilling(currentMonthStr);

  // Fetch Students data (first page only for dashboard - faster)
  const { students, isLoading: studentsLoading, refreshStudents } = useStudents({
    filterActiveOnly: false,
    loadAllPages: false  // Only first 100 students for dashboard speed
  });

  // Fetch overdue bills (previous months, unpaid)
  const [overdueBills, setOverdueBills] = useState<MonthlyBill[]>([]);
  const [overdueLoading, setOverdueLoading] = useState(true);

  const loadOverdueBills = useCallback(async () => {
    setOverdueLoading(true);
    try {
      // Fetch last 3 months of billing data to find overdue (optimized)
      const months: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        months.push(d.toISOString().slice(0, 7));
      }
      
      // Fetch bills for each previous month sequentially to reduce load
      const unpaidBills: MonthlyBill[] = [];
      for (const month of months) {
        try {
          const bills = await getMonthlyBills(month, { statusFilter: 'all' });
          bills.forEach(bill => {
            // Overdue = month < currentMonth AND not paid
            if (month < currentMonthStr && !bill.paid) {
              unpaidBills.push(bill);
            }
          });
        } catch (monthErr) {
          console.warn(`[useDashboardData] Could not load bills for ${month}:`, monthErr);
        }
      }
      
      setOverdueBills(unpaidBills);
    } catch (err) {
      console.error('[useDashboardData] Error loading overdue bills:', err);
      setOverdueBills([]);
    } finally {
      setOverdueLoading(false);
    }
  }, [today, currentMonthStr]);

  useEffect(() => {
    loadOverdueBills();
  }, [loadOverdueBills]);

  // Fetch Revenue Trend (last 3 months)
  const [revenueTrendData, setRevenueTrendData] = useState<ChargesReportKPIs[]>([]);
  const [revenueLoading, setRevenueLoading] = useState(true);

  const loadRevenueTrend = useCallback(async () => {
    setRevenueLoading(true);
    try {
      const months = [];
      for (let i = 0; i < 3; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        months.push(d.toISOString().slice(0, 7));
      }
      const results = await Promise.all(months.map(m => getBillingKPIs(m)));
      setRevenueTrendData(results);
    } catch (err) {
      console.error('[useDashboardData] Error loading revenue trend:', err);
    } finally {
      setRevenueLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRevenueTrend();
  }, [loadRevenueTrend]);

  // Cancellations KPIs (current month)
  const [cancellationsKpis, setCancellationsKpis] = useState({
    totalCancellations: 0,
    lateCancellations: 0,
    latePercent: 0,
    revenueFromLate: 0,
  });
  const loadCancellationsKPIs = useCallback(async () => {
    try {
      const kpis = await nexusApi.getCancellationsKPIs(currentMonthStr);
      setCancellationsKpis(kpis);
    } catch (err) {
      console.warn('[useDashboardData] Cancellations KPIs failed:', err);
    }
  }, [currentMonthStr]);
  useEffect(() => {
    loadCancellationsKPIs();
  }, [loadCancellationsKPIs]);

  // Slot inventory for occupancy (next 14 days from today)
  const slotInventoryRange = useMemo(() => {
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setDate(end.getDate() + 14);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [today]);
  const [slotInventoryList, setSlotInventoryList] = useState<Array<{ id: string; status: string; teacherId?: string; teacherName?: string }>>([]);
  const loadSlotInventory = useCallback(async () => {
    try {
      const slots = await getSlotInventory(slotInventoryRange);
      setSlotInventoryList(slots.map(s => ({
        id: s.id,
        status: s.status || 'open',
        teacherId: s.teacherId,
        teacherName: s.teacherName,
      })));
    } catch (err) {
      console.warn('[useDashboardData] Slot inventory failed:', err);
      setSlotInventoryList([]);
    }
  }, [slotInventoryRange.start, slotInventoryRange.end]);
  useEffect(() => {
    loadSlotInventory();
  }, [loadSlotInventory]);

  const metrics: DashboardMetrics = useMemo(() => {
    // 1. Daily Metrics
    const completed = lessonsTodayData.filter(l => l.status === 'הסתיים').length;
    const cancelled = lessonsTodayData.filter(l => l.status === 'בוטל').length;
    
    // Missing attendance: past lessons still marked as scheduled
    const now = new Date();
    const missing = lessonsTodayData.filter(l => 
      l.status === 'מתוכנן' && new Date((l as any).start_datetime || l.date) < now
    ).length;

    // Reminders
    const remindersCount = lessonsTodayData.filter(l => (l as any).reminder_sent).length;
    const remindersPercent = lessonsTodayData.length > 0 ? Math.round((remindersCount / lessonsTodayData.length) * 100) : 100;

    // Last minute cancellations (this week) - count all cancelled lessons
    const lastMinuteCancellations = currentWeekLessons.filter(l => 
      l.status === 'בוטל'
    ).length;

    // Lesson stats (this week): scheduled, completed, cancelled
    const scheduled = currentWeekLessons.filter(l => l.status === 'מתוכנן' || l.status === 'ממתין' || (l as any).status === 'אישר הגעה').length;
    const completedThisWeek = currentWeekLessons.filter(l => l.status === 'הסתיים' || (l as any).status === 'בוצע').length;
    const cancelledLessons = currentWeekLessons.filter(l => l.status === 'בוטל').length;

    // Occupancy from slot inventory (open vs occupied/closed)
    const totalSlots = slotInventoryList.length;
    const openSlots = slotInventoryList.filter(s => s.status === 'open' || s.status === 'פתוח').length;
    const occupiedSlots = totalSlots - openSlots;
    const percentOccupied = totalSlots ? Math.round((occupiedSlots / totalSlots) * 1000) / 10 : 0;

    // 2. Student Metrics + distributions
    const totalActive = students.filter(s => s.status === 'active').length;
    const onHold = students.filter(s => s.status === 'on_hold').length;
    const inactive = students.filter(s => s.status === 'inactive').length;
    const withBalance = students.filter(s => s.balance > 0).length;
    const activeStudents = students.filter(s => s.status === 'active');
    const studentsByGrade: Record<string, number> = {};
    activeStudents.forEach(s => {
      const g = (s.grade ?? '').trim() || 'ללא כיתה';
      studentsByGrade[g] = (studentsByGrade[g] || 0) + 1;
    });
    const studentsBySubject: Record<string, number> = {};
    activeStudents.forEach(s => {
      const raw = s.subjectFocus;
      const subjects = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? raw.split(',').map(x => x.trim()) : []);
      if (subjects.length === 0) studentsBySubject['ללא מקצוע'] = (studentsBySubject['ללא מקצוע'] || 0) + 1;
      else subjects.forEach(sub => {
        const key = (sub || '').trim() || 'ללא מקצוע';
        studentsBySubject[key] = (studentsBySubject[key] || 0) + 1;
      });
    });

    // Teachers: from currentWeekLessons and slot inventory
    const lessonsByTeacher: Record<string, number> = {};
    const studentsByTeacher: Record<string, Set<string>> = {};
    const teacherNames: Record<string, string> = {};
    currentWeekLessons.forEach(l => {
      const tid = (l as any).teacherId || l.teacherId || '';
      const tname = (l as any).teacherName || l.teacherName || tid || 'ללא מורה';
      if (tid) {
        lessonsByTeacher[tid] = (lessonsByTeacher[tid] || 0) + 1;
        teacherNames[tid] = tname;
        if (!studentsByTeacher[tid]) studentsByTeacher[tid] = new Set();
        studentsByTeacher[tid].add((l as any).studentId || l.studentId || '');
      }
    });
    const slotsByTeacher: Record<string, { open: number; occupied: number }> = {};
    slotInventoryList.forEach(s => {
      const tid = s.teacherId || 'ללא מורה';
      if (!slotsByTeacher[tid]) slotsByTeacher[tid] = { open: 0, occupied: 0 };
      const isOpen = s.status === 'open' || s.status === 'פתוח';
      if (isOpen) slotsByTeacher[tid].open += 1;
      else slotsByTeacher[tid].occupied += 1;
      if (s.teacherName) teacherNames[tid] = s.teacherName;
    });
    const teachersPayload = {
      lessonsByTeacher: Object.fromEntries(Object.entries(lessonsByTeacher).map(([k, v]) => [k, v])),
      slotsByTeacher: Object.fromEntries(
        Object.entries(slotsByTeacher).map(([k, v]) => [k, v])
      ),
      studentsByTeacher: Object.fromEntries(
        Object.entries(studentsByTeacher).map(([k, set]) => [k, set.size])
      ),
      teacherNames,
    };

    // 3. Billing Metrics
    const openAmount = billingKpis?.pendingTotal || 0;
    const paidThisMonth = billingKpis?.paidTotal || 0;
    const pendingLinkCount = billingKpis?.pendingLinkCount || 0;
    const totalLessonsAmount = billingKpis?.totalLessonsAmount ?? 0;
    const totalSubscriptionsAmount = billingKpis?.totalSubscriptionsAmount ?? 0;
    
    // Overdue: bills from previous months that are not paid
    const overdueCount = overdueBills.length;
    const overdueTotal = overdueBills.reduce((sum, bill) => sum + (bill.totalAmount || 0), 0);

    // 4. Chart Data: Weekly Volume
    const days = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
    const weeklyVolume = days.map((dayLabel, i) => {
      const currentCount = currentWeekLessons.filter(l => {
        const d = new Date((l as any).lesson_date || l.date);
        return d.getDay() === i;
      }).length;
      
      const prevCount = prevWeekLessons.filter(l => {
        const d = new Date((l as any).lesson_date || l.date);
        return d.getDay() === i;
      }).length;

      return { day: dayLabel, current: currentCount, previous: prevCount };
    });

    // 5. Revenue Trend
    const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    const revenueTrend = revenueTrendData.map((kpi, i) => {
      const date = new Date(kpi.billingMonth + '-01');
      const prevKpi = revenueTrendData[i + 1];
      const trend = prevKpi && kpi.totalToBill < prevKpi.totalToBill ? 'down' : 'up';
      return {
        month: monthNames[date.getMonth()],
        amount: kpi.totalToBill,
        trend: trend as 'up' | 'down'
      };
    });

    // 6. Urgent Tasks - Dynamic based on real data
    const urgentTasks: DashboardMetrics['urgentTasks'] = [];

    // Missing attendance alerts
    if (missing > 0) {
      urgentTasks.push({
        title: `${missing} שיעורים ללא אישור נוכחות`,
        detail: 'שיעורי עבר שטרם אושרו',
        type: 'warning',
        count: missing
      });
    }

    // Overdue payments
    if (overdueCount > 0) {
      urgentTasks.push({
        title: `${overdueCount} חובות בפיגור`,
        detail: `סה"כ ₪${overdueTotal.toLocaleString()}`,
        type: 'payment',
        count: overdueCount
      });
    }

    // Bills pending link sending
    if (pendingLinkCount > 0) {
      urgentTasks.push({
        title: `${pendingLinkCount} חשבונות לא נשלחו`,
        detail: 'מאושרים וממתינים לשליחת קישור',
        type: 'payment',
        count: pendingLinkCount
      });
    }

    // Students on hold
    if (onHold > 0) {
      urgentTasks.push({
        title: `${onHold} תלמידים מושהים`,
        detail: 'דורשים טיפול',
        type: 'warning',
        count: onHold
      });
    }

    return {
      daily: {
        lessonsToday: lessonsTodayData.length,
        completedToday: completed,
        cancelledToday: cancelled,
        missingAttendance: missing,
        remindersSentPercent: remindersPercent,
        lastMinuteCancellations
      },
      students: {
        totalActive,
        onHold,
        inactive,
        withBalance
      },
      billing: {
        openAmount,
        paidThisMonth,
        overdueCount,
        overdueTotal,
        billsCount: billingKpis?.studentCount || 0,
        collectionRate: billingKpis?.collectionRate || 0,
        pendingLinkCount,
        totalLessonsAmount,
        totalSubscriptionsAmount,
      },
      cancellations: cancellationsKpis,
      lessonsStats: { scheduled, completed: completedThisWeek, cancelled: cancelledLessons },
      occupancy: { open: openSlots, occupied: occupiedSlots, total: totalSlots, percentOccupied },
      studentsByGrade,
      studentsBySubject,
      teachers: teachersPayload,
      charts: {
        weeklyVolume,
        revenueTrend
      },
      urgentTasks
    };
  }, [lessonsTodayData, currentWeekLessons, prevWeekLessons, students, billingKpis, overdueBills, revenueTrendData, cancellationsKpis, slotInventoryList]);

  const refresh = useCallback(async () => {
    // Invalidate caches
    invalidateLessons(); // Invalidate all lessons for now
    invalidateBilling(); // Invalidate all billing for now
    
    // Trigger refreshes
    await Promise.all([
      refreshLessonsToday(),
      refreshCurrentWeek(),
      refreshPrevWeek(),
      refreshBilling(),
      refreshStudents(),
      loadOverdueBills(),
      loadRevenueTrend(),
      loadCancellationsKPIs(),
      loadSlotInventory(),
    ]);
  }, [refreshLessonsToday, refreshCurrentWeek, refreshPrevWeek, refreshBilling, refreshStudents, loadOverdueBills, loadRevenueTrend, loadCancellationsKPIs, loadSlotInventory]);

  // Core loading: only essential data blocks the initial render
  // Students, overdue bills, and revenue trend load in background (non-blocking)
  const isCoreLoading = lessonsLoading || currentWeekLoading || prevWeekLoading || billingLoading;
  
  return {
    metrics,
    isLoading: isCoreLoading,
    refresh
  };
}
