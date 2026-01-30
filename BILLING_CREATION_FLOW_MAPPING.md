# מיפוי מודל יצירת חיובים - Billing Creation Flow Mapping

## סקירה כללית
מסמך זה ממפה את כל התהליך של יצירת חיובים חודשיים, כולל כל נקודות הגישה לנתונים והכשלים שזוהו.

---

## 1. נקודת כניסה - UI Component

### קובץ: `components/Billing.tsx`

**פונקציות כניסה:**
- `handleCreateMonthlyCharges()` - שורה 402
- Auto-create ב-`useEffect` - שורה 147 (אוטומטי ב-1 לחודש)

**זרימה:**
```
User clicks "צור חיובים חודשיים" 
  ↓
handleCreateMonthlyCharges()
  ↓
createMonthlyChargesMutation(billingMonth)
```

---

## 2. Data Layer - Mutations

### קובץ: `data/mutations.ts`

**פונקציה:** `createMonthlyCharges()` - שורה 268

**מה היא עושה:**
1. קוראת ל-`nexusApi.createMonthlyCharges(billingMonth)`
2. מבטלת cache: `invalidateBilling(billingMonth)`
3. מחזירה תוצאה: `{ createdCount, skippedCount, errors? }`

**Cache Invalidation:**
- מבטלת את כל ה-cache של billing לחודש הספציפי
- מפעילה רענון אוטומטי של הנתונים

---

## 3. API Layer - Nexus API

### קובץ: `services/nexusApi.ts`

**פונקציה:** `nexusApi.createMonthlyCharges()` - שורה 2614

**מה היא עושה:**
1. בודקת שיש API Key ו-Base ID
2. קוראת ל-`createMonthlyCharges(airtableClient, billingMonth)`

**הערה:** זה רק wrapper - הלוגיקה האמיתית ב-`billingService.ts`

---

## 4. Billing Service - Entry Point

### קובץ: `services/billingService.ts`

**פונקציה:** `createMonthlyCharges()` - שורה 1096

**מה היא עושה:**
```typescript
export async function createMonthlyCharges(
  client: AirtableClient,
  billingMonth: string
): Promise<CreateMonthlyChargesResult>
```

**לוגיקה:**
1. בודקת פורמט של `billingMonth` (YYYY-MM)
2. **קוראת ל-Billing Engine:** `buildMonthForAllActiveStudents(client, billingMonth, false)`
3. מחזירה תוצאה מפורמטת:
   - `createdCount` - מספר חיובים שנוצרו
   - `skippedCount` - מספר תלמידים שדולגו
   - `errors` - רשימת שגיאות

**⚠️ נקודת כשל אפשרית:**
- אם `billingMonth` לא בפורמט נכון → Error
- אם Billing Engine נכשל → Error מועבר הלאה

---

## 5. Billing Engine - הליבה

### קובץ: `billing/billingEngine.ts`

**פונקציה ראשית:** `buildMonthForAllActiveStudents()` - שורה 396

### 5.1 שלב 1: איסוף נתונים ראשוני

**טבלאות שמובאות:**
1. **Students** - כל התלמידים הפעילים (`is_active = 1`)
   - Table: `students`
   - Filter: `{is_active} = 1`
   - שורה: 433-437

2. **Lessons** - כל השיעורים לחודש
   - Table: `lessons`
   - Filter: 
     ```javascript
     OR(
       {billing_month} = "YYYY-MM",
       AND(
         IS_AFTER({start_datetime}, "YYYY-MM-01"),
         IS_BEFORE({start_datetime}, "YYYY-MM-lastDay")
       )
     )
     ```
   - שורה: 441-452
   - **⚠️ נקודת כשל:** אם `billing_month` לא מוגדר, מנסה לפי תאריך

3. **Cancellations** - כל הביטולים לחודש
   - Table: `cancellations`
   - Filter: `{billing_month} = "YYYY-MM"`
   - שורה: 455-459
   - **⚠️ נקודת כשל:** דורש `billing_month` - אם לא קיים, לא ימצא ביטולים

4. **Subscriptions** - כל המנויים (ללא פילטר חודש)
   - Table: `subscriptions`
   - שורה: 462-464
   - **⚠️ נקודת כשל:** מביא את כל המנויים - יכול להיות כבד

5. **Existing Bills** - חיובים קיימים לחודש
   - Table: `monthlyBills` (חיובים)
   - Filter: `{חודש חיוב} = "YYYY-MM"`
   - שורה: 467-471
   - **⚠️ נקודת כשל:** אם יש duplicates, זה יזוהה מאוחר יותר

### 5.2 שלב 2: קיבוץ נתונים לפי תלמיד

**שורות 476-520:**
- `lessonsByStudent` - Map של שיעורים לפי תלמיד
- `cancellationsByStudent` - Map של ביטולים לפי תלמיד
- `subscriptionsByStudent` - Map של מנויים לפי תלמיד
- `billsByStudent` - Map של חיובים קיימים לפי תלמיד

**⚠️ נקודות כשל:**
- אם `full_name` בשיעור לא תקין → שיעור לא יקושר לתלמיד
- אם `student` בביטול לא תקין → ביטול לא יקושר
- אם `student_id` במנוי לא תקין → מנוי לא יקושר

### 5.3 שלב 3: עיבוד כל תלמיד

**לולאה:** שורה 530-589

**לכל תלמיד:**
1. קורא ל-`buildStudentMonth()` - שורה 542
2. מטפל בתוצאות:
   - **Success** → מוסיף ל-`success[]`
   - **MissingFieldsError** → מוסיף ל-`errors[]`
   - **DomainError** → בודק סוג:
     - `NO_BILLABLE_DATA` → מוסיף ל-`skipped[]`
     - `DUPLICATE_BILLING_RECORDS` → מוסיף ל-`errors[]`
     - אחר → מוסיף ל-`errors[]`

---

## 6. Billing Engine - עיבוד תלמיד בודד

### קובץ: `billing/billingEngine.ts`

**פונקציה:** `buildStudentMonth()` - שורה 117

### 6.1 שלב 1: איסוף נתונים לתלמיד ספציפי

**אם יש prefetchedData:**
- משתמש בנתונים שכבר נאספו (אופטימיזציה)

**אם אין:**
1. **Student Record** - שורה 160
   - Table: `students`
   - Record ID: `studentRecordId`
   - **⚠️ כשל:** אם תלמיד לא קיים → `STUDENT_NOT_FOUND`

2. **Lessons** - שורה 175-189
   - Filter: 
     ```javascript
     AND(
       {full_name} = "studentRecordId",
       OR(
         {billing_month} = "YYYY-MM",
         AND(
           IS_AFTER({start_datetime}, "startDate"),
           IS_BEFORE({start_datetime}, "endDate")
         )
       )
     )
     ```
   - **⚠️ כשל:** אם `full_name` לא תקין → לא ימצא שיעורים

3. **Cancellations** - שורה 196-204
   - Filter:
     ```javascript
     AND(
       {student} = "studentRecordId",
       {billing_month} = "YYYY-MM"
     )
     ```
   - **⚠️ כשל:** דורש `billing_month` בביטול

4. **Subscriptions** - שורה 211-216
   - Filter: `{student_id} = "studentRecordId"`
   - **⚠️ כשל:** אם `student_id` לא תקין → לא ימצא מנויים

### 6.2 שלב 2: חישוב תרומות

**שורה 219-258:**

1. **Lessons Contribution** - שורה 219
   - קורא ל-`calculateLessonsContribution()`
   - **⚠️ כשל:** אם חסרים שדות → מחזיר `MissingFieldsError`

2. **Cancellations Contribution** - שורה 240
   - קורא ל-`calculateCancellationsContribution()`
   - דורש `getLinkedLesson()` - שורה 235-237
   - **⚠️ כשל:** אם חסרים שדות → מחזיר `MissingFieldsError`

3. **Subscriptions Contribution** - שורה 251
   - קורא ל-`calculateSubscriptionsContribution()`
   - **⚠️ כשל:** אם חסרים שדות → מחזיר `MissingFieldsError`

### 6.3 שלב 3: חישוב סה"כ

**שורה 261-269:**
```typescript
const total = calculateTotal(
  lessonsContribution.lessonsTotal,
  cancellationsResult.cancellationsTotal,
  subscriptionsResult.subscriptionsTotal
);
```

### 6.4 שלב 4: בדיקת נתונים לחיוב

**שורה 272-291:**
```typescript
const hasBillableLessons = lessonsContribution.lessonsCount > 0;
const hasBillableCancellations = cancellationsResult.cancellationsCount > 0;
const hasSubscriptions = subscriptionsResult.activeSubscriptionsCount > 0;
const hasAnyBillableData = hasBillableLessons || hasBillableCancellations || hasSubscriptions;

if (total === 0 && !hasAnyBillableData) {
  throw new DomainError('NO_BILLABLE_DATA', ...);
}
```

**⚠️ נקודת כשל:**
- אם אין נתונים לחיוב → דילוג (לא שגיאה)

### 6.5 שלב 5: בדיקת חיוב קיים

**שורה 294-306:**
```typescript
const billingFilter = `AND(
  {full_name} = "${studentRecordId}",
  {חודש חיוב} = "${billingMonth}"
)`;
matchingBills = await client.listRecords(billingTableId, { filterByFormula: billingFilter });
```

**שורה 309-316:**
```typescript
if (matchingBills.length > 1) {
  throw new DuplicateBillingRecordsError(...);
}
```

**⚠️ נקודת כשל:**
- אם יש יותר מחיוב אחד → `DUPLICATE_BILLING_RECORDS` Error

### 6.6 שלב 6: יצירה/עדכון רשומה

**שורה 354-372:**

**אם אין חיוב קיים:**
- `client.createRecord()` - שורה 356-361
- `created = true`

**אם יש חיוב קיים:**
- `client.updateRecord()` - שורה 366-371
- `created = false`

**שדות שנוצרים/מתעדכנים:**
```typescript
{
  'חודש חיוב': billingMonth,
  'שולם': isPaid,
  'מאושר לחיוב': status === 'approved' || status === 'paid',
  'full_name': [studentRecordId], // Linked record
  'lessons_amount': lessonsContribution.lessonsTotal,
  'subscriptions_amount': subscriptionsResult.subscriptionsTotal,
  'cancellations_amount': cancellationsResult.cancellationsTotal,
  'total_amount': total,
  'lessons_count': lessonsContribution.lessonsCount,
}
```

**⚠️ נקודות כשל:**
- אם שדה לא קיים בטבלה → Airtable API Error
- אם `studentRecordId` לא תקין → Airtable API Error
- אם יש בעיית הרשאות → 403 Forbidden

---

## 7. Billing Rules - חישובים

### קובץ: `billing/billingRules.ts`

### 7.1 Lessons Contribution

**פונקציה:** `calculateLessonsContribution()` - שורה 98

**לוגיקה:**
1. מסנן לפי `billing_month` - שורה 114
2. מדלג על ביטולים - שורה 119
3. מדלג על סטטוסים לא-חייבים - שורה 124
4. בודק שהשיעור שייך לתלמיד - שורה 129-132
5. מטפל בשיעורים מרובי-תלמידים - שורה 135-149
6. מסנן רק שיעורים פרטיים - שורה 152-154
7. מחשב סכום:
   - אם יש `line_amount` → משתמש בו
   - אחרת → 175 (ברירת מחדל)

**⚠️ נקודות כשל:**
- **🔴 בעיה קריטית:** אם `billing_month` לא מוגדר בשיעור → שיעור לא נכלל למרות שהפילטר ב-`billingEngine.ts` מביא אותו לפי תאריך!
  - **הסבר:** `billingEngine.ts` מביא שיעורים גם לפי `start_datetime` אם אין `billing_month`, אבל `calculateLessonsContribution` דוחה אותם אם אין `billing_month`
  - **תיקון נדרש:** צריך לבדוק גם לפי `start_datetime` אם `billing_month` לא מוגדר
- אם `lesson_type` לא מוגדר → לא יודע אם פרטי/זוגי/קבוצתי
- אם `status` לא מוגדר → לא יודע אם חייב
- אם `full_name` לא תקין → שיעור לא מקושר לתלמיד
- אם שיעור פרטי עם מספר תלמידים → `MissingFieldsError` (צריך כלל עסקי)

### 7.2 Cancellations Contribution

**פונקציה:** `calculateCancellationsContribution()` - שורה 203

**לוגיקה:**
1. מסנן לפי `billing_month` - שורה 220
2. מסנן רק `is_lt_24h === 1` - שורה 225
3. מדלג על `is_charged === false` (ממתין לאישור) - שורה 230-233
4. מחשב סכום:
   - אם יש `charge` מפורש → משתמש בו
   - אם יש שיעור מקושר → משתמש ב-`lesson_type`
   - אחרת → `null` → `MissingFieldsError`

**⚠️ נקודות כשל:**
- אם `billing_month` לא מוגדר → ביטול לא נכלל
- אם `is_lt_24h` לא מוגדר → לא יודע אם לחייב
- אם `is_charged` לא מוגדר → לא יודע אם כבר חויב
- אם אין `charge` ואין שיעור מקושר → `MissingFieldsError`

### 7.3 Subscriptions Contribution

**פונקציה:** `calculateSubscriptionsContribution()` - שורה 376

**לוגיקה:**
1. מסנן מנויים פעילים לחודש - שורה 383
   - לא מושהה (`pause_subscription !== true`)
   - תאריך התחלה לפני סוף החודש
   - תאריך סיום אחרי תחילת החודש (אם קיים)
2. בודק מנויים חופפים - שורה 389-412
   - אם יש מנויים חופפים → `MissingFieldsError` (צריך כלל עסקי)
3. מחשב סכום:
   - `parseMonthlyAmount(monthly_amount)` - שורה 416

**⚠️ נקודות כשל:**
- אם `pause_subscription` לא מוגדר → לא יודע אם מושהה
- אם `subscription_start_date` לא מוגדר → לא יודע מתי התחיל
- אם `monthly_amount` לא מוגדר → סכום = 0
- אם יש מנויים חופפים → `MissingFieldsError`

---

## 8. Airtable Client - גישה לנתונים

### קובץ: `services/airtableClient.ts`

**כל הקריאות ל-Airtable עוברות דרך:**
- `client.getRecord()` - קריאה לרשומה בודדת
- `client.listRecords()` - קריאה לרשומות עם פילטר
- `client.createRecord()` - יצירת רשומה חדשה
- `client.updateRecord()` - עדכון רשומה קיימת

**⚠️ נקודות כשל:**
- אם Table ID לא תקין → 404 Not Found
- אם אין הרשאות → 403 Forbidden
- אם שדה לא קיים → Airtable API Error
- אם פילטר לא תקין → Airtable API Error
- אם יש בעיית רשת → Network Error

---

## 9. סיכום נקודות כשל

### 9.1 כשלים ברמת נתונים

1. **שדות חסרים:**
   - `billing_month` בשיעורים/ביטולים
   - `lesson_type` בשיעורים
   - `status` בשיעורים
   - `full_name` בשיעורים (קישור לתלמיד)
   - `student` בביטולים (קישור לתלמיד)
   - `student_id` במנויים (קישור לתלמיד)
   - `monthly_amount` במנויים
   - `charge` בביטולים (או שיעור מקושר)

2. **קישורים לא תקינים:**
   - `full_name` בשיעור לא מצביע על תלמיד תקין
   - `student` בביטול לא מצביע על תלמיד תקין
   - `student_id` במנוי לא מצביע על תלמיד תקין
   - Record ID לא מתחיל ב-`rec`

3. **נתונים לא עקביים:**
   - שיעור פרטי עם מספר תלמידים (צריך כלל עסקי)
   - מנויים חופפים (צריך כלל עסקי)
   - חיובים כפולים (duplicates)

### 9.2 כשלים ברמת תהליך

1. **Validation Errors:**
   - `billingMonth` לא בפורמט YYYY-MM
   - `studentRecordId` לא בפורמט תקין

2. **Business Logic Errors:**
   - אין נתונים לחיוב → דילוג (לא שגיאה)
   - חיובים כפולים → Error

3. **API Errors:**
   - Airtable API לא זמין
   - הרשאות לא מספיקות
   - Table/Field לא קיים

### 9.3 כשלים ברמת ביצועים

1. **איסוף נתונים:**
   - מביא את כל השיעורים לחודש (יכול להיות כבד)
   - מביא את כל המנויים (ללא פילטר)
   - מביא את כל הביטולים לחודש

2. **עיבוד:**
   - עיבוד סדרתי של תלמידים (לא מקבילי)
   - אין retry mechanism
   - אין rate limiting

---

## 10. זרימת נתונים - דיאגרמה

```
UI (Billing.tsx)
  ↓
  handleCreateMonthlyCharges()
  ↓
data/mutations.ts
  ↓
  createMonthlyCharges()
  ↓
services/nexusApi.ts
  ↓
  nexusApi.createMonthlyCharges()
  ↓
services/billingService.ts
  ↓
  createMonthlyCharges()
  ↓
billing/billingEngine.ts
  ↓
  buildMonthForAllActiveStudents()
  ↓
  [1] Fetch Students (is_active = 1)
  ↓
  [2] Fetch Lessons (billing_month OR date range)
  ↓
  [3] Fetch Cancellations (billing_month)
  ↓
  [4] Fetch Subscriptions (all)
  ↓
  [5] Fetch Existing Bills (חודש חיוב)
  ↓
  [6] Group by Student
  ↓
  For each Student:
    ↓
    buildStudentMonth()
      ↓
      [7] Fetch Student Record
      ↓
      [8] Fetch Student Lessons
      ↓
      [9] Fetch Student Cancellations
      ↓
      [10] Fetch Student Subscriptions
      ↓
      [11] Calculate Lessons Contribution
        ↓ billing/billingRules.ts
        ↓ calculateLessonsContribution()
      ↓
      [12] Calculate Cancellations Contribution
        ↓ billing/billingRules.ts
        ↓ calculateCancellationsContribution()
      ↓
      [13] Calculate Subscriptions Contribution
        ↓ billing/billingRules.ts
        ↓ calculateSubscriptionsContribution()
      ↓
      [14] Calculate Total
      ↓
      [15] Check Existing Bill
      ↓
      [16] Create/Update Bill Record
        ↓ services/airtableClient.ts
        ↓ Airtable API
      ↓
      Return Result
  ↓
  Aggregate Results
  ↓
  Return Summary
```

---

## 11. טבלאות ושדות קריטיים

### 11.1 טבלת Students
- **Table ID:** `students` (מ-config)
- **שדות נדרשים:**
  - `full_name` - שם התלמיד
  - `is_active` - האם פעיל (checkbox)

### 11.2 טבלת Lessons
- **Table ID:** `lessons` (מ-config)
- **שדות נדרשים:**
  - `full_name` - קישור לתלמיד (linked record)
  - `billing_month` - חודש חיוב (string, YYYY-MM)
  - `start_datetime` - תאריך ושעה התחלה (datetime)
  - `lesson_type` - סוג שיעור (single select: פרטי/זוגי/קבוצתי)
  - `status` - סטטוס (single select: מתוכנן/הסתיים/בוטל/...)
  - `line_amount` - סכום לחיוב (number, אופציונלי)

### 11.3 טבלת Cancellations
- **Table ID:** `cancellations` (מ-config)
- **שדות נדרשים:**
  - `student` - קישור לתלמיד (linked record)
  - `billing_month` - חודש חיוב (string, YYYY-MM)
  - `is_lt_24h` - ביטול פחות מ-24 שעות (number: 1/0)
  - `is_charged` - האם חויב (checkbox)
  - `charge` - סכום חיוב (number, אופציונלי)
  - `lesson` - קישור לשיעור (linked record, אופציונלי)

### 11.4 טבלת Subscriptions
- **Table ID:** `subscriptions` (מ-config)
- **שדות נדרשים:**
  - `student_id` - קישור לתלמיד (linked record)
  - `subscription_start_date` - תאריך התחלה (date)
  - `subscription_end_date` - תאריך סיום (date, אופציונלי)
  - `pause_subscription` - האם מושהה (checkbox)
  - `monthly_amount` - סכום חודשי (number/string)

### 11.5 טבלת Monthly Bills (חיובים)
- **Table ID:** `monthlyBills` (מ-config)
- **שדות נדרשים:**
  - `full_name` - קישור לתלמיד (linked record)
  - `חודש חיוב` - חודש חיוב (**Date או Text**, YYYY-MM או YYYY-MM-01)
    - **⚠️ חשוב:** השדה יכול להיות Date או Text
    - אם Date: שולחים YYYY-MM-01 (יום ראשון של החודש)
    - אם Text: שולחים YYYY-MM
    - הפילטרים תומכים בשניהם אוטומטית
  - `שולם` - האם שולם (checkbox)
  - `מאושר לחיוב` - האם מאושר (checkbox)
  - `lessons_amount` - סכום שיעורים (number)
  - `subscriptions_amount` - סכום מנויים (number)
  - `cancellations_amount` - סכום ביטולים (number)
  - `total_amount` - סה"כ (number)
  - `lessons_count` - מספר שיעורים (number)

---

## 12. המלצות לתיקון

### 12.1 שדות חסרים
1. **וודא שכל השיעורים יש להם `billing_month`:**
   - אם לא קיים, השתמש ב-`start_datetime` לחישוב

2. **וודא שכל הביטולים יש להם `billing_month`:**
   - חובה - אחרת לא ימצאו

3. **וודא שכל השיעורים יש להם `lesson_type`:**
   - חובה - אחרת לא יודע אם לחייב

4. **וודא שכל השיעורים יש להם `status`:**
   - חובה - אחרת לא יודע אם לחייב

### 12.2 קישורים לא תקינים
1. **וודא ש-`full_name` בשיעורים מצביע על תלמיד תקין**
2. **וודא ש-`student` בביטולים מצביע על תלמיד תקין**
3. **וודא ש-`student_id` במנויים מצביע על תלמיד תקין**

### 12.3 כללים עסקיים חסרים
1. **שיעור פרטי עם מספר תלמידים:**
   - החלט: חלוקה שווה / חיוב לכל תלמיד / אסור

2. **מנויים חופפים:**
   - החלט: סכימה / מקסימום / עדיפות לפי סוג

### 12.4 שיפורי ביצועים
1. **הוסף retry mechanism** לקריאות Airtable
2. **הוסף rate limiting** למניעת הגבלות API
3. **שקול עיבוד מקבילי** של תלמידים (בזהירות עם rate limits)

### 12.5 תיקון פורמט חודש חיוב (Date vs Text)
**בעיה:** השדה `חודש חיוב` מוגדר כ-Date ב-Airtable, אבל הקוד מצפה ל-Text (YYYY-MM)

**פתרון מיושם:**
1. **פונקציה עזר:** `buildBillingMonthFilter()` - יוצרת פילטר שתומך בשניהם
2. **פונקציה עזר:** `convertBillingMonthToAirtableValue()` - ממירה YYYY-MM לערך מתאים
3. **פילטרים מעודכנים:** כל הפילטרים תומכים בשניהם:
   - Date: `YEAR({field}) = YYYY AND MONTH({field}) = MM`
   - Date range: `IS_AFTER({field}, "YYYY-MM-01") AND IS_BEFORE({field}, "YYYY-MM-lastDay")`
   - Text: `{field} = "YYYY-MM"` או `FIND("YYYY-MM", STR({field})) = 1`
4. **יצירה/עדכון:** שולח YYYY-MM-01 (יום ראשון של החודש) עבור Date fields

**קבצים שעודכנו:**
- `billing/billingEngine.ts` - פילטרים ויצירה/עדכון
- `services/billingService.ts` - פילטרים ב-getChargesReport ו-getChargesReportKPIs

---

## 13. לוגים ודיבוג

### נקודות לוג קריטיות:
1. `[BillingEngine] Starting bulk build` - תחילת תהליך
2. `[BillingEngine] Data fetched` - סיום איסוף נתונים
3. `[BillingEngine] Processing X/Y` - התקדמות עיבוד
4. `[BillingEngine] Calculation for studentId` - חישוב לתלמיד
5. `[createMonthlyCharges] Starting billing creation` - תחילת יצירה
6. `[createMonthlyCharges] Failed to create charges` - כשל

### איך לדבג:
1. פתח Console בדפדפן
2. חפש הודעות שמתחילות ב-`[BillingEngine]`
3. בדוק שגיאות Airtable API
4. בדוק MissingFieldsErrors
5. בדוק DomainErrors

---

## 14. בעיה קריטית שזוהתה - תלמידים ללא מנוי לא מקבלים חיובים

### 14.1 תיאור הבעיה
המערכת יוצרת חיובים רק לתלמידים עם מנוי, ולא מתחשבת בתלמידים ללא מנוי שיש להם שיעורים לחיוב.

### 14.2 שורש הבעיה
**מיקום:** `billing/billingRules.ts` - פונקציה `calculateLessonsContribution()` שורה 114

**הבעיה:**
1. `billingEngine.ts` מביא שיעורים גם לפי תאריך (`start_datetime`) אם אין להם `billing_month`:
   ```typescript
   OR(
     {billing_month} = "${billingMonth}",
     AND(
       IS_AFTER({start_datetime}, "${startDateStr}"),
       IS_BEFORE({start_datetime}, "${endDateStr}T23:59:59")
     )
   )
   ```

2. אבל `calculateLessonsContribution` דוחה שיעורים אם אין להם `billing_month`:
   ```typescript
   if (lesson.billing_month !== billingMonth) {
     continue; // שיעור נדחה למרות שהוא בחודש הנכון לפי תאריך!
   }
   ```

**תוצאה:** תלמידים ללא מנוי שיש להם שיעורים ללא `billing_month` (אבל עם `start_datetime` בחודש הנכון) לא מקבלים חיובים.

### 14.3 פתרון מיושם ✅
**תוקן ב:** `billing/billingRules.ts` - פונקציה `calculateLessonsContribution()` שורות 112-137

**מה תוקן:**
1. הוספת חישוב טווח תאריכים לחודש החיוב
2. שינוי הלוגיקה לבדוק גם לפי `start_datetime` אם `billing_month` לא מוגדר:
   ```typescript
   // First check billing_month field, then fallback to start_datetime
   if (lesson.billing_month === billingMonth) {
     belongsToMonth = true;
   } else if (!lesson.billing_month && lesson.start_datetime) {
     // billing_month not set, check by start_datetime
     const lessonDate = new Date(lesson.start_datetime);
     if (lessonDate >= startDate && lessonDate <= endDate) {
       belongsToMonth = true;
     }
   }
   ```

**תוצאה:** עכשיו תלמידים ללא מנוי שיש להם שיעורים פרטיים לחודש (גם אם אין להם `billing_month` אבל יש `start_datetime` בחודש הנכון) יקבלו חיובים.

---

## סיכום

מודל יצירת החיובים הוא תהליך מורכב עם מספר רב של נקודות כניסה לנתונים. הכשלים העיקריים הם:
1. **🔴 בעיה קריטית:** שיעורים ללא `billing_month` נדחים למרות שהם בחודש הנכון לפי תאריך
2. שדות חסרים בטבלאות
3. קישורים לא תקינים בין טבלאות
4. כללים עסקיים לא מוגדרים
5. בעיות הרשאות/גישה ל-Airtable

התהליך עובד בסדר הבא:
1. UI → Mutations → Nexus API → Billing Service
2. Billing Service → Billing Engine
3. Billing Engine → איסוף נתונים → עיבוד → יצירה/עדכון
4. Billing Rules → חישובים

כל שלב יכול להיכשל, והשגיאות מועברות חזרה ל-UI להצגה למשתמש.
