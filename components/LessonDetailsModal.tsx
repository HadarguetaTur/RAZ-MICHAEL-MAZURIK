
import React from 'react';
import { LessonStatus } from '../types';
import { AIRTABLE_CONFIG } from '../config/airtable';

interface AirtableRecord {
  id: string;
  fields: {
    [key: string]: any;
    'פרטי השיעור'?: string;
    'full_name'?: string;
    'lesson_date'?: string;
    'start_datetime'?: string;
    'end_datetime'?: string;
    'status'?: string;
    'unit_price'?: number;
    'line_amount'?: number;
    'source'?: string;
    'cancellation_reason'?: string;
    'Student'?: Array<{ id: string; name?: string }>;
  };
}

interface LessonDetailsModalProps {
  record: AirtableRecord | null;
  onClose: () => void;
  onEdit?: () => void;
}

const LessonDetailsModal: React.FC<LessonDetailsModalProps> = ({ record, onClose, onEdit }) => {
  if (!record) return null;

  const fields = record.fields || {};

  // Format Hebrew date
  const formatHebrewDate = (dateString?: string): string => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('he-IL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  // Format time range
  const formatTimeRange = (start?: string, end?: string): string => {
    if (!start) return '';
    try {
      const startDate = new Date(start);
      const startTime = startDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      
      if (end) {
        const endDate = new Date(end);
        const endTime = endDate.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        return `${startTime} - ${endTime}`;
      }
      return startTime;
    } catch {
      return start;
    }
  };

  // Get status color
  const getStatusColor = (status?: string): string => {
    switch (status) {
      case 'בוצע':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'מתוכנן':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'אישר הגעה':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'בוטל':
        return 'bg-rose-100 text-rose-700 border-rose-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  // Get student name from linked record or direct field
  // Check if Student is a linked record array (Airtable returns linked records as arrays)
  const studentLink = fields['Student'];
  let studentName = 'לא צוין';
  
  if (Array.isArray(studentLink) && studentLink.length > 0) {
    // Linked record - get name from first linked record
    // Airtable linked records can have 'name' or we need to fetch it
    studentName = studentLink[0]?.name || studentLink[0]?.id || 'לא צוין';
  } else if (typeof studentLink === 'string') {
    studentName = studentLink;
  } else {
    // Try direct fields
    studentName = fields['full_name'] || 
                 fields['Student_Name'] || 
                 fields['student_name'] ||
                 'לא צוין';
  }

  // Get lesson details - try multiple possible field names
  const lessonDetails = fields[AIRTABLE_CONFIG.fields.lessonDetails] || 
                       fields['פרטי_השיעור'] ||
                       fields['lesson_details'] ||
                       '';
  const lessonDate = fields[AIRTABLE_CONFIG.fields.lessonDate] || '';
  const startDatetime = fields[AIRTABLE_CONFIG.fields.lessonStartDatetime] || '';
  const endDatetime = fields[AIRTABLE_CONFIG.fields.lessonEndDatetime] || '';
  const status = fields[AIRTABLE_CONFIG.fields.lessonStatus] || '';
  const unitPrice = fields[AIRTABLE_CONFIG.fields.unitPrice] !== undefined ? Number(fields[AIRTABLE_CONFIG.fields.unitPrice]) : undefined;
  const lineAmount = fields[AIRTABLE_CONFIG.fields.lineAmount] !== undefined ? Number(fields[AIRTABLE_CONFIG.fields.lineAmount]) : undefined;
  const source = fields[AIRTABLE_CONFIG.fields.source] || '';
  const cancellationReason = fields[AIRTABLE_CONFIG.fields.cancellationReason] || '';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div 
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" 
        onClick={onClose}
      ></div>
      <div className="relative w-full lg:w-[600px] bg-white lg:h-full h-[95vh] mt-auto lg:mt-0 lg:rounded-none rounded-t-[40px] shadow-2xl animate-in slide-in-from-bottom lg:slide-in-from-left duration-500 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 md:p-8 bg-slate-50 border-b border-slate-200 shrink-0">
          <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 lg:hidden"></div>
          <div className="flex items-center justify-between mb-6">
            <button 
              onClick={onClose} 
              className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
            <div className="flex gap-2">
              {onEdit && (
                <button 
                  onClick={onEdit}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black shadow-lg shadow-blue-100 active:scale-95 transition-all"
                >
                  עריכה
                </button>
              )}
            </div>
          </div>
          
          {/* Title */}
          {lessonDetails && (
            <h2 className="text-xl md:text-2xl font-black text-slate-900 mb-2 line-clamp-2">
              {lessonDetails}
            </h2>
          )}
          
          {/* Student Name */}
          <div className="text-sm font-bold text-slate-600">
            {studentName}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar bg-[#fcfdfe]">
          {/* Status Badge */}
          {status && (
            <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm">
              <div className="text-[10px] text-slate-400 font-black uppercase mb-2">סטטוס</div>
              <div className={`inline-flex items-center px-4 py-2 rounded-xl border font-bold text-sm ${getStatusColor(status)}`}>
                {status}
              </div>
            </div>
          )}

          {/* Date & Time */}
          {(lessonDate || startDatetime) && (
            <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm">
              <div className="text-[10px] text-slate-400 font-black uppercase mb-2">תאריך ושעה</div>
              {lessonDate && (
                <div className="text-base font-black text-slate-900 mb-1">
                  {formatHebrewDate(lessonDate)}
                </div>
              )}
              {startDatetime && (
                <div className="text-sm font-bold text-slate-600">
                  {formatTimeRange(startDatetime, endDatetime)}
                </div>
              )}
            </div>
          )}

          {/* Pricing */}
          {(unitPrice !== undefined || lineAmount !== undefined) && (
            <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm">
              <div className="text-[10px] text-slate-400 font-black uppercase mb-2">תמחור</div>
              <div className="space-y-2">
                {unitPrice !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-600">מחיר יחידה:</span>
                    <span className="text-base font-black text-slate-900">₪{unitPrice.toFixed(2)}</span>
                  </div>
                )}
                {lineAmount !== undefined && (
                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <span className="text-sm font-bold text-slate-600">סכום שורה:</span>
                    <span className="text-lg font-black text-slate-900">₪{lineAmount.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Source */}
          {source && (
            <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm">
              <div className="text-[10px] text-slate-400 font-black uppercase mb-2">מקור</div>
              <div className="text-sm font-bold text-slate-600">
                {source === 'bot' ? '🤖 נוצר אוטומטית' : source === 'manual' ? '✏️ נוצר ידנית' : source}
              </div>
            </div>
          )}

          {/* Cancellation Reason (only if exists) */}
          {cancellationReason && (
            <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl">
              <div className="text-[10px] text-rose-400 font-black uppercase mb-2">סיבת ביטול</div>
              <div className="text-sm font-bold text-rose-700">
                {cancellationReason}
              </div>
            </div>
          )}

          {/* Record ID (for debugging) */}
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
            <div className="text-[10px] text-slate-400 font-black uppercase mb-1">מזהה רשומה</div>
            <div className="text-xs font-mono text-slate-500">{record.id}</div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 md:p-8 border-t border-slate-100 bg-white flex gap-3 shrink-0">
          <button 
            onClick={onClose}
            className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-black shadow-lg active:scale-95 transition-all"
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
};

export default LessonDetailsModal;
