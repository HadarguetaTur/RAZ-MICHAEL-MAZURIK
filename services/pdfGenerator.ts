/**
 * PDF Generator Service
 * Generates PDF documents using jsPDF with HTML (supports Hebrew/RTL)
 */

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

interface BillingBreakdown {
  lessons: Array<{
    id: string;
    date: string;
    startTime: string;
    type: string;
    status: string;
    amount: number;
  }>;
  subscriptions: Array<{
    id: string;
    type: string;
    monthlyAmount: number;
    startDate: string;
    endDate?: string;
    isActive: boolean;
  }>;
  cancellations: Array<{
    id: string;
    date: string;
    isLate: boolean;
    charge: number;
    hoursBefore: number;
  }>;
  manualAdjustment?: {
    amount: number;
    reason: string;
    date: string;
  };
  totals: {
    lessonsTotal: number;
    subscriptionsTotal: number;
    cancellationsTotal: number | null;
    manualAdjustmentTotal: number;
    grandTotal: number;
  };
}

/**
 * Format date for display
 */
const formatDate = (dateStr: string): string => {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('he-IL');
  } catch {
    return dateStr;
  }
};

/**
 * Format number with Hebrew locale
 */
const formatNumber = (num: number | null | undefined): string => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  try {
    return num.toLocaleString('he-IL');
  } catch {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
};

/**
 * Generate HTML content for PDF
 */
function generateHtmlContent(
  studentName: string,
  monthDisplay: string,
  totals: BillingBreakdown['totals'],
  safeBreakdown: BillingBreakdown
): string {
  const lessonsTableRows = safeBreakdown.lessons.map(lesson => `
    <tr>
      <td>${formatDate(lesson.date)}</td>
      <td>${lesson.type || ''}</td>
      <td>—</td>
      <td style="font-weight: bold;">₪${formatNumber(lesson.amount)}</td>
    </tr>
  `).join('');

  const subscriptionsHtml = safeBreakdown.subscriptions.map(subscription => {
    const statusText = subscription.isActive ? ' (פעיל)' : ' (מושהה/לא פעיל)';
    const endDateText = subscription.endDate ? ` עד ${formatDate(subscription.endDate)}` : '';
    return `
      <div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #eee;">
        <div style="font-size: 10px; margin-bottom: 3px;">
          מנוי ${subscription.type || ''} - ₪${formatNumber(subscription.monthlyAmount)}${statusText}
        </div>
        <div style="font-size: 9px; color: #666;">
          מתאריך: ${formatDate(subscription.startDate)}${endDateText}
        </div>
      </div>
    `;
  }).join('');

  const cancellationsHtml = safeBreakdown.cancellations.map(cancellation => {
    const lateText = cancellation.isLate ? '<24 שעות' : '≥24 שעות';
    const chargeText = (cancellation.charge || 0) > 0 ? ` - חויב: ₪${formatNumber(cancellation.charge)}` : '';
    return `
      <div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #eee;">
        <div style="font-size: 10px; margin-bottom: 3px;">
          ביטול ${lateText} - תאריך: ${formatDate(cancellation.date)}
        </div>
        <div style="font-size: 9px; color: #666;">
          ${cancellation.hoursBefore || 0} שעות לפני השיעור${chargeText}
        </div>
      </div>
    `;
  }).join('');

  const lateCount = safeBreakdown.cancellations.filter(c => c?.isLate).length;

  return `
    <div dir="rtl" lang="he" style="font-family: 'Arial', 'Helvetica', sans-serif; direction: rtl; padding: 40px; font-size: 10px; color: #000; background-color: #ffffff; width: 100%;">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        .header { margin-bottom: 30px; padding-bottom: 15px; border-bottom: 2px solid #000; }
        .title { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
        .subtitle { font-size: 14px; color: #666; margin-bottom: 5px; }
        .total { font-size: 20px; font-weight: bold; margin-top: 10px; }
        .section { margin-top: 25px; margin-bottom: 15px; }
        .section-title { font-size: 16px; font-weight: bold; margin-bottom: 10px; background-color: #f0f0f0; padding: 8px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 10px; border: 1px solid #ddd; }
        table th { background-color: #f5f5f5; font-weight: bold; font-size: 10px; padding: 10px 8px; text-align: right; border: 1px solid #ddd; border-bottom: 2px solid #000; }
        table td { font-size: 10px; padding: 8px; text-align: right; border: 1px solid #ddd; }
        table tbody tr:nth-child(even) { background-color: #fafafa; }
        table tbody tr:last-child td { background-color: #f0f0f0; font-weight: bold; border-top: 2px solid #000; }
        .total-row { background-color: #f0f0f0; padding: 8px; margin-top: 5px; font-weight: bold; }
        .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 9px; color: #666; }
      </style>
      <div class="header">
        <div class="title">פירוט חיוב - ${studentName || 'לא צוין'}</div>
        <div class="subtitle">חודש: ${monthDisplay}</div>
        <div class="total">סה"כ לתשלום: ₪${formatNumber(totals.grandTotal)}</div>
      </div>
      ${safeBreakdown.lessons.length > 0 ? `
        <div class="section">
          <div class="section-title">שיעורים (${safeBreakdown.lessons.length})</div>
          <table>
            <thead><tr><th>תאריך</th><th>סוג שיעור</th><th>מחיר יחידה</th><th>סכום לחיוב</th></tr></thead>
            <tbody>${lessonsTableRows}
              <tr><td>סה"כ שיעורים:</td><td></td><td></td><td style="font-weight: bold;">₪${formatNumber(safeBreakdown.totals.lessonsTotal)}</td></tr>
            </tbody>
          </table>
        </div>
      ` : ''}
      ${safeBreakdown.subscriptions.length > 0 ? `
        <div class="section">
          <div class="section-title">מנויים (${safeBreakdown.subscriptions.filter(s => s?.isActive).length} פעיל)</div>
          ${subscriptionsHtml}
          ${safeBreakdown.totals.subscriptionsTotal > 0 ? `<div class="total-row">סה"כ מנויים: ₪${formatNumber(safeBreakdown.totals.subscriptionsTotal)}</div>` : ''}
        </div>
      ` : ''}
      ${safeBreakdown.cancellations.length > 0 ? `
        <div class="section">
          <div class="section-title">ביטולים בתשלום (${safeBreakdown.cancellations.length})</div>
          ${cancellationsHtml}
          <div class="total-row">סה"כ ביטולים בתשלום: ${safeBreakdown.cancellations.length}</div>
          ${lateCount > 0 ? `<div class="total-row">מתוכם <24 שעות: ${lateCount}</div>` : ''}
          ${safeBreakdown.totals.cancellationsTotal !== null && safeBreakdown.totals.cancellationsTotal > 0 ? `<div class="total-row">סה"כ תשלום ביטולים: ₪${formatNumber(safeBreakdown.totals.cancellationsTotal)}</div>` : ''}
        </div>
      ` : ''}
      ${safeBreakdown.manualAdjustment ? `
        <div class="section">
          <div class="section-title">התאמה ידנית</div>
          <div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #eee;">
            <div style="font-size: 10px;">${safeBreakdown.manualAdjustment.reason || 'התאמה ידנית'}</div>
            <div style="font-size: 9px; color: #666;">תאריך: ${formatDate(safeBreakdown.manualAdjustment.date)}</div>
            <div style="font-size: 10px; font-weight: bold; margin-top: 5px; ${safeBreakdown.manualAdjustment.amount >= 0 ? 'color: #2563eb;' : 'color: #059669;'}">
              סכום: ${safeBreakdown.manualAdjustment.amount >= 0 ? '+' : ''}₪${formatNumber(safeBreakdown.manualAdjustment.amount)}
            </div>
          </div>
        </div>
      ` : ''}
      <div class="section">
        <div class="section-title">סיכום</div>
        <div class="total-row">שיעורים: ₪${formatNumber(totals.lessonsTotal)}</div>
        ${totals.subscriptionsTotal > 0 ? `<div class="total-row">מנויים: ₪${formatNumber(totals.subscriptionsTotal)}</div>` : ''}
        ${totals.cancellationsTotal !== null && totals.cancellationsTotal > 0 ? `<div class="total-row">ביטולים: ₪${formatNumber(totals.cancellationsTotal)}</div>` : ''}
        ${totals.manualAdjustmentTotal !== 0 ? `<div class="total-row" style="${totals.manualAdjustmentTotal >= 0 ? 'color: #2563eb;' : 'color: #059669;'}">התאמה ידנית: ${totals.manualAdjustmentTotal >= 0 ? '+' : ''}₪${formatNumber(totals.manualAdjustmentTotal)}</div>` : ''}
        <div class="total-row" style="background-color: #e5e7eb; border-top: 2px solid #000; margin-top: 10px; padding: 12px; font-size: 14px;">
          סה"כ לתשלום: ₪${formatNumber(totals.grandTotal)}
        </div>
      </div>
      <div class="footer">תאריך הפקה: ${new Date().toLocaleDateString('he-IL')}</div>
    </div>
  `;
}

/**
 * Generate billing breakdown PDF
 */
export async function generateBillingPdf(
  studentName: string,
  monthKey: string,
  total: number,
  breakdown: BillingBreakdown
): Promise<Blob> {
  const [year, month] = (monthKey || '2024-01').split('-');
  const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const monthIndex = parseInt(month) - 1;
  const monthDisplay = monthIndex >= 0 && monthIndex < 12 ? `${monthNames[monthIndex]} ${year}` : monthKey;

  const lessonsTotal = typeof breakdown?.totals?.lessonsTotal === 'number' ? breakdown.totals.lessonsTotal : 0;
  const subscriptionsTotal = typeof breakdown?.totals?.subscriptionsTotal === 'number' ? breakdown.totals.subscriptionsTotal : 0;
  const cancellationsTotal = breakdown?.totals?.cancellationsTotal !== undefined ? breakdown.totals.cancellationsTotal : null;
  const manualAdjustmentTotal = typeof breakdown?.totals?.manualAdjustmentTotal === 'number' ? breakdown.totals.manualAdjustmentTotal : 0;
  const calculatedGrandTotal = lessonsTotal + subscriptionsTotal + (cancellationsTotal || 0) + manualAdjustmentTotal;

  const totals: BillingBreakdown['totals'] = {
    lessonsTotal,
    subscriptionsTotal,
    cancellationsTotal,
    manualAdjustmentTotal,
    grandTotal: calculatedGrandTotal,
  };

  const safeBreakdown: BillingBreakdown = {
    lessons: Array.isArray(breakdown?.lessons) ? breakdown.lessons.filter((l: any) => l && typeof l === 'object') : [],
    subscriptions: Array.isArray(breakdown?.subscriptions) ? breakdown.subscriptions.filter((s: any) => s && typeof s === 'object') : [],
    cancellations: Array.isArray(breakdown?.cancellations) ? breakdown.cancellations.filter((c: any) => c && typeof c === 'object') : [],
    manualAdjustment: breakdown?.manualAdjustment ? {
      amount: typeof breakdown.manualAdjustment.amount === 'number' ? breakdown.manualAdjustment.amount : 0,
      reason: breakdown.manualAdjustment.reason || '',
      date: breakdown.manualAdjustment.date || '',
    } : undefined,
    totals: {
      lessonsTotal,
      subscriptionsTotal,
      cancellationsTotal,
      manualAdjustmentTotal,
      grandTotal: calculatedGrandTotal,
    },
  };

  const htmlContent = generateHtmlContent(studentName, monthDisplay, totals, safeBreakdown);
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:0;top:0;width:794px;height:auto;padding:0;margin:0;background:#fff;visibility:visible;opacity:1;z-index:9999;overflow:visible;';
  container.innerHTML = htmlContent;
  document.body.appendChild(container);

  await new Promise(r => setTimeout(r, 500));

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      letterRendering: true,
      backgroundColor: '#ffffff',
      width: 794,
      windowWidth: 794,
      logging: false,
      allowTaint: false,
    });

    if (container.parentNode) document.body.removeChild(container);

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Failed to create canvas from HTML');
    }

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let yPosition = 0;
    while (heightLeft > 0) {
      if (yPosition > 0) doc.addPage();
      const pageHeightToUse = Math.min(pageHeight, heightLeft);
      const sourceY = (yPosition * canvas.height) / imgHeight;
      const sourceHeight = (pageHeightToUse * canvas.height) / imgHeight;
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = canvas.width;
      pageCanvas.height = sourceHeight;
      const ctx = pageCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(canvas, 0, sourceY, canvas.width, sourceHeight, 0, 0, canvas.width, sourceHeight);
        doc.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 0, 0, imgWidth, pageHeightToUse);
      }
      heightLeft -= pageHeight;
      yPosition += pageHeight;
    }

    return doc.output('blob');
  } catch (err) {
    if (container.parentNode) document.body.removeChild(container);
    throw err;
  }
}
