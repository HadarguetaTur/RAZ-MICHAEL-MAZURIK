/**
 * PDF export for billing breakdown.
 * Uses @react-pdf/renderer: Document/Page/View/Text and pdf(...).toBlob() for download.
 */

import React from 'react';
import { pdf, Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { BillingBreakdown } from '../services/billingDetailsService';

const styles = StyleSheet.create({
  page: { padding: 30, fontSize: 10 },
  title: { fontSize: 16, marginBottom: 4 },
  subtitle: { fontSize: 11, marginBottom: 16 },
  totalRow: { fontSize: 12, marginBottom: 20 },
  sectionTitle: { fontSize: 11, marginTop: 12, marginBottom: 6 },
  row: { flexDirection: 'row', marginBottom: 4 },
  cell: { flex: 1 },
  cellRight: { flex: 1, textAlign: 'right' },
  footer: { marginTop: 24, fontSize: 9 },
});

export interface BillingBreakdownPdfProps {
  studentName: string;
  monthKey: string;
  total: number;
  breakdown: BillingBreakdown;
}

export function BillingBreakdownPdfDocument({ studentName, monthKey, total, breakdown }: BillingBreakdownPdfProps) {
  const produced = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{studentName} – פירוט חיוב</Text>
        <Text style={styles.subtitle}>חודש {monthKey}</Text>
        <Text style={styles.totalRow}>סה"כ לתשלום: ₪{total.toLocaleString()}</Text>

        <Text style={styles.sectionTitle}>שיעורים</Text>
        {breakdown.lessons.map((l, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.cell}>{l.date} | {l.type} | ₪{l.unitPrice.toLocaleString()}</Text>
            <Text style={styles.cellRight}>₪{l.lineAmount.toLocaleString()}</Text>
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.cell}>סה"כ שיעורים</Text>
          <Text style={styles.cellRight}>₪{breakdown.totals.lessonsTotal.toLocaleString()}</Text>
        </View>

        <Text style={styles.sectionTitle}>מנויים</Text>
        {breakdown.subscriptions.map((s, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.cell}>{s.type} | {s.startDate}{s.endDate ? ` – ${s.endDate}` : ''} | {s.paused ? 'מושהה' : 'פעיל'}</Text>
            <Text style={styles.cellRight}>₪{s.amount.toLocaleString()}</Text>
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.cell}>סה"כ מנויים</Text>
          <Text style={styles.cellRight}>₪{breakdown.totals.subscriptionsTotal.toLocaleString()}</Text>
        </View>

        <Text style={styles.sectionTitle}>ביטולים בתשלום</Text>
        {breakdown.paidCancellations.map((c, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.cell}>{c.date} | {c.hoursBefore != null ? `${c.hoursBefore} שעות לפני` : '—'} | {c.isLt24h ? '<24h' : '≥24h'}</Text>
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.cell}>סה"כ ביטולים בתשלום: {breakdown.paidCancellations.length}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.cell}>מתוכם &lt;24h: {breakdown.paidCancellations.filter(c => c.isLt24h).length}</Text>
        </View>

        <Text style={styles.footer}>תאריך הפקה: {produced}</Text>
      </Page>
    </Document>
  );
}

export async function downloadBillingBreakdownPdf(
  studentName: string,
  monthKey: string,
  total: number,
  breakdown: BillingBreakdown
): Promise<void> {
  const doc = <BillingBreakdownPdfDocument studentName={studentName} monthKey={monthKey} total={total} breakdown={breakdown} />;
  const blob = await pdf(doc).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `billing-${studentName.replace(/\s+/g, '-')}-${monthKey}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
