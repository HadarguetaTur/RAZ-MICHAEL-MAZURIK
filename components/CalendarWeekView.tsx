import React, { useMemo } from 'react';

const HOURS = Array.from({ length: 14 }, (_, i) => i + 8); // 08:00 to 21:00
const DAYS_HEBREW = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export type CalendarEvent = {
  id: string;
  date: string;      // 'YYYY-MM-DD'
  startTime: string; // 'HH:MM'
  endTime: string;   // 'HH:MM'
  title?: string;
  subtitle?: string;
  teacherName?: string;
  type?: string;
  status?: string;
  color?: string;
  borderColor?: string;
  notes?: string;
};

type CalendarWeekViewProps = {
  events: CalendarEvent[];
  currentDate: Date;
  onCurrentDateChange: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
  onSlotClick?: (date: Date, hour: number) => void;
  onCreateNew?: () => void;
  createButtonLabel?: string;
  searchTerm?: string;
  onSearchChange?: (term: string) => void;
  searchPlaceholder?: string;
  showViewSelector?: boolean;
  viewMode?: 'week' | 'day';
  onViewModeChange?: (mode: 'week' | 'day') => void;
};

const CalendarWeekView: React.FC<CalendarWeekViewProps> = ({
  events,
  currentDate,
  onCurrentDateChange,
  onEventClick,
  onSlotClick,
  onCreateNew,
  createButtonLabel = 'שיעור חדש',
  searchTerm = '',
  onSearchChange,
  searchPlaceholder = 'חפש תלמיד...',
  showViewSelector = false,
  viewMode = 'week',
  onViewModeChange,
}) => {
  const weekDates = useMemo(() => {
    const dates = [];
    const firstDay = new Date(currentDate);
    firstDay.setDate(currentDate.getDate() - currentDate.getDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(firstDay);
      d.setDate(firstDay.getDate() + i);
      dates.push(d);
    }
    return dates;
  }, [currentDate]);

  const currentMonthDisplay = useMemo(() => {
    return currentDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  }, [currentDate]);

  const navigate = (direction: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(currentDate.getDate() + direction * (viewMode === 'day' ? 1 : 7));
    onCurrentDateChange(newDate);
  };

  const handleSlotClick = (date: Date, hour: number) => {
    if (onSlotClick) {
      onSlotClick(date, hour);
    }
  };

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      const eventDate = new Date(event.date);
      const weekStart = weekDates[0];
      const weekEnd = weekDates[6];
      return eventDate >= weekStart && eventDate <= weekEnd;
    });
  }, [events, weekDates]);

  return (
    <div className="flex flex-col h-full gap-6 animate-in fade-in duration-500 w-full overflow-visible">
      {/* Top Navigation Bar */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm flex flex-col lg:flex-row items-center justify-between gap-6 w-full">
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full lg:w-auto">
          {onCreateNew && (
            <button 
              onClick={onCreateNew}
              className="bg-blue-600 text-white px-8 py-3 rounded-2xl font-bold text-sm shadow-md hover:bg-blue-700 transition-all w-full sm:w-auto text-center"
            >
              {createButtonLabel}
            </button>
          )}
          <div className="flex items-center bg-slate-50 p-1.5 rounded-2xl border border-slate-100 w-full sm:w-auto">
            <button onClick={() => navigate(-1)} className="px-3 py-2 hover:bg-white rounded-xl transition-all text-slate-400">←</button>
            <button onClick={() => onCurrentDateChange(new Date())} className="px-6 py-2 text-slate-700 font-bold text-sm rounded-xl">היום</button>
            <button onClick={() => navigate(1)} className="px-3 py-2 hover:bg-white rounded-xl transition-all text-slate-400">→</button>
          </div>
          <div className="hidden lg:block h-8 w-px bg-slate-100 mx-2"></div>
          <div className="text-lg font-black text-slate-800 shrink-0">
            {currentMonthDisplay}
          </div>
        </div>

        {(onSearchChange || showViewSelector) && (
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:flex-1 lg:max-w-xl">
            {onSearchChange && (
              <div className="relative w-full">
                <input 
                  type="text" 
                  placeholder={searchPlaceholder}
                  className="w-full pr-12 pl-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:bg-white outline-none transition-all"
                  value={searchTerm}
                  onChange={(e) => onSearchChange(e.target.value)}
                />
                <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
            )}
            {showViewSelector && onViewModeChange && (
              <select 
                className="w-full sm:w-40 px-4 py-3 rounded-2xl border border-slate-100 bg-slate-50 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-100 transition-all"
                value={viewMode}
                onChange={(e) => onViewModeChange(e.target.value as 'week' | 'day')}
              >
                <option value="day">יום</option>
                <option value="week">שבוע</option>
              </select>
            )}
          </div>
        )}
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 bg-white rounded-[32px] border border-slate-200 shadow-sm flex flex-col w-full overflow-hidden">
        <div className="flex-1 flex flex-col w-full overflow-x-auto overflow-y-hidden custom-scrollbar">
          {/* Date Headers */}
          <div className={`flex border-b border-slate-100 bg-slate-50/30 sticky top-0 z-20 shrink-0 ${viewMode === 'week' ? 'min-w-[800px] md:min-w-0' : 'min-w-full'}`}>
            <div className="w-16 md:w-20 border-l border-slate-100 shrink-0"></div>
            {(viewMode === 'day' ? [currentDate] : weekDates).map((date, idx) => (
              <div key={idx} className={`flex-1 py-4 text-center border-l border-slate-100 last:border-l-0 ${date.toDateString() === new Date().toDateString() ? 'bg-blue-50/30' : ''}`}>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{DAYS_HEBREW[date.getDay()]}</div>
                <div className={`text-lg font-extrabold ${date.toDateString() === new Date().toDateString() ? 'text-blue-600' : 'text-slate-900'}`}>
                  {date.getDate()}
                </div>
              </div>
            ))}
          </div>

          {/* Time Grid */}
          <div className="flex-1 overflow-y-auto relative custom-scrollbar">
            <div className={`flex ${viewMode === 'week' ? 'min-w-[800px] md:min-w-0' : 'min-w-full'}`}>
              {/* Time Column */}
              <div className="w-16 md:w-20 bg-slate-50/10 sticky right-0 z-10 border-l border-slate-100 shrink-0">
                {HOURS.map(hour => (
                  <div key={hour} className="h-24 text-[10px] text-slate-400 font-bold text-center pt-3 border-b border-slate-100/50">
                    {hour}:00
                  </div>
                ))}
              </div>

              {/* Day Columns */}
              {(viewMode === 'day' ? [currentDate] : weekDates).map((date, dayIdx) => (
                <div key={dayIdx} className="flex-1 border-l border-slate-100 last:border-l-0 relative min-h-[1344px]">
                  {/* Time Slots */}
                  {HOURS.map(hour => (
                    <div 
                      key={hour} 
                      className="h-24 border-b border-slate-100/30 cursor-crosshair hover:bg-slate-50/50 transition-colors"
                      onClick={() => handleSlotClick(date, hour)}
                    ></div>
                  ))}

                  {/* Events */}
                  {filteredEvents
                    .filter(event => {
                      const eventDate = new Date(event.date);
                      return eventDate.toDateString() === date.toDateString();
                    })
                    .map(event => {
                      const hour = parseInt(event.startTime.split(':')[0]);
                      const mins = parseInt(event.startTime.split(':')[1] || '0');
                      const startHour = hour + mins / 60;
                      const endHour = parseInt(event.endTime.split(':')[0]) + (parseInt(event.endTime.split(':')[1] || '0') / 60);
                      const duration = endHour - startHour;
                      const topOffset = (startHour - 8) * 96;
                      const height = duration * 96;

                      // Determine border color based on type or status
                      const borderColor = event.borderColor || 
                        (event.type === 'recurring' || event.status === 'recurring' ? 'border-indigo-600' :
                         event.type === 'group' || event.status === 'group' ? 'border-amber-600' :
                         'border-blue-600');

                      return (
                        <button
                          key={event.id}
                          onClick={() => onEventClick?.(event)}
                          style={{ top: `${topOffset}px`, height: `${height}px` }}
                          className={`absolute left-1.5 right-1.5 rounded-2xl p-4 text-right border-r-4 shadow-sm border border-slate-200 flex flex-col justify-between overflow-hidden bg-white hover:z-10 transition-all ${borderColor}`}
                          title={event.notes ? `${event.title || ''} - ${event.notes}` : event.title || ''}
                        >
                          <div className="font-bold text-sm leading-tight text-slate-900 line-clamp-1">
                            {event.title || event.teacherName || 'שיעור'}
                          </div>
                          {event.subtitle && (
                            <div className="text-xs text-slate-600 mt-1 line-clamp-2 truncate" title={event.subtitle}>
                              {event.subtitle}
                            </div>
                          )}
                          {event.notes && (
                            <div 
                              className="text-xs text-slate-600 mt-1 line-clamp-2 truncate"
                              title={event.notes}
                            >
                              {event.notes}
                            </div>
                          )}
                          <div className="hidden sm:flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
                            <div className="text-[10px] font-bold text-slate-400">{event.startTime}</div>
                            {event.type && (
                              <div className="text-[10px] font-bold bg-slate-50 text-slate-500 px-2 py-0.5 rounded-full">
                                {event.type === 'private' ? 'פרטי' : 
                                 event.type === 'pair' ? 'זוגי' : 
                                 event.type === 'group' ? 'קבוצתי' : 
                                 event.type === 'recurring' ? 'מחזורי' : event.type}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalendarWeekView;
