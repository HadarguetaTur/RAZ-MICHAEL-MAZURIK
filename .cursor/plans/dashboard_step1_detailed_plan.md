# תוכנית מפורטת – שלב 1: דאשבורד מודולים 1–5

מסמך זה מפרט משימות, קבצים וסדר ביצוע לשדרוג הדאשבורד לפי מודולים 1–5 (פיננסי, תלמידים, שיעורים/תפוסה, ביטולים, מורים) **בלי טבלאות חדשות ב-Airtable**.

---

## 1. מודול פיננסי (סקירה פיננסית)

### 1.1 מה כבר קיים
- **מקור**: `getChargesReportKPIs` ו-`getChargesReport` ב-[services/billingService.ts](services/billingService.ts); `nexusApi.getBillingKPIs(month)`, `getMonthlyBills(month)`.
- **שדות חיובים**: `total_amount`, `lessons_amount`, `subscriptions_amount`, `שולם`, `מאושר לחיוב`, `חודש חיוב` – כולם ב-[contracts/fieldMap.ts](contracts/fieldMap.ts) (monthlyBills).
- **Dashboard**: כבר מציג סכום פתוח, שולם החודש, ממתינים לשליחה, חובות בפיגור.

### 1.2 משימות
| # | משימה | קובץ/מקום | הערות |
|---|--------|-----------|--------|
| 1.1 | להוסיף ל־ChargesReportKPIs (או ל־Dashboard metrics) סיכום **התפלגות**: סה"כ הכנסות ממנויים vs משיעורים לחודש נוכחי | [services/billingService.ts](services/billingService.ts) (getChargesReportKPIs סוכם כבר totalLessonsAmount, totalSubscriptionsAmount) | אם ה-KPIs כבר מחזירים את זה – לחשוף ב-hook ולהוסיף כרטיס/טקסט בדאשבורד. |
| 1.2 | להציג בדאשבורד כרטיס או שורה: "הכנסות החודש" = סה"כ (totalToBill או SUM(total_amount)), "ממנויים" = totalSubscriptionsAmount, "משיעורים" = totalLessonsAmount | [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts), [components/Dashboard.tsx](components/Dashboard.tsx) | להרחיב `DashboardMetrics.billing` ב-`lessonsAmount`, `subscriptionsAmount` אם לא קיים. |
| 1.3 | "חובות (טרם שולם)" – כבר קיים כ־openAmount / overdue; לוודא שהמספר תואם ל־`{שולם}=FALSE()` + `{מאושר לחיוב}=TRUE()` | אין שינוי נדרש אם הלוגיקה הנוכחית תואמת. | אופציונלי: טקסט עזר "טרם שולם (מאושרים)" אם רוצים להבדיל מטיוטה. |

### 1.3 קבצים לעדכן
- [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts) – לחשוף `billingKpis.totalLessonsAmount`, `totalSubscriptionsAmount` ב-metrics.
- [components/Dashboard.tsx](components/Dashboard.tsx) – בלוק "מצב כספים" או שורת KPIs: להוסיף התפלגות (מנויים / שיעורים) אם לא מוצג.

---

## 2. מודול תלמידים (ניהול תלמידים)

### 2.1 מה כבר קיים
- **מקור**: `useStudents` ([hooks/useStudents.ts](hooks/useStudents.ts)) ← `getStudents` / `getAllStudents` ([data/resources/students.ts](data/resources/students.ts)) ← nexusApi.
- **מיפוי**: [nexusApi mapAirtableToStudent](services/nexusApi.ts) – מחזיר `grade` (grade_level), `subjectFocus` (subject_focus), `status` (מ-is_active). **חסר במפה**: `מנוי בקתה`, `מנוי קבוצתי`, `eligibility_this_week`, `eligibility_next_week`.

### 2.2 משימות
| # | משימה | קובץ/מקום | הערות |
|---|--------|-----------|--------|
| 2.1 | **תלמידים פעילים / מנויי בקתה / מנויים קבוצתיים**: אם השדות מנוי בקתה ומנוי קבוצתי לא ממופים – להוסיף ל־Student (אופציונלי) או לשלוף בדאשבורד עם `fields` מורחבים ולספור בצד שרת/לקוח. | [services/nexusApi.ts](services/nexusApi.ts) (mapAirtableToStudent), [types.ts](types.ts) (Student) | fieldMap: `מנוי_בקתה` = "מנוי בקתה", `מנוי_קבוצתי` = "מנוי קבוצתי". |
| 2.2 | **התפלגות לפי כיתה**: מתוך רשימת התלמידים (פעילים) – group by `grade` (student.grade), להציג תרשים או רשימה. | [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts), [components/Dashboard.tsx](components/Dashboard.tsx) | חישוב ב-useMemo מ־students. |
| 2.3 | **התפלגות לפי מקצוע**: `subjectFocus` יכול להיות מערך (Multi-select) – לפרק לערכים בודדים ולספור. | אותו hook + Dashboard | פונקציית עזר: flattenSubjectFocus(subjectFocus) → string[]. |
| 2.4 | **זכאות השבוע**: ספירת "זכאי" ב־eligibility_this_week / eligibility_next_week – דורש שליפה עם השדות האלה. אם לא ממופים ב-Student – להוסיף שליפה ייעודית (למשל getStudents עם fields כולל eligibility) או endpoint דאשבורד שמחזיר רק את הספירות. | [contracts/fieldMap.ts](contracts/fieldMap.ts) (שדות קיימים), nexusApi / resource students | עדיפות נמוכה אם לא קל – אפשר לדחות לשלב 2. |

### 2.3 קבצים לעדכן
- [types.ts](types.ts) – אופציונלי: `subscriptionBeehive?: boolean`, `subscriptionGroup?: boolean`, `eligibilityThisWeek?: string`, `eligibilityNextWeek?: string`.
- [services/nexusApi.ts](services/nexusApi.ts) – mapAirtableToStudent: לקרוא "מנוי בקתה", "מנוי קבוצתי", eligibility_this_week, eligibility_next_week אם רוצים הכל ב-Student.
- [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts) – להוסיף למטריקות: `studentsByGrade: Record<string, number>`, `studentsBySubject: Record<string, number>`, `eligibilityThisWeekCount`, `eligibilityNextWeekCount` (אם יש נתון).
- [components/Dashboard.tsx](components/Dashboard.tsx) – סעיף "תלמידים": כרטיסי סיכום + (אופציונלי) גרף/רשימת התפלגות כיתה ומקצוע.

---

## 3. מודול שיעורים ותפוסה

### 3.1 מה כבר קיים
- **שיעורים**: `useLessons` עם טווח תאריכים; `currentWeekLessons`, `prevWeekLessons`, `lessonsTodayData` – כבר ב-useDashboardData. סטטוסים: "הסתיים"/"בוצע", "מתוכנן", "בוטל" ממופים.
- **תפוסת סלוטים**: `nexusApi.getSlotInventory(start, end)` ו-[data/resources/slotInventory.ts](data/resources/slotInventory.ts) – מחזיר SlotInventory[] עם `status` (open/closed/occupied וכו').

### 3.2 משימות
| # | משימה | קובץ/מקום | הערות |
|---|--------|-----------|--------|
| 3.1 | **סטטיסטיקת שיעורים (מתוכנן/בוצע/בוטל)**: לחשב מ־currentWeekLessons (או מטווח רחב יותר) ספירות לפי status. להציג כ־KPI או תרשים. | [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts), [components/Dashboard.tsx](components/Dashboard.tsx) | לתמוך גם ב-"בוצע" וגם ב-"הסתיים" לספירת הושלמו. |
| 3.2 | **שיעורים השבוע**: כבר יש weeklyVolume (לפי יום). לוודא שהטווח "שבוע נוכחי" תואם להגדרת מארטייבל (business week). אופציונלי: אם ב-Airtable יש שדה `is_in_current_business_week` – לבדוק אם עדיף פילטר לפייו במקום טווח תאריכים. | [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts) | כרגע שבוע = Sun–Sat; אם business week שונה – לתעד או להתאים. |
| 3.3 | **תפוסת סלוטים**: שליפה של slot_inventory מ־TODAY() והלאה (או טווח 7/14 ימים). חישוב: פתוח = status open, תפוס/סגור = closed/occupied; אחוז תפוסה = (תפוסים / סה"כ) * 100. | [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts) – שלב חדש: useSlotInventory או קריאה ל־getSlotInventory; חישוב ב-useMemo. [data/resources/slotInventory.ts](data/resources/slotInventory.ts) כבר עם getSlotInventory(range). | להוסיף טווח "היום" (למשל 14 ימים) ולספור לפי status. |
| 3.4 | **תפוסה לפי סוג שיעור**: סיכום לפי lessonType (פרטי/זוגי/קבוצתי) – אם SlotInventory מחזיר lessonType; אחרת לספור רק סה"כ. | Dashboard + hook | fieldMap slotInventory: סוג_שיעור. |

### 3.3 קבצים לעדכן
- [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts) – להוסיף: (א) ספירות lessons by status (מתוכנן, בוצע, בוטל); (ב) שליפה getSlotInventory(today, today+14d) וחישוב תפוסה + אחוז; (ג) אופציונלי: תפוסה לפי סוג שיעור.
- [components/Dashboard.tsx](components/Dashboard.tsx) – בלוק "שיעורים ותפוסה": כרטיסים (שיעורים מתוכננים / בוצעו / בוטלו), סלוטים פתוחים/תפוסים, אחוז תפוסה; אופציונלי: טבלה/גרף לפי סוג שיעור.

---

## 4. מודול ביטולים

### 4.1 מה כבר קיים
- **טבלה**: cancellations (tblr0UIVvJr85vEfL). שדות: cancellation_date, is_lt_24h, is_charged, charge – ב-fieldMap.
- **שימוש קיים**: billingEnrichment, billingDetailsService – שולפים ביטולים לפי חודש/תלמיד. **אין** endpoint או hook לדאשבורד שמחזיר KPIs ביטולים (סה"כ החודש, מאוחרים, הכנסות).

### 4.2 משימות
| # | משימה | קובץ/מקום | הערות |
|---|--------|-----------|--------|
| 4.1 | **API / פונקציה**: שליפת רשומות cancellations עם filterByFormula: חודש נוכחי (למשל `IS_SAME({cancellation_date}, TODAY(), 'month')` או YEAR/MONTH כמו בחיובים). שדות: cancellation_date, is_lt_24h, is_charged, charge. | שירות חדש או פונקציה ב-[services/billingService.ts](services/billingService.ts) או [services/nexusApi.ts](services/nexusApi.ts) | להחזיר רשימה או אובייקט מסוג CancellationsKPIs. |
| 4.2 | **חישוב KPIs**: סה"כ ביטולים החודש, ביטולים מאוחרים (is_lt_24h=1), שיעור מאוחרים (%), סה"כ הכנסות מביטולים (SUM(charge) WHERE is_charged=TRUE). | אותה פונקציה או useDashboardData | טיפוס: `{ totalCancellations, lateCancellations, latePercent, revenueFromLate }`. |
| 4.3 | **Cache**: להוסיף resource עם cache (למשל data/resources/cancellations.ts) או לקרוא מתוך useDashboardData עם TTL סביר. | [data/resources/](data/resources/) או [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts) | להפחית קריאות Airtable. |
| 4.4 | **UI**: כרטיסים בדאשבורד – "ביטולים החודש", "ביטולים מאוחרים (<24h)", "שיעור מאוחרים", "הכנסות מביטולים מאוחרים". | [components/Dashboard.tsx](components/Dashboard.tsx) | |

### 4.3 קבצים לעדכן
- **חדש או הרחבה**: פונקציה `getCancellationsKPIs(month: string)` – ב-nexusApi או ב-billingService (לוגית יותר ב-service ייעודי או nexusApi). להשתמש ב-getTableId('cancellations'), getField('cancellations', …).
- [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts) – לקרוא ל-getCancellationsKPIs(currentMonthStr), להוסיף ל-metrics: `cancellations: { total, late, latePercent, revenueFromLate }`.
- [components/Dashboard.tsx](components/Dashboard.tsx) – סעיף "ביטולים": 4 כרטיסים או שורת מספרים.

---

## 5. מודול מורים

### 5.1 מה כבר קיים
- **שיעורים למורה**: יש teacherId ב-Lesson; אפשר לקבץ currentWeekLessons (או טווח רחב) לפי teacherId.
- **סלוטים לפי מורה**: slot_inventory עם שדה "מורה" (Linked Record); getSlotInventory מחזיר teacherId – אפשר לקבץ לפי teacher.
- **תלמידים למורה**: אין שדה "מורים" בטבלת תלמידים – נגזר משיעורים: איחוד תלמידים (studentId) לכל teacherId.

### 5.2 משימות
| # | משימה | קובץ/מקום | הערות |
|---|--------|-----------|--------|
| 5.1 | **שיעורים למורה**: מתוך currentWeekLessons (או כל השיעורים בשבוע/חודש) – group by teacherId; להציג רשימה או תרשים (מורה → מספר שיעורים). | [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts), [components/Dashboard.tsx](components/Dashboard.tsx) | teacherName מגיע מ-Lesson; אם חסר – למפות מ-teachers. |
| 5.2 | **סלוטים לפי מורה**: מתוך slot inventory (טווח מההיום) – group by teacherId; להציג סלוטים פתוחים/תפוסים למורה. | אותו hook (נתוני תפוסה כבר יישלפו למודול 3) | שימוש חוזר בנתוני getSlotInventory. |
| 5.3 | **תלמידים למורה**: מתוך lessons בטווח (למשל 30 יום) – איסוף זוגות (teacherId, studentId); ספירת תלמידים ייחודיים למורה. | useDashboardData או שליפה נפרדת של שיעורים | יש להחליט טווח (שבוע/חודש). |

### 5.3 קבצים לעדכן
- [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts) – להוסיף: `teachers: { lessonsByTeacher: { [teacherId]: number }, slotsByTeacher: { [teacherId]: { open, occupied } }, studentsByTeacher: { [teacherId]: number } }`. חישוב מ-lessons + slot inventory שכבר נטענים.
- [components/Dashboard.tsx](components/Dashboard.tsx) – בלוק "מורים": טבלה או כרטיסים – מורה, מספר שיעורים, סלוטים פתוחים/תפוסים, מספר תלמידים.

---

## 6. סדר ביצוע מומלץ

1. **מודול 4 (ביטולים)** – הוספת getCancellationsKPIs + חיבור ל-hook ו-UI. תלות מינימלית; מגדיר תבנית ל-KPIs נוספים.
2. **מודול 1 (פיננסי)** – הרחבת תצוגת התפלגות במצב כספים (אם חסר).
3. **מודול 3 (שיעורים + תפוסה)** – שליפת slot inventory בדאשבורד, חישוב תפוסה וסטטיסטיקות שיעורים; עדכון UI.
4. **מודול 2 (תלמידים)** – התפלגות כיתה/מקצוע; אופציונלי: הרחבת מיפוי מנוי בקתה/קבוצתי וזכאות.
5. **מודול 5 (מורים)** – חישובי אגרגציה מנתוני שיעורים וסלוטים; טבלת מורים בדאשבורד.

---

## 7. סיכום קבצים מרכזיים

| קובץ | שינויים עיקריים |
|------|------------------|
| [data/hooks/useDashboardData.ts](data/hooks/useDashboardData.ts) | הרחבת metrics (ביטולים, תפוסה, שיעורים לפי סטטוס, תלמידים לפי כיתה/מקצוע, מורים); שליפת slot inventory ו-cancellations KPIs. |
| [components/Dashboard.tsx](components/Dashboard.tsx) | סעיפים חדשים: פיננסי (התפלגות), תלמידים (התפלגות), שיעורים ותפוסה, ביטולים, מורים. |
| [services/nexusApi.ts](services/nexusApi.ts) או שירות חדש | getCancellationsKPIs(month). אופציונלי: הרחבת mapAirtableToStudent (מנוי בקתה, קבוצתי, eligibility). |
| [data/resources/cancellations.ts](data/resources/) (חדש, אופציונלי) | getCancellationsKPIs עם cache. |
| [types.ts](types.ts) | אופציונלי: שדות חדשים ב-Student; טיפוס CancellationsKPIs. |

---

## 8. דברים שלא כלולים בשלב 1

- מודול 6 (בחינות), 7 (רשימת המתנה) – דורשים הוספת טבלאות ל-config ו-API.
- מודול 8 (טרנדים 12 חודשים) – הרחבת טווח + caching.
- מודול 9 (תיבת מנהל, שגיאות) – אין טבלאות.
- "תחזית לחודש הבא" בדאשבורד – כרגע hardcoded (₪16,200); לא חלק משלב 1.

אם תרצי, אפשר להתחיל במשימה בודדת (למשל רק ביטולים או רק תפוסה) ולפרט בה צעד-אחר-צעד.
