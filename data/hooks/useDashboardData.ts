/**
 * Unified hook for Dashboard data aggregation
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLessons } from './useLessons';
import { useBilling } from './useBilling';
import { getBillingKPIs, getMonthlyBills } from '../resources/billing';
import { invalidateLessons } from '../resources/lessons';
import { invalidateBilling } from '../resources/billing';
import { Lesson, MonthlyBill } from '../../types';
import { ChargesReportKPIs } from '../../services/billingService';
import { useStudents } from '../../hooks/useStudents';

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

  // Fetch Students data
  const { students, isLoading: studentsLoading, refreshStudents } = useStudents({
    filterActiveOnly: false,
    loadAllPages: true
  });

  // Fetch overdue bills (previous months, unpaid)
  const [overdueBills, setOverdueBills] = useState<MonthlyBill[]>([]);
  const [overdueLoading, setOverdueLoading] = useState(true);

  const loadOverdueBills = useCallback(async () => {
    setOverdueLoading(true);
    try {
      // Fetch last 6 months of billing data to find overdue
      const months: string[] = [];
      for (let i = 1; i <= 6; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        months.push(d.toISOString().slice(0, 7));
      }
      
      // Fetch bills for each previous month
      const allBillsArrays = await Promise.all(
        months.map(m => getMonthlyBills(m, { statusFilter: 'all' }))
      );
      
      // Flatten and filter: only unpaid bills from previous months
      const unpaidBills: MonthlyBill[] = [];
      allBillsArrays.forEach((bills, idx) => {
        const month = months[idx];
        bills.forEach(bill => {
          // Overdue = month < currentMonth AND not paid
          if (month < currentMonthStr && !bill.paid) {
            unpaidBills.push(bill);
          }
        });
      });
      
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

    // 2. Student Metrics
    const totalActive = students.filter(s => s.status === 'active').length;
    const onHold = students.filter(s => s.status === 'on_hold').length;
    const inactive = students.filter(s => s.status === 'inactive').length;
    const withBalance = students.filter(s => s.balance > 0).length;

    // 3. Billing Metrics
    const openAmount = billingKpis?.pendingTotal || 0;
    const paidThisMonth = billingKpis?.paidTotal || 0;
    const pendingLinkCount = billingKpis?.pendingLinkCount || 0;
    
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
        pendingLinkCount
      },
      charts: {
        weeklyVolume,
        revenueTrend
      },
      urgentTasks
    };
  }, [lessonsTodayData, currentWeekLessons, prevWeekLessons, students, billingKpis, overdueBills, revenueTrendData]);

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
      loadRevenueTrend()
    ]);
  }, [refreshLessonsToday, refreshCurrentWeek, refreshPrevWeek, refreshBilling, refreshStudents, loadOverdueBills, loadRevenueTrend]);

  return {
    metrics,
    isLoading: lessonsLoading || currentWeekLoading || prevWeekLoading || billingLoading || studentsLoading || overdueLoading || revenueLoading,
    refresh
  };
}
