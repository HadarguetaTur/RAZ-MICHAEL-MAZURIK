# מקור הנתונים של חלונות פתוחים

## זרימת הנתונים

### 1. טעינה ב-Calendar Component
**מיקום**: `components/Calendar.tsx` שורות 90-115

```typescript
// טוען חלונות פתוחים במקביל לשיעורים
const [lessonsData, openSlotsData, teachersData, studentsData] = await Promise.all([
  nexusApi.getLessons(startDate, endDateStr),
  nexusApi.getOpenSlots(startISO, endISO),  // ← כאן
  nexusApi.getTeachers(),
  nexusApi.getStudents()
]);
```

### 2. הפונקציה getOpenSlots
**מיקום**: `services/nexusApi.ts` שורות 2281-2430

**מה היא עושה:**
- שולפת רשומות מטבלת `slot_inventory` ב-Airtable
- מסננת לפי:
  - **סטטוס = "open"** (רק חלונות פתוחים)
  - **טווח זמן**: `StartDT < endISO AND EndDT > startISO` (חופף לטווח המבוקש)
  - **מורה** (אופציונלי): אם מועבר `teacherId`, מסנן רק חלונות של המורה הזה

### 3. שדות ב-Airtable
**טבלה**: `slot_inventory`

**שדות בשימוש:**
- `סטטוס` - סטטוס החלון (`'open'`, `'booked'`, `'blocked'`)
- `מורה` - קישור לטבלת `teachers`
- `StartDT` - שדה נוסחה שמחזיר ISO datetime (תאריך+שעה התחלה)
- `EndDT` - שדה נוסחה שמחזיר ISO datetime (תאריך+שעה סיום)
- `נוצר מתוך` - קישור לטבלת `weekly_slot` (מאיפה נוצר החלון)
- `lessons` - קישור לטבלת `lessons` (אם החלון קשור לשיעור)

### 4. המרה ל-CalendarItem
**מיקום**: `components/Calendar.tsx` שורות 154-182

```typescript
openSlots.forEach(slot => {
  // המרת ISO datetime ל-local time
  const startDate = new Date(slot.startDateTime);
  const endDate = new Date(slot.endDateTime);
  
  // חילוץ תאריך ושעה מקומיים
  const dateStr = `${year}-${month}-${day}`;
  const startTimeStr = `${hours}:${minutes}`;
  
  // הוספה ל-calendarItems
  items.push({
    kind: 'open_slot',
    date: dateStr,
    startTime: startTimeStr,
    // ...
  });
});
```

### 5. הצגה ב-Calendar
**מיקום**: `components/Calendar.tsx` שורות 766-836

- מסוננים לפי תאריך: `new Date(item.date).toDateString() === date.toDateString()`
- ממוקמים לפי שעה: `topOffset = (hour - 8) * 96 + (mins / 60) * 96`
- מוצגים עם `z-index: 1` (מאחורי שיעורים שיש להם `z-index: 5`)
- סגנון: רקע אפור בהיר, מסגרת מקווקו, תווית "חלון פתוח"

## סיכום

**מקור הנתונים**: טבלת `slot_inventory` ב-Airtable
**סינון**: רק רשומות עם `סטטוס = "open"` בטווח הזמן המבוקש
**עדכון**: נטען מחדש בכל פעם שהתאריכים משתנים (week/day navigation)

## בדיקה

אם חלונות פתוחים לא מוצגים, בדוק:
1. האם יש רשומות ב-`slot_inventory` עם `סטטוס = "open"`?
2. האם שדות `StartDT` ו-`EndDT` קיימים ומחזירים ערכים?
3. האם הרשומות בטווח התאריכים המבוקש?
4. בדוק בקונסול (DEV mode) את הלוגים של `[getOpenSlots]`
