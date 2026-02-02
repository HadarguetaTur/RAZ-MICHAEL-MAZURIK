# מיפוי זרימת שריון slot_inventory וקביעת שיעורים

## סקירה כללית

מסמך זה ממפה את כל הזרימות הקשורות ל:
1. **שריון slot_inventory** - משלושה מקורות שונים
2. **קביעת שיעורים** - יצירת שיעור חדש
3. **התלות בין השניים** - איך הם משפיעים זה על זה

---

## 1. שריון slot_inventory - שלושה מקורות

### 1.1 שריון מיומן שיעורים (Calendar)

**מיקום קוד:** `components/Calendar.tsx`

**זרימה:**
1. משתמש לוחץ על חלון פתוח בלוח השנה
2. נפתח `SlotInventoryModal` (שורה 1617-1636)
3. המשתמש בוחר תלמידים ולוחץ "שריין חלון"
4. `handleReserveSlot` נקרא ב-`SlotInventoryModal.tsx` (שורה 32)
5. **חשוב:** `requireStudentForReserve` הוא `false` (לא מועבר) - לכן:
   - אם אין תלמידים נבחרים, רק מעדכן סטטוס ל-'closed'
   - לא יוצר שיעורים!
6. אחרי הצלחה:
   - `onSuccess` נקרא (שורה 1627)
   - מעדכן אופטימיסטית: `setOpenSlots(prev => prev.filter(s => s.id !== clickedSlot.id))`
   - קורא `refreshData()` (שורה 1633)

**בעיה זוהתה:**
- `SlotInventoryModal` ב-Calendar **לא** מעביר `requireStudentForReserve={true}` בשני מקומות:
  1. דרך `slotModal` hook (שורה 1593-1614) - הדרך החדשה
  2. דרך `clickedSlot` state (שורה 1617-1636) - הדרך הישנה (legacy)
- לכן לא ניתן לשריין לתלמיד ספציפי מיומן שיעורים!

**קוד רלוונטי:**
```typescript
// Calendar.tsx:1593-1614 - דרך slotModal hook
{slotModal.isOpen && slotModal.slotData && (
  <SlotInventoryModal
    slot={{...}}
    onClose={slotModal.close}
    onSuccess={() => {
      if (slotModal.activeSlotId) {
        setOpenSlots(prev => prev.filter(s => s.id !== slotModal.activeSlotId));
      }
      refreshData();
      slotModal.handleSuccess();
    }}
    // ❌ חסר: requireStudentForReserve={true}
  />
)}

// Calendar.tsx:1617-1636 - דרך clickedSlot (legacy)
{clickedSlot && !slotModal.isOpen && (
  <SlotInventoryModal
    slot={{...}}
    onClose={() => setClickedSlot(null)}
    onSuccess={() => {
      setOpenSlots(prev => prev.filter(s => s.id !== clickedSlot.id));
      setClickedSlot(null);
      refreshData();
    }}
    // ❌ חסר: requireStudentForReserve={true}
  />
)}
```

---

### 1.2 שריון מחריגים וחד-פעמי (Availability)

**מיקום קוד:** `components/Availability.tsx`

**זרימה:**
1. משתמש לוחץ על חלון פתוח במסך הזמינות
2. נפתח `SlotInventoryModal` דרך `slotModal` hook (שורה 1602-1626)
3. **חשוב:** `requireStudentForReserve={true}` מועבר (שורה 1624)
4. המשתמש **חייב** לבחור תלמידים
5. `handleReserveSlot` נקרא ב-`SlotInventoryModal.tsx` (שורה 32)
6. כי `requireStudentForReserve === true`:
   - בודק שיש תלמידים נבחרים (שורה 37-41)
   - קורא `reserveSlotAndCreateLessons(slot.id, selectedStudentIds)` (שורה 49)
7. אחרי הצלחה:
   - `onSuccess` נקרא (שורה 1612)
   - מעדכן אופטימיסטית: `setSlotInventory(prev => prev.filter(...))`
   - קורא `loadInventory(true)` עם forceRefresh (שורה 1620)

**זה עובד נכון!** ✅

**קוד רלוונטי:**
```typescript
// Availability.tsx:1602-1626
{slotModal.isOpen && slotModal.slotData && (
  <SlotInventoryModal
    slot={{...}}
    onClose={slotModal.close}
    onSuccess={async () => {
      if (slotModal.activeSlotId) {
        setSlotInventory(prev => prev.filter(s => s.id !== slotModal.activeSlotId));
      }
      await loadInventory(true);
      slotModal.handleSuccess();
    }}
    requireStudentForReserve={true} // ✅ קיים!
  />
)}
```

---

### 1.3 שריון מ-SlotInventoryModal ישירות

**מיקום קוד:** `components/SlotInventoryModal.tsx`

**לוגיקה:**
- אם `requireStudentForReserve === true`:
  - **חייב** תלמידים נבחרים
  - קורא `reserveSlotAndCreateLessons` → יוצר שיעורים
- אם `requireStudentForReserve === false` (או לא מועבר):
  - רק מעדכן סטטוס ל-'closed'
  - **לא** יוצר שיעורים

**קוד רלוונטי:**
```typescript
// SlotInventoryModal.tsx:32-85
const handleReserveSlot = async () => {
  if (requireStudentForReserve) {
    if (!selectedStudentIds || selectedStudentIds.length === 0) {
      setToast({ message: 'יש לבחור לפחות תלמיד אחד', type: 'error' });
      return;
    }
    // ✅ יוצר שיעורים
    await reserveSlotAndCreateLessons(slot.id, selectedStudentIds);
  } else {
    // ❌ רק מעדכן סטטוס, לא יוצר שיעורים
    await nexusApi.updateSlotInventory(slot.id, { status: 'closed' as any });
  }
};
```

---

## 2. קביעת שיעורים - יצירת שיעור חדש

### 2.1 יצירת שיעור מיומן שיעורים

**מיקום קוד:** `components/Calendar.tsx`

**זרימה:**
1. משתמש לוחץ "שיעור חדש" (שורה 993-1000)
2. `setIsCreating(true)` - פותח מודל יצירה
3. משתמש ממלא פרטים ושומר
4. `performSave` נקרא (שורה 605)
5. אם `isCreating === true`:
   - קורא `nexusApi.createLesson({...})` (שורה 630)
   - אחרי הצלחה: קורא `refreshData()` (שורה 648)

**קוד רלוונטי:**
```typescript
// Calendar.tsx:625-649
if (isCreating) {
  // Create new lesson
  const newLesson = await nexusApi.createLesson({
    studentId: studentId,
    date: editState.date!,
    startTime: editState.startTime!,
    duration: editState.duration || 60,
    status: LessonStatus.SCHEDULED,
    // ... שאר השדות
  });
  
  // Refresh both lessons and slots
  await refreshData();
}
```

### 2.2 refreshData - איך הנתונים מתעדכנים

**מיקום קוד:** `components/Calendar.tsx:490-558`

**זרימה:**
1. קורא `getLessons()` ו-`getSlotInventory()` במקביל (שורה 500-503)
2. מעדכן state: `setLessons(lessonsData)` (שורה 508)
3. **מסנן חלונות פתוחים:**
   - קורא `shouldRenderOpenSlot(slot, lessonsData)` (שורה 513)
   - הפונקציה בודקת:
     - סטטוס === 'open'
     - אין שיעורים מקושרים (`slot.lessons.length === 0`)
     - אין שיעור תואם (תאריך, שעה, מורה)
4. מעדכן state: `setOpenSlots(filteredOpenSlots)` (שורה 531)

**בעיה אפשרית:**
- אם `refreshData()` נקרא לפני שהקאש מתעדכן, השיעור החדש לא יופיע
- אם `shouldRenderOpenSlot` לא מזהה נכון שיעור תואם, חלון פתוח יישאר

**קוד רלוונטי:**
```typescript
// Calendar.tsx:490-558
const refreshData = async () => {
  const [lessonsData, inventoryData] = await Promise.all([
    getLessons({ start: `${startDate}T00:00:00.000Z`, end: `${endDateStr}T23:59:59.999Z` }),
    getSlotInventory({ start: `${startDate}T00:00:00.000Z`, end: `${endDateStr}T23:59:59.999Z` }),
  ]);
  
  setLessons(lessonsData);
  
  // Filter: only show truly open slots
  const filteredOpenSlots = inventoryData.filter(slot => {
    return shouldRenderOpenSlot(slot, lessonsData);
  });
  
  setOpenSlots(filteredOpenSlots);
};
```

---

## 3. reserveSlotAndCreateLessons - השרות המרכזי

**מיקום קוד:** `services/slotBookingService.ts:77-402`

**זרימה:**
1. טוען רשומת `slot_inventory` מ-Airtable (שורה 102-105)
2. מחלץ שדות: תאריך, שעת התחלה, שעת סיום, מורה (שורה 110-123)
3. מחשב משך בדקות (שורה 168-194)
4. **יוצר שיעורים** לכל תלמיד:
   - קורא `nexusApi.createLesson()` עם `source: 'slot_inventory'` (שורה 213-222)
5. **מעדכן slot_inventory:**
   - סטטוס = 'סגור' (שורה 236)
   - מקשר שיעורים (שורה 254-264)
   - מקשר תלמידים (שורה 267-277)
6. **מבטל קאש:**
   - `invalidateLessons()` (שורה 362)
   - `invalidateSlotInventory()` (שורה 376-386)

**קוד רלוונטי:**
```typescript
// slotBookingService.ts:213-227
for (const studentRecordId of studentIds) {
  const lesson = await nexusApi.createLesson({
    studentId: studentRecordId,
    date,
    startTime,
    duration: durationMin,
    teacherId: finalTeacherRecordId,
    status: LessonStatus.SCHEDULED,
    source: 'slot_inventory', // ✅ מסומן כבא מ-slot_inventory
    lessonType: lessonType,
  });
  createdLessons.push(lesson);
}

// Update slot_inventory
const updateFields = {
  'סטטוס': 'סגור',
  // ... link lessons and students
};
await airtableClient.updateRecord(slotTableId, slotId, updateFields);

// Invalidate cache
invalidateLessons();
invalidateSlotInventory();
```

---

## 4. createLesson - יצירת שיעור ב-nexusApi

**מיקום קוד:** `services/nexusApi.ts:2885-3562`

**זרימה:**
1. **ולידציה:**
   - בודק שדות חובה (שורה 2894)
   - בודק שמזהה תלמיד תקין (שורה 2928-2936)
2. **חישוב תאריכים:**
   - ממיר זמן מקומי ל-UTC (שורה 2946-2962)
3. **בדיקת התנגשויות:**
   - בודק שיעורים חופפים (שורה 2985-3050)
   - **דילוג על בדיקת slot_inventory** אם `source === 'slot_inventory'` (שורה 3076)
   - אם לא מ-slot_inventory, בודק חלונות פתוחים (שורה 3083-3143)
4. **יצירת רשומה ב-Airtable:**
   - מכין שדות (שורה 3150-3180)
   - מקשר תלמיד (שורה 3182-3200)
   - מקשר מורה (שורה 3202-3220)
   - שולח ל-Airtable (שורה 3222-3235)
5. **מחזיר שיעור מופה**

**קוד רלוונטי:**
```typescript
// nexusApi.ts:3076-3083
const isFromSlotBooking = (lesson as any).source === 'slot_inventory';
if (isFromSlotBooking && import.meta.env.DEV) {
  console.log(`[createLesson] Skipping slot conflict check - lesson is from slot_inventory booking`);
}
if (lesson.date && lesson.startTime && !isFromSlotBooking) {
  // בדוק חלונות פתוחים רק אם לא מ-slot_inventory
  // ...
}
```

---

## 5. התלות בין slot_inventory לשיעורים

### 5.1 איך שיעור משפיע על slot_inventory

**כאשר יוצרים שיעור:**
1. `createLesson` בודק חלונות פתוחים חופפים (אם לא מ-slot_inventory)
2. אם יש חלון פתוח חופף:
   - זורק שגיאה `CONFLICT_ERROR` (שורה 3110-3119)
   - **או** סוגר אוטומטית את החלון (שורה 3124-3132)

**כאשר משחרים slot_inventory:**
1. `reserveSlotAndCreateLessons` יוצר שיעורים
2. מעדכן את slot_inventory:
   - סטטוס = 'סגור'
   - מקשר שיעורים
   - מקשר תלמידים

### 5.2 איך slot_inventory משפיע על תצוגת שיעורים

**ב-Calendar:**
- `shouldRenderOpenSlot` מסנן חלונות פתוחים (שורה 33-92)
- בודק:
  1. סטטוס === 'open'
  2. אין שיעורים מקושרים (`slot.lessons.length > 0`)
  3. אין שיעור תואם (תאריך, שעה, מורה)

**בעיה אפשרית:**
- אם השיעור נוצר אבל לא מקושר ל-slot_inventory, החלון יישאר פתוח
- אם השיעור לא מופיע ב-`lessonsData` בגלל קאש, החלון יישאר פתוח

---

## 6. בעיות זוהו

### בעיה #1: לא ניתן לשריין לתלמיד מיומן שיעורים

**מיקום:** `components/Calendar.tsx:1617-1636`

**בעיה:**
- `SlotInventoryModal` לא מקבל `requireStudentForReserve={true}`
- לכן רק מעדכן סטטוס ל-'closed', לא יוצר שיעורים

**פתרון:**
```typescript
<SlotInventoryModal
  slot={{...}}
  onClose={() => setClickedSlot(null)}
  onSuccess={() => {
    setOpenSlots(prev => prev.filter(s => s.id !== clickedSlot.id));
    setClickedSlot(null);
    refreshData();
  }}
  requireStudentForReserve={true} // ✅ להוסיף!
/>
```

### בעיה #2: שיעור לא מופיע בלוח אחרי יצירה

**סיבות אפשריות:**

1. **קאש לא מתעדכן:**
   - `createLesson` ב-`mutations.ts` מבטל קאש (שורה 42-43)
   - אבל `refreshData()` יכול לקרוא לפני שהקאש מתעדכן
   - **פתרון:** להוסיף `forceRefresh` או לחכות קצת

2. **טווח תאריכים לא נכון:**
   - `refreshData()` משתמש ב-`startDate` ו-`endDateStr`
   - אם השיעור נוצר בתאריך מחוץ לטווח, לא יופיע
   - **פתרון:** לוודא שהטווח כולל את התאריך

3. **פילטר סטטוס:**
   - `filteredLessons` מסנן רק `SCHEDULED` ו-`COMPLETED` (שורה 195)
   - אם השיעור נוצר עם סטטוס אחר, לא יופיע
   - **פתרון:** לבדוק שהסטטוס נכון

4. **shouldRenderOpenSlot לא מזהה שיעור תואם:**
   - הפונקציה בודקת תאריך, שעה, מורה (שורה 59-82)
   - אם יש בעיה בנורמליזציה, לא יזהה
   - **פתרון:** לבדוק את הלוגיקה

### בעיה #3: חלון פתוח נשאר אחרי שריון

**סיבות אפשריות:**

1. **עדכון slot_inventory נכשל:**
   - `reserveSlotAndCreateLessons` מנסה לעדכן (שורה 285-290)
   - אם נכשל, יש fallback (שורה 302-304)
   - אבל יכול להיות שהעדכון לא עובד
   - **פתרון:** לבדוק את השגיאות ב-console

2. **קאש לא מתעדכן:**
   - `invalidateSlotInventory()` נקרא (שורה 376-386)
   - אבל `refreshData()` יכול לקרוא לפני שהקאש מתעדכן
   - **פתרון:** להוסיף `forceRefresh` או לחכות

3. **shouldRenderOpenSlot לא מסנן נכון:**
   - הפונקציה בודקת סטטוס ושיעורים מקושרים
   - אם העדכון לא עובד, החלון יישאר
   - **פתרון:** לבדוק את הלוגיקה

---

## 7. תיקונים מומלצים

### תיקון #1: הוסף requireStudentForReserve ב-Calendar (בשני מקומות!)

```typescript
// Calendar.tsx:1593-1614 - דרך slotModal hook
{slotModal.isOpen && slotModal.slotData && (
  <SlotInventoryModal
    slot={{
      id: slotModal.slotData.id,
      startDateTime: `${slotModal.slotData.date}T${slotModal.slotData.startTime}:00`,
      endDateTime: `${slotModal.slotData.date}T${slotModal.slotData.endTime}:00`,
      teacherId: slotModal.slotData.teacherId,
      status: slotModal.slotData.status as any,
    }}
    onClose={slotModal.close}
    onSuccess={() => {
      if (slotModal.activeSlotId) {
        setOpenSlots(prev => prev.filter(s => s.id !== slotModal.activeSlotId));
      }
      refreshData();
      slotModal.handleSuccess();
    }}
    requireStudentForReserve={true} // ✅ להוסיף!
  />
)}

// Calendar.tsx:1617-1636 - דרך clickedSlot (legacy)
{clickedSlot && !slotModal.isOpen && (
  <SlotInventoryModal
    slot={{
      id: clickedSlot.id,
      startDateTime: `${clickedSlot.date}T${clickedSlot.startTime}:00`,
      endDateTime: `${clickedSlot.date}T${clickedSlot.endTime}:00`,
      teacherId: clickedSlot.teacherId,
      status: clickedSlot.status as any,
    }}
    onClose={() => setClickedSlot(null)}
    onSuccess={() => {
      setOpenSlots(prev => prev.filter(s => s.id !== clickedSlot.id));
      setClickedSlot(null);
      refreshData();
    }}
    requireStudentForReserve={true} // ✅ להוסיף!
  />
)}
```

### תיקון #2: שפר refreshData עם forceRefresh

```typescript
// Calendar.tsx:490-558
const refreshData = async (forceRefresh = false) => {
  try {
    // אם forceRefresh, בטל קאש לפני
    if (forceRefresh) {
      invalidateLessons();
      invalidateSlotInventory();
    }
    
    const [lessonsData, inventoryData] = await Promise.all([
      getLessons({ start: `${startDate}T00:00:00.000Z`, end: `${endDateStr}T23:59:59.999Z` }),
      getSlotInventory({ start: `${startDate}T00:00:00.000Z`, end: `${endDateStr}T23:59:59.999Z` }),
    ]);
    
    // ... שאר הקוד
  } catch (err) {
    console.error('Error refreshing calendar data:', err);
  }
};

// בקריאות:
await refreshData(true); // forceRefresh = true
```

### תיקון #3: הוסף לוגים לניפוי באגים

```typescript
// Calendar.tsx:648
await refreshData();
// הוסף לוג:
if (import.meta.env.DEV) {
  console.log(`[Calendar] After createLesson, refreshing data...`);
  const [lessonsData] = await Promise.all([
    getLessons({ start: `${startDate}T00:00:00.000Z`, end: `${endDateStr}T23:59:59.999Z` }),
  ]);
  console.log(`[Calendar] Lessons after refresh:`, lessonsData.map(l => ({
    id: l.id,
    date: l.date,
    startTime: l.startTime,
    studentName: l.studentName,
  })));
}
```

---

## 8. סיכום

### זרימות עובדות:
- ✅ שריון מ-Availability (חריגים וחד-פעמי)
- ✅ יצירת שיעור מ-slot_inventory דרך `reserveSlotAndCreateLessons`

### בעיות:
- ❌ לא ניתן לשריין לתלמיד מיומן שיעורים (Calendar)
- ❌ שיעור לא מופיע בלוח אחרי יצירה
- ❌ חלון פתוח נשאר אחרי שריון

### תיקונים נדרשים:
1. הוסף `requireStudentForReserve={true}` ב-Calendar
2. שפר `refreshData` עם `forceRefresh`
3. הוסף לוגים לניפוי באגים
4. בדוק את `shouldRenderOpenSlot` - אולי יש בעיה בלוגיקה
