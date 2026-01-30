# תיעוד מנגנון חפיפה: שיעור ↔ slot_inventory פתוח

## סיכום

כשקובעים שיעור והוא חופף לסלוט פתוח (`slot_inventory` עם `status='open'`), המערכת מציגה התראה ומבצעת חסימה. המנגנון פועל **גם בצד לקוח (UI) וגם בצד שרת (API)**.

---

## 1. מקום החסימה

### א. בצד לקוח (UI) - `components/Calendar.tsx`

**מיקום:** `handleSave()` (שורה 661)

**תהליך:**
1. לפני שמירה, קורא ל-`checkConflictsViaAPI()` (שורה 704)
2. אם נמצאו חפיפות (`conflictsResult.hasConflicts`), מציג מודל `LessonOverlapWarningModal`
3. המשתמש יכול לבחור "המשך בכל זאת" או "חזור לעריכה"

**קוד רלוונטי:**
```typescript
// Calendar.tsx:701-719
const conflictsResult = await checkConflictsViaAPI(...);
if (conflictsResult && conflictsResult.hasConflicts && conflictsResult.conflicts.length > 0) {
  setOverlapConflicts(conflictsResult.conflicts);
  setPendingSaveAction(() => performSave);
  setShowOverlapModal(true);
  return; // חסימה - לא ממשיך לשמירה
}
```

### ב. בצד שרת (API) - `services/nexusApi.ts`

**מיקום 1:** `createLesson()` (שורה 2843)

**תהליך:**
1. לפני יצירת שיעור, קורא ל-`validateConflicts()` מ-`conflictValidationService`
2. אם נמצאו `openSlots` חופפים, זורק שגיאה `CONFLICT_ERROR` עם `status: 409`
3. השגיאה מוחזרת ללקוח ומציגה `alert`

**קוד רלוונטי:**
```typescript
// nexusApi.ts:2870-2886
if (validationResult.conflicts.openSlots.length > 0) {
  const conflictError: any = {
    message: `לא ניתן לקבוע שיעור - יש חלון פתוח חופף...`,
    code: 'CONFLICT_ERROR',
    status: 409,
    conflicts: {
      lessons: [],
      openSlots: validationResult.conflicts.openSlots,
    },
  };
  throw conflictError; // חסימה - לא יוצר שיעור
}
```

**מיקום 2:** `updateLesson()` (שורה 1905)

**תהליך:** זהה ל-`createLesson()` - בודק חפיפות לפני עדכון שיעור קיים.

---

## 2. פונקציות בדיקת חפיפה

### א. בצד לקוח

**1. `checkConflictsViaAPI()`** - `components/Calendar.tsx:540`
- שולח POST ל-`/api/conflicts/check`
- מחזיר `CheckConflictsResult` עם רשימת חפיפות

**2. `findOverlappingOpenSlots()`** - `services/overlapDetection.ts:58`
- בודק חפיפה בין `LessonDraft` לרשימת `openSlots`
- מסנן לפי `status === 'open'` ו-`teacherId` (אם קיים)

**3. בדיקה בזמן אמת** - `components/Calendar.tsx:352-445`
- `useEffect` שבודק חפיפות בזמן אמת תוך כדי עריכה
- מציג אזהרה ויזואלית בטופס (`realtimeOverlapWarning`)

### ב. בצד שרת

**1. `validateConflicts()`** - `services/conflictValidationService.ts:43`
- הפונקציה המרכזית לבדיקת חפיפות
- בודקת גם שיעורים וגם `slot_inventory` פתוחים
- מחזירה `ConflictValidationResult` עם `conflicts.openSlots`

**2. `hasOverlap()`** - `services/overlapDetection.ts:16`
- פונקציה טהורה לבדיקת חפיפה בין שני טווחי זמן
- לוגיקה: `aS < bE && aE > bS` (touching לא נחשב חפיפה)

**3. API Endpoint** - `server/apiServer.ts:182`
- `POST /api/conflicts/check`
- קורא ל-`checkConflicts()` מ-`conflictsCheckService`

---

## 3. מקור נתונים - slot_inventory

### א. נטען בלקוח

**מיקום:** `components/Calendar.tsx:136-171`

```typescript
const inventoryData = await getSlotInventory({
  start: `${startDate}T00:00:00.000Z`,
  end: `${endDateStr}T23:59:59.999Z`
});
```

**מקור:** `data/resources/slotInventory.ts` → `nexusApi.getSlotInventory()`

**טווח:** שבוע נוכחי (7 ימים)

### ב. נטען בשרת

**מיקום:** `services/conflictValidationService.ts:75-78`

```typescript
const slots = await nexusApi.getSlotInventory(dayStartISO, dayEndISO, teacherId);
```

**טווח:** יום אחד (`00:00:00` עד `23:59:59.999`)

**פילטרים:**
- `status === 'open'` או `status === 'פתוח'`
- `lessons` ריק (אין שיעורים מקושרים)
- `teacherId` תואם (אם סופק)

---

## 4. הגדרת חפיפה

### לוגיקה

**פונקציה:** `hasOverlap()` - `services/overlapDetection.ts:16`

```typescript
return aS < bE && aE > bS;
```

**פירוש:**
- `aS` = זמן התחלה של טווח A
- `aE` = זמן סיום של טווח A
- `bS` = זמן התחלה של טווח B
- `bE` = זמן סיום של טווח B

**דוגמאות:**
- ✅ חפיפה: `10:00-11:00` ו-`10:30-11:30` → `10:00 < 11:30 && 11:00 > 10:30` = `true`
- ❌ לא חפיפה: `10:00-11:00` ו-`11:00-12:00` → `10:00 < 12:00 && 11:00 > 11:00` = `false` (touching)

### תנאים נוספים

1. **תאריך:** חייב להיות זהה (`lesson.date === slot.date`)
2. **מורה:** אם שני הצדדים יש `teacherId`, חייב להיות זהה
3. **סטטוס:** רק `status === 'open'` או `'פתוח'`
4. **שיעורים מקושרים:** `slot.lessons` חייב להיות ריק
5. **שיעורים מבוטלים:** שיעורים עם `status === 'בוטל'` או `'CANCELLED'` לא נחשבים

### גבולות end==start

**לא נחשב חפיפה:**
- שיעור: `10:00-11:00`, סלוט: `11:00-12:00` → לא חופף (touching)
- שיעור: `11:00-12:00`, סלוט: `10:00-11:00` → לא חופף (touching)

**נחשב חפיפה:**
- שיעור: `10:00-11:00`, סלוט: `10:30-11:30` → חופף
- שיעור: `10:00-11:00`, סלוט: `09:30-10:30` → חופף

---

## 5. UX והודעות למשתמש

### א. אזהרה בזמן אמת (Real-time Warning)

**מיקום:** `components/Calendar.tsx:1198-1220`

**תצוגה:**
- קופסה צהובה (`bg-amber-50`) בטופס עריכת שיעור
- מציגה רשימת חפיפות (שיעורים + חלונות פתוחים)
- לא חוסמת - רק מציגה אזהרה

**דוגמה:**
```
⚠️ נמצאה חפיפה בלו״ז
השיעור המבוקש חופף עם 2 פריטים קיימים:
• חלון פתוח - 10:00–11:00 (חלון פתוח)
• יוסי כהן - 10:30 (שיעור)
```

### ב. מודל חפיפה (Overlap Modal)

**מיקום:** `components/ui/LessonOverlapWarningModal.tsx`

**תצוגה:**
- מודל מלא מסך עם רקע מטושטש
- כותרת: "נמצאה חפיפה בלו״ז"
- רשימת חפיפות מפורטת (תווית, זמן, סוג)
- כפתורים:
  - **"המשך בכל זאת"** (כחול) - ממשיך לשמירה למרות החפיפה
  - **"חזור לעריכה"** (אפור) - סוגר מודל, חוזר לטופס

**דוגמה:**
```
נמצאה חפיפה בלו״ז
השיעור המבוקש חופף עם 1 פריט קיים:

┌─────────────────────────────┐
│ חלון פתוח                  │
│ 10:00 – 11:00 · חלון פתוח  │
└─────────────────────────────┘

[המשך בכל זאת]
[חזור לעריכה]
```

### ג. שגיאת שרת (Server Error)

**מיקום:** `components/Calendar.tsx:627-655`

**תצוגה:**
- `alert()` עם הודעת שגיאה
- מציגה פרטי חפיפות (שיעורים + חלונות פתוחים)
- **חסימה מוחלטת** - לא ניתן לשמור

**דוגמה:**
```
לא ניתן לקבוע שיעורים חופפים!

לא ניתן לקבוע שיעור - יש חלון פתוח חופף בזמן זה: 2025-01-29 10:00-11:00. 
אנא סגור את החלון הפתוח תחילה או בחר זמן אחר.

חלונות פתוחים חופפים:
• חלון פתוח - 2025-01-29 10:00-11:00 (יוסי כהן)

אנא בחר זמן אחר.
```

---

## 6. האם החסימה מוחלטת?

### לא - יש אפשרות "המשך בכל זאת"

**בצד לקוח:**
- מודל `LessonOverlapWarningModal` מציע כפתור "המשך בכל זאת"
- אם המשתמש בוחר, השמירה ממשיכה למרות החפיפה
- הפעולה נרשמת ב-`eventLog` (override)

**בצד שרת:**
- אם הבדיקה בצד לקוח נכשלה או דולגה, השרת עדיין בודק
- אם נמצאו חפיפות, זורק שגיאה 409
- **אין אפשרות לעקוף בצד שרת** - החסימה מוחלטת

**סיכום:**
- ✅ בצד לקוח: אפשר לעקוף ("המשך בכל זאת")
- ❌ בצד שרת: חסימה מוחלטת (409)

---

## 7. רשימת קבצים ופונקציות

### קבצים מרכזיים

1. **`components/Calendar.tsx`**
   - `handleSave()` - נקודת כניסה לשמירה
   - `checkConflictsViaAPI()` - בדיקת חפיפות דרך API
   - `performSave()` - ביצוע שמירה בפועל
   - `handleOverlapContinue()` - טיפול ב"המשך בכל זאת"

2. **`components/ui/LessonOverlapWarningModal.tsx`**
   - מודל התראה על חפיפות
   - כפתורי "המשך בכל זאת" / "חזור לעריכה"

3. **`services/nexusApi.ts`**
   - `createLesson()` - יצירת שיעור (שורה 2843)
   - `updateLesson()` - עדכון שיעור (שורה 1905)
   - שתיהן בודקות חפיפות לפני שמירה

4. **`services/conflictValidationService.ts`**
   - `validateConflicts()` - בדיקת חפיפות מרכזית
   - `autoCloseOverlappingSlots()` - סגירה אוטומטית של סלוטים חופפים

5. **`services/overlapDetection.ts`**
   - `hasOverlap()` - לוגיקת חפיפה טהורה
   - `findOverlappingOpenSlots()` - מציאת סלוטים חופפים

6. **`server/apiServer.ts`**
   - `POST /api/conflicts/check` - endpoint לבדיקת חפיפות

7. **`services/conflictsCheckService.ts`**
   - `checkConflicts()` - לוגיקת בדיקת חפיפות בשרת

8. **`utils/overlaps.ts`**
   - `isOverlapping()` - פונקציה טהורה לבדיקת חפיפה (גרסה נוספת)

---

## 8. תרשים זרימה

```
┌─────────────────────────────────────────────────────────────┐
│ משתמש לוחץ "שמור שיעור"                                     │
└────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ Calendar.tsx: handleSave()                                   │
│ 1. בדיקת תקינות שדות                                         │
│ 2. בדיקת חפיפות שיעורים (client-side)                       │
└────────────────────┬────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│ checkConflictsViaAPI()                                       │
│ POST /api/conflicts/check                                    │
└────────────────────┬────────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                            │
        ▼                            ▼
┌───────────────┐          ┌──────────────────┐
│ יש חפיפות?    │          │ אין חפיפות       │
│ (openSlots)   │          │                  │
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
        │                  │ nexusApi.create  │
        │                  │ Lesson()         │
        │                  └────────┬─────────┘
        │                           │
        └───────────┬───────────────┘
                    │
                    ▼
        ┌───────────────────────────┐
        │ nexusApi.createLesson()    │
        │                            │
        │ 1. validateConflicts()    │
        │    ↓                       │
        │ 2. אם יש openSlots חופפים: │
        │    → throw CONFLICT_ERROR  │
        │    (status: 409)           │
        │                            │
        │ 3. אם אין חפיפות:         │
        │    → יוצר שיעור            │
        │    → autoCloseOverlapping  │
        │      Slots() (safety)      │
        └───────────┬────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
┌──────────────┐      ┌─────────────────┐
│ שגיאה 409    │      │ שיעור נוצר      │
│ alert()      │      │ refreshData()    │
│              │      │                  │
│ חסימה        │      │ הצלחה           │
└──────────────┘      └─────────────────┘
```

---

## 9. נקודות חשובות

1. **כפילות בדיקה:**
   - בדיקה בצד לקוח (UI) - לא חוסמת, רק מציגה אזהרה
   - בדיקה בצד שרת (API) - חוסמת מוחלטת (409)

2. **מקור נתונים:**
   - לקוח: טעינה שבועית (`getSlotInventory`)
   - שרת: טעינה יומית (`nexusApi.getSlotInventory`)

3. **פילטרים:**
   - רק `status === 'open'` או `'פתוח'`
   - רק `lessons` ריק
   - רק `teacherId` תואם (אם קיים)

4. **חפיפה:**
   - `aS < bE && aE > bS`
   - Touching (`end == start`) לא נחשב חפיפה

5. **עקיפה:**
   - אפשרית בצד לקוח ("המשך בכל זאת")
   - לא אפשרית בצד שרת (409)

---

## 10. הערות טכניות

- **Timezone:** כל החישובים ב-ISO strings (UTC)
- **Caching:** `slot_inventory` נטען דרך `data/resources/slotInventory.ts` עם cache invalidation
- **Error Handling:** שגיאות בבדיקת חפיפות לא חוסמות שמירה (graceful degradation)
- **Logging:** פעולות override נרשמות ב-`eventLog` (אם `teacherId` ו-`date` קיימים)
