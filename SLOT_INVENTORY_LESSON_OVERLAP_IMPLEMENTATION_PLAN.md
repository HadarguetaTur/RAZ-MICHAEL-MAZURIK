# תכנון: חסימת slot_inventory פתוח שחופף לשיעור קיים

## סיכום

הוספת מנגנון סימטרי לזה הקיים ביומן שיעורים: כשמנסים ליצור/לערוך `slot_inventory` עם `status='open'` והוא חופף לשיעור קיים, המערכת תציג התראה ותחסום שמירה.

---

## 1. החלטה: איפה החסימה מתבצעת

### Client + Server (כפול, כמו ביומן שיעורים)

**Client (UI):**
- בדיקה לפני שמירה דרך `/api/conflicts/check`
- אם נמצאו חפיפות → מודל `LessonOverlapWarningModal`
- אפשרות "המשך בכל זאת" (עם logging)

**Server (API):**
- בדיקה ב-`updateSlotInventory()` - **כבר קיים** ✅
- בדיקה ב-`createSlotInventory()` - **צריך להוסיף** ❌
- אם נמצאו חפיפות → throw `CONFLICT_ERROR` (status: 409)
- **חסימה מוחלטת** - לא ניתן לעקוף

---

## 2. API שייקרא

### א. Client → Server

**Endpoint:** `POST /api/conflicts/check` (כבר קיים ✅)

**Request Body:**
```typescript
{
  entity: 'slot_inventory',
  recordId?: string,        // undefined אם CREATE, id אם UPDATE
  teacherId: string,
  date: string,            // YYYY-MM-DD
  start: string,           // HH:mm
  end: string              // HH:mm
}
```

**Response:**
```typescript
{
  hasConflicts: boolean,
  conflicts: ConflictItem[]  // רק שיעורים (source: 'lessons')
}
```

**מיקום:** `components/Availability.tsx:413` - `checkConflictsViaAPI()` (כבר קיים ✅)

### ב. Server → Validation

**פונקציה:** `preventSlotOpeningIfLessonsOverlap()` (כבר קיים ✅)

**מיקום:** `services/conflictValidationService.ts:258`

**שימוש:**
- `updateSlotInventory()` - כבר קורא (שורה 1674)
- `createSlotInventory()` - צריך להוסיף קריאה

---

## 3. מה חוזר במקרה חפיפה

### א. Client (API Response)

**Status:** `200 OK` (הבדיקה לא נכשלת, רק מחזירה תוצאות)

**Body:**
```typescript
{
  hasConflicts: true,
  conflicts: [
    {
      source: 'lessons',
      recordId: 'recABC123',
      start: '2025-01-29T10:00:00.000Z',
      end: '2025-01-29T11:00:00.000Z',
      label: 'יוסי כהן',
      meta: {}
    }
  ]
}
```

### ב. Server (Error Response)

**Status:** `409 Conflict`

**Body:**
```typescript
{
  message: 'לא ניתן לפתוח חלון - יש 2 שיעורים חופפים בזמן זה',
  code: 'CONFLICT_ERROR',
  status: 409,
  conflicts: {
    lessons: Lesson[],      // שיעורים חופפים
    openSlots: []            // ריק (לא רלוונטי כאן)
  }
}
```

**מיקום:** `services/nexusApi.ts:1690-1695` (כבר קיים ב-update ✅)

---

## 4. UX מוצג למשתמש

### א. Real-time Warning (בטופס)

**מיקום:** `components/Availability.tsx` - בתוך מודל עריכת slot_inventory

**תצוגה:**
- קופסה צהובה (`bg-amber-50`) עם אזהרה
- רשימת שיעורים חופפים
- **לא חוסמת** - רק מציגה אזהרה

**דוגמה:**
```
⚠️ נמצאה חפיפה בלו״ז
החלון המבוקש חופף עם 1 שיעור קיים:
• יוסי כהן - 10:00 (60 דק׳)
```

**מימוש:** צריך להוסיף `useEffect` דומה ל-`Calendar.tsx:352-445`

### ב. Overlap Modal (לפני שמירה)

**מיקום:** `components/ui/LessonOverlapWarningModal.tsx` (כבר קיים ✅)

**תצוגה:**
- מודל מלא מסך עם רקע מטושטש
- כותרת: "נמצאה חפיפה בלו״ז"
- רשימת שיעורים חופפים מפורטת
- כפתורים:
  - **"המשך בכל זאת"** (כחול) - ממשיך לשמירה למרות החפיפה
  - **"חזור לעריכה"** (אפור) - סוגר מודל, חוזר לטופס

**מימוש:** כבר קיים ב-`Availability.tsx:1075-1081` ✅

### ג. Server Error (אם עוקפים UI)

**מיקום:** `components/Availability.tsx:541` - `catch` ב-`performSave()`

**תצוגה:**
- `alert()` עם הודעת שגיאה
- מציגה פרטי שיעורים חופפים
- **חסימה מוחלטת** - לא ניתן לשמור

**דוגמה:**
```
לא ניתן לפתוח חלון - יש 1 שיעור חופף בזמן זה

שיעורים חופפים:
• יוסי כהן - 2025-01-29 10:00 (60 דק׳)

אנא בחר זמן אחר או סגור את השיעור החופף תחילה.
```

---

## 5. שינויים נדרשים בקוד

### א. Client - `components/Availability.tsx`

#### 1. הוספת בדיקה ב-CREATE mode

**מיקום:** `handleSave()` (שורה 548)

**שינוי:**
```typescript
// לפני: בדיקה רק ב-UPDATE (שורה 586-623)
// אחרי: בדיקה גם ב-CREATE

const isSlotInventory = selectedSlot && !('dayOfWeek' in selectedSlot);

if (isSlotInventory) {
  const slotInventory = selectedSlot as SlotInventory;
  const slotDate = formData.date || slotInventory.date;
  
  // Validate required fields
  if (!slotDate || !formData.startTime || !formData.endTime) {
    alert('נא למלא את כל שדות החובה...');
    return;
  }

  // Check conflicts via API - גם ב-CREATE וגם ב-UPDATE
  setIsCheckingConflicts(true);
  try {
    const conflictsResult = await checkConflictsViaAPI(
      formData.teacherId,
      slotDate,
      formData.startTime,
      formData.endTime,
      slotInventory?.id  // undefined אם CREATE, id אם UPDATE
    );

    if (conflictsResult && conflictsResult.hasConflicts && conflictsResult.conflicts.length > 0) {
      // Filter only lesson conflicts (not slot conflicts)
      const lessonConflicts = conflictsResult.conflicts.filter(c => c.source === 'lessons');
      
      if (lessonConflicts.length > 0) {
        setOverlapConflicts(lessonConflicts);
        setPendingSaveAction(() => performSave);
        setShowOverlapModal(true);
        setIsCheckingConflicts(false);
        return; // חסימה
      }
    }
  } catch (err) {
    console.error('[Availability] Failed to check conflicts:', err);
    // Continue with save if conflict check fails (non-blocking)
  } finally {
    setIsCheckingConflicts(false);
  }
}
```

#### 2. הוספת Real-time Warning

**מיקום:** אחרי `handleSave()` (שורה 627)

**קוד חדש:**
```typescript
// Real-time overlap detection for slot_inventory (client-side, debounced)
useEffect(() => {
  const timeoutId = setTimeout(() => {
    // Only check if modal is open and editing slot_inventory
    const isSlotInventory = selectedSlot && !('dayOfWeek' in selectedSlot);
    if (!isModalOpen || !isSlotInventory || !formData.date || !formData.startTime || !formData.endTime) {
      setRealtimeOverlapWarning(null);
      return;
    }

    const slotInventory = selectedSlot as SlotInventory;
    const slotDate = formData.date || slotInventory.date;
    const proposedStartISO = new Date(`${slotDate}T${formData.startTime}:00`).toISOString();
    const proposedEndISO = new Date(`${slotDate}T${formData.endTime}:00`).toISOString();
    
    const conflicts: Array<{ type: 'lesson'; label: string; time: string }> = [];

    // Check overlapping lessons (use loaded lessons from state)
    // Need to load lessons for the date range
    // For now, use checkConflictsViaAPI (debounced)
    checkConflictsViaAPI(
      formData.teacherId,
      slotDate,
      formData.startTime,
      formData.endTime,
      slotInventory?.id
    ).then(result => {
      if (result && result.hasConflicts) {
        const lessonConflicts = result.conflicts.filter(c => c.source === 'lessons');
        if (lessonConflicts.length > 0) {
          setRealtimeOverlapWarning({
            hasOverlap: true,
            conflicts: lessonConflicts.map(c => ({
              type: 'lesson' as const,
              label: c.label,
              time: `${c.start.slice(11, 16)} (${Math.round((new Date(c.end).getTime() - new Date(c.start).getTime()) / 60000)} דק׳)`,
            })),
          });
        } else {
          setRealtimeOverlapWarning(null);
        }
      } else {
        setRealtimeOverlapWarning(null);
      }
    }).catch(() => {
      setRealtimeOverlapWarning(null);
    });
  }, 500); // 500ms debounce

  return () => clearTimeout(timeoutId);
}, [formData.date, formData.startTime, formData.endTime, formData.teacherId, isModalOpen, selectedSlot]);
```

**State חדש:**
```typescript
const [realtimeOverlapWarning, setRealtimeOverlapWarning] = useState<{
  hasOverlap: boolean;
  conflicts: Array<{ type: 'lesson'; label: string; time: string }>;
} | null>(null);
```

#### 3. הוספת UI ל-Real-time Warning

**מיקום:** בתוך מודל עריכת slot_inventory (אחרי שדות הטופס)

**קוד:**
```typescript
{/* Real-time Overlap Warning */}
{realtimeOverlapWarning && realtimeOverlapWarning.hasOverlap && (
  <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl">
    <div className="flex items-start gap-3">
      <span className="text-amber-600 text-xl">⚠️</span>
      <div className="flex-1">
        <div className="text-sm font-black text-amber-800 mb-2">
          נמצאה חפיפה בלו״ז
        </div>
        <div className="text-xs font-medium text-amber-700 mb-2">
          החלון המבוקש חופף עם {realtimeOverlapWarning.conflicts.length} שיעור{realtimeOverlapWarning.conflicts.length > 1 ? 'ים' : ''} קיים{realtimeOverlapWarning.conflicts.length > 1 ? 'ים' : ''}:
        </div>
        <div className="space-y-1">
          {realtimeOverlapWarning.conflicts.map((conflict, idx) => (
            <div key={idx} className="text-xs font-bold text-amber-700">
              • {conflict.label} - {conflict.time}
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
)}
```

#### 4. שיפור Error Handling ב-performSave()

**מיקום:** `performSave()` (שורה 541)

**שינוי:**
```typescript
} catch (err: any) {
  if (err.code === 'CONFLICT_ERROR' || err.status === 409) {
    // Handle conflicts structure: { lessons: Lesson[], openSlots: SlotInventory[] }
    const conflicts = err.conflicts || {};
    const lessonConflicts = conflicts.lessons || [];
    
    let conflictDetails = '';
    if (lessonConflicts.length > 0) {
      const lessonDetails = lessonConflicts.map((c: Lesson) => 
        `• ${c.studentName || 'ללא שם'} - ${c.date} ${c.startTime} (${c.duration || 60} דקות)`
      ).join('\n');
      conflictDetails = `שיעורים חופפים:\n${lessonDetails}\n\n`;
    }
    
    alert(`לא ניתן לפתוח חלון!\n\n${err.message || 'החלון המבוקש חופף עם שיעור קיים'}\n\n${conflictDetails}אנא בחר זמן אחר או סגור את השיעור החופף תחילה.`);
  } else {
    alert(parseApiError(err));
  }
}
```

### ב. Server - `services/slotManagementService.ts`

#### 1. שינוי `createSlotInventory()` לזרוק שגיאה

**מיקום:** `createSlotInventory()` (שורה 285-312)

**שינוי:**
```typescript
// לפני: משנה סטטוס ל-'closed' אם יש חפיפות
// אחרי: זורק שגיאה 409 אם יש חפיפות

// PREVENT DUPLICATES: Check for overlapping lessons before creating open slot
if (finalStatus === 'open' || finalStatus === 'פתוח') {
  try {
    const { canOpen, conflictingLessons } = await preventSlotOpeningIfLessonsOverlap(
      slot.teacherId,
      dateStr,
      slot.startTime,
      slot.endTime
    );

    if (!canOpen) {
      // Cannot open slot - throw error instead of silently changing status
      const conflictError: any = {
        message: `לא ניתן לפתוח חלון - יש ${conflictingLessons.length} שיעור${conflictingLessons.length > 1 ? 'ים' : ''} חופף${conflictingLessons.length > 1 ? 'ים' : ''} בזמן זה`,
        code: 'CONFLICT_ERROR',
        status: 409,
        conflicts: {
          lessons: conflictingLessons,
          openSlots: [],
        },
      };
      throw conflictError;
    }
  } catch (preventError: any) {
    // Re-throw conflict errors (they should prevent slot creation)
    if (preventError.code === 'CONFLICT_ERROR') {
      throw preventError;
    }
    // Log but don't fail slot creation if other errors occur
    console.warn(`[createSlotInventory] Failed to check for lesson overlaps before creating slot ${slot.natural_key}:`, preventError);
    // Default to "closed" if check fails (safer - prevents duplicates)
    finalStatus = 'closed';
  }
}
```

### ג. Server - `services/nexusApi.ts`

#### 1. הוספת `createSlotInventory()` עם בדיקת חפיפות

**מיקום:** אחרי `deleteSlotInventory()` (שורה 1829)

**קוד חדש:**
```typescript
createSlotInventory: async (slot: {
  teacherId: string;
  date: string;
  startTime: string;
  endTime: string;
  status?: string;
  type?: string;
  createdFrom?: string;
}): Promise<SlotInventory> => {
  // Use slotManagementService which already has overlap check
  const { createSlotInventory: createSlotInventoryService } = await import('./slotManagementService');
  
  const dateObj = new Date(slot.date);
  const naturalKey = `${slot.teacherId}|${slot.date}|${slot.startTime}`;
  
  return createSlotInventoryService({
    natural_key: naturalKey,
    teacherId: slot.teacherId,
    date: dateObj,
    startTime: slot.startTime,
    endTime: slot.endTime,
    status: slot.status || 'open',
    type: slot.type,
    createdFrom: slot.createdFrom,
  });
},
```

**הערה:** `slotManagementService.createSlotInventory()` כבר יזרוק שגיאה 409 אם יש חפיפות (אחרי השינוי לעיל).

### ד. Server - `server/apiServer.ts`

#### 1. וידוא ש-`/api/conflicts/check` מטפל ב-`slot_inventory`

**מיקום:** `server/apiServer.ts:182-243`

**סטטוס:** כבר תומך ✅

**וידוא:** הפונקציה `checkConflicts()` כבר מטפלת ב-`entity: 'slot_inventory'` ומחזירה רק שיעורים חופפים (לא סלוטים).

---

## 6. Reuse של לוגיקה קיימת

### פונקציות לשימוש חוזר:

1. **`hasOverlap()`** - `services/overlapDetection.ts:16`
   - לוגיקת חפיפה טהורה
   - ✅ כבר בשימוש

2. **`preventSlotOpeningIfLessonsOverlap()`** - `services/conflictValidationService.ts:258`
   - בודקת אם ניתן לפתוח סלוט
   - ✅ כבר בשימוש ב-`updateSlotInventory()`
   - ✅ יקרא גם ב-`createSlotInventory()`

3. **`checkConflicts()`** - `services/conflictsCheckService.ts:127`
   - בדיקת חפיפות כללית
   - ✅ כבר בשימוש דרך `/api/conflicts/check`

4. **`LessonOverlapWarningModal`** - `components/ui/LessonOverlapWarningModal.tsx`
   - מודל התראה על חפיפות
   - ✅ כבר בשימוש ב-`Availability.tsx`

---

## 7. תרשים זרימה

```
┌─────────────────────────────────────────────────────────────┐
│ משתמש לוחץ "שמור" על slot_inventory פתוח                  │
└────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Availability.tsx: handleSave()                              │
│ 1. בדיקת תקינות שדות                                        │
│ 2. זיהוי: slot_inventory (לא weekly_slot)                   │
└────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ checkConflictsViaAPI()                                      │
│ POST /api/conflicts/check                                   │
│ entity: 'slot_inventory'                                    │
└────────────────────┬────────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                            │
        ▼                            ▼
┌───────────────┐          ┌──────────────────┐
│ יש חפיפות?    │          │ אין חפיפות       │
│ (lessons)     │          │                  │
└───────┬───────┘          └────────┬─────────┘
        │                          │
        ▼                          ▼
┌──────────────────────┐   ┌──────────────────┐
│ LessonOverlapWarning │   │ performSave()     │
│ Modal                │   │                  │
│                      │   └────────┬─────────┘
│ [המשך בכל זאת]      │            │
│ [חזור לעריכה]       │            ▼
└───────┬──────────────┘   ┌──────────────────┐
        │                  │ nexusApi.create/  │
        │                  │ updateSlot        │
        │                  │ Inventory()       │
        │                  └────────┬─────────┘
        │                           │
        └───────────┬───────────────┘
                    │
                    ▼
        ┌───────────────────────────┐
        │ Server Validation         │
        │                            │
        │ 1. preventSlotOpeningIf   │
        │    LessonsOverlap()        │
        │    ↓                       │
        │ 2. אם יש lessons חופפים:   │
        │    → throw CONFLICT_ERROR  │
        │    (status: 409)           │
        │                            │
        │ 3. אם אין חפיפות:         │
        │    → יוצר/מעדכן slot       │
        └───────────┬────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌──────────────┐      ┌─────────────────┐
│ שגיאה 409    │      │ slot נוצר/עודכן │
│ alert()      │      │ refreshData()    │
│              │      │                  │
│ חסימה        │      │ הצלחה           │
└──────────────┘      └─────────────────┘
```

---

## 8. נקודות חשובות

1. **סימטריה:**
   - אותו מנגנון כמו ביומן שיעורים
   - אותו API endpoint (`/api/conflicts/check`)
   - אותו מודל (`LessonOverlapWarningModal`)
   - אותה לוגיקת חפיפה (`hasOverlap()`)

2. **Reuse:**
   - אין שכפול לוגיקה
   - שימוש חוזר ב-`preventSlotOpeningIfLessonsOverlap()`
   - שימוש חוזר ב-`checkConflicts()`
   - שימוש חוזר ב-`LessonOverlapWarningModal`

3. **Client + Server:**
   - בדיקה בלקוח (UI) - לא חוסמת, מציגה מודל
   - בדיקה בשרת (API) - חוסמת מוחלטת (409)

4. **CREATE + UPDATE:**
   - בדיקה גם ביצירה וגם בעריכה
   - אותו מנגנון בשני המקרים

5. **Real-time Warning:**
   - אזהרה בזמן אמת בטופס (לא חוסמת)
   - מודל לפני שמירה (חוסמת, עם אפשרות עקיפה)

---

## 9. סיכום שינויים

### קבצים לשינוי:

1. **`components/Availability.tsx`**
   - הוספת בדיקה ב-CREATE mode
   - הוספת Real-time Warning
   - שיפור Error Handling

2. **`services/slotManagementService.ts`**
   - שינוי `createSlotInventory()` לזרוק שגיאה במקום לשנות סטטוס

3. **`services/nexusApi.ts`** (אופציונלי)
   - הוספת `createSlotInventory()` אם לא קיים

### קבצים ללא שינוי (reuse):

- `services/conflictValidationService.ts` ✅
- `services/overlapDetection.ts` ✅
- `services/conflictsCheckService.ts` ✅
- `server/apiServer.ts` ✅
- `components/ui/LessonOverlapWarningModal.tsx` ✅

---

## 10. בדיקות נדרשות

1. ✅ יצירת slot_inventory פתוח שחופף לשיעור → מודל מוצג
2. ✅ עריכת slot_inventory לפתוח שחופף לשיעור → מודל מוצג
3. ✅ "המשך בכל זאת" → שמירה ממשיכה, logging
4. ✅ עקיפת UI → שגיאת שרת 409
5. ✅ Real-time Warning → מוצג בזמן עריכה
6. ✅ אין חפיפות → שמירה רגילה
