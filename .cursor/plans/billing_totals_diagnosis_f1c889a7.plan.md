---
name: Billing totals diagnosis
overview: "הקוד אמור לקחת סכומים רק מטבלת 'חיובים' — בלי חישוב. אבחון: וידוא שהתצוגה/PDF קוראים רק מטבלת חיובים, ומציאת הסיבה שרשומת החיוב נשמרת עם ערכים שגויים (כתיבה במנוע החיובים)."
todos: []
isProject: false
---

# תוכנית: אבחון חיובים — סכומים רק מטבלת "חיובים"

## עקרון

**הקוד לא אמור לחשב סכומים בעצמו — כל הסה"כים (סה"כ שיעורים, סה"כ לתשלום) אמורים לבוא רק מטבלת "חיובים" (Airtable).**

אם מוצגים ערכים "לא הגיוניים" (למשל סה"כ שיעורים 462.5 וסה"כ לתשלום 700 בעוד פירוט השיעורים מסתכם ב-1,045), יש שתי אפשרויות:

1. **התצוגה/PDF קוראים מהמקום הלא נכון** — מציגים ערך מחושב או משדה אחר במקום מטבלת החיובים.  
2. **טבלת החיובים עצמה מכילה ערכים שגויים** — הכתיבה ל"חיובים" (בעת יצירת חיובים או עדכון) שומרת 462.5 / 700 instead of the correct amounts.

## סיכום הבעיה (מהמשתמש)

- **פירוט השיעורים**: נכון (7 שיעורים עם סכומים שסכומם 1,045).
- **סה"כ שיעורים / סה"כ לתשלום**: לא הגיוניים (462.5 / 700) — אמורים להיות מה ששמור בטבלת "חיובים".

## מה לבדוק ולתקן

### 1. וידוא: תצוגה ו-PDF קוראים **רק** מטבלת "חיובים"

- **ממשק ([Billing.tsx](components/Billing.tsx))**  
  - סיכום (סה"כ שיעורים, סה"כ לתשלום) — חייב להציג **רק** `selectedBill.lessonsAmount` ו-`selectedBill.totalAmount` (שמגיעים מ-getChargesReport → טבלת חיובים).  
  - **שורת "סה"כ שיעורים" מתחת לטבלת הפירוט** (882–884): כרגע מוצג `billingDetails.totals.lessonsTotal` (חישוב מ-getBillingBreakdown). אם העקרון הוא "רק מטבלת חיובים" — יש להציג כאן את `selectedBill.lessonsAmount` (מטבלת חיובים), לא חישוב מהפירוט.
- **PDF**  
  - ב-[Billing.tsx](components/Billing.tsx) (348–356) מועבר ל-PDF: `totals.lessonsTotal` ו-`grandTotal`. כדי שיהיו **רק מטבלת חיובים** — להעביר תמיד `selectedBill.lessonsAmount` ו-`selectedBill.totalAmount` (בלי fallback ל-`billingDetails.totals.lessonsTotal` או חישוב אחר).
- **סיכום**: להסיר כל שימוש בסכומים **מחושבים** (מ-breakdown) להצגת סה"כ שיעורים / סה"כ לתשלום; להשאיר רק קריאה מטבלת החיובים (selectedBill / Charge report).

### 2. סיבת הערכים השגויים בטבלת "חיובים"

אם אחרי סעיף 1 ברור שהתצוגה **כבר** קוראת מטבלת החיובים ועדיין רואים 462.5 / 700 — אז **הערכים השגויים שמורים ברשומת החיוב**. במקרה כזה:

- **מקור הכתיבה** ל"חיובים" הוא מנוע החיובים ביצירת חיובים: [billing/billingEngine.ts](billing/billingEngine.ts) — כותב `lessons_amount`, `total_amount` וכו'.
- **אבחון**: להשוות איך המנוע בוחר שיעורים ומחשב סכום (פילטר שיעורים, שדה `line_amount` / מחיר) מול מה שמראה הפירוט "הנכון" (למשל getBillingBreakdown או טבלת שיעורים ב-Airtable). אם המנוע כותב לפי סט שיעורים אחר או לוגיקה שונה — לתקן את המנוע כך שיכתוב לטבלת "חיובים" סכומים שתואמים לפירוט (או שמקור האמת הוא אכן טבלת "חיובים" ואז יש להבין מי אמור לעדכן אותה — מנוע, נוסחאות, או עדכון ידני).

### 3. Lookup / שדות ב"חיובים"

- לוודא ש-getChargesReport ו-nexusApi.getMonthlyBills קוראים את `lessons_amount` ו-`total_amount` (או lookup כמו "כולל מע\"מ ומנויים (from תלמיד)") **מהרשומה בטבלת חיובים** ולא משדה מחושב במקום אחר.  
- אם יש lookup מתלמיד — לבדוק אם הערך 700 מגיע משם ויכול להסביר אי-התאמה (למשל נוסחה/שדה בתלמיד שמוזן ידנית).

## זרימת נתונים (מתאימה לעקרון "רק מטבלת חיובים")

```mermaid
flowchart LR
  subgraph write [כתיבה ל"חיובים"]
    Engine[billingEngine / יצירת חיובים]
    Engine --> AirtableCharges[טבלת חיובים - lessons_amount, total_amount]
  end
  subgraph read [קריאה לתצוגה / PDF]
    getCharges[getChargesReport]
    AirtableCharges --> getCharges
    getCharges --> selectedBill[selectedBill.lessonsAmount, totalAmount]
    selectedBill --> UI[ממשק - סה"כ שיעורים, סה"כ לתשלום]
    selectedBill --> PDF[PDF - סה"כ שיעורים, סה"כ לתשלום]
  end
  subgraph detail [פירוט להצגה בלבד]
    Breakdown[getBillingBreakdown - טבלת שיעורים]
    Breakdown --> UI
    Breakdown --> PDF
  end
```

- **סה"כים**: רק מ-selectedBill (טבלת חיובים).  
- **פירוט שיעורים**: יכול להישאר מ-breakdown (טבלת שיעורים) להצגה, אבל **לא** לשמש כבסיס לחישוב סה"כ בתצוגה או ב-PDF.

## סדר ביצוע מוצע

1. **תיקון תצוגה ו-PDF**: לוודא שכל מקום שמציג "סה"כ שיעורים" או "סה"כ לתשלום" משתמש **רק** ב-`selectedBill.lessonsAmount` ו-`selectedBill.totalAmount` (מטבלת חיובים), כולל שורת הסה"כ מתחת לטבלת הפירוט וב-PDF — ולהסיר fallback לחישוב מ-breakdown.
2. **אבחון כתיבה**: אם לאחר מכן עדיין מופיעים ערכים לא הגיוניים — הבעיה ברשומה ב"חיובים". לבדוק את מנוע החיובים (פילטר שיעורים, שדות, לוגיקה) ו/או מקורות נוספים (lookup, נוסחאות) שמזינים את טבלת "חיובים".

## קבצים מרכזיים

- [components/Billing.tsx](components/Billing.tsx) – תצוגת סיכום (סה"כ שיעורים / סה"כ לתשלום), שורת סה"כ מתחת לפירוט, ובניית אובייקט ל-PDF. יש לוודא שכל הסכומים מגיעים מ-selectedBill (טבלת חיובים).
- [services/pdfGenerator.ts](services/pdfGenerator.ts) – הצגת סה"כ ב-PDF; לקבל טוטלים מטבלת חיובים בלבד.
- [services/billingService.ts](services/billingService.ts) – getChargesReport (קריאה מטבלת "חיובים"), מיפוי שדות.
- [billing/billingEngine.ts](billing/billingEngine.ts) – כתיבה ל"חיובים" ביצירת חיובים; אם הרשומה נשמרת עם ערכים שגויים — לאבחן ולתקן כאן.
- [billing/billingRules.ts](billing/billingRules.ts) – לוגיקת חישוב סכום שיעור (משמשת רק את מנוע החיובים בכתיבה ל-Airtable).