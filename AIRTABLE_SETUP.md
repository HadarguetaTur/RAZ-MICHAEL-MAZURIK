# Airtable Integration Setup

This app is now configured to connect to Airtable for fetching Lessons and Students data.

## Setup Instructions

### 1. Create `.env.local` file

Create a `.env.local` file in the root directory with the following content:

```env
# Airtable Configuration
# Note: Vite requires the VITE_ prefix for client-side environment variables
VITE_AIRTABLE_API_KEY=your_airtable_api_key_here
VITE_AIRTABLE_BASE_ID=your_airtable_base_id_here
```

**Important**: Vite only exposes environment variables prefixed with `VITE_` to the client-side code. Make sure to use the `VITE_` prefix!

### 2. Get Your Airtable API Key

1. Go to https://airtable.com/create/tokens
2. Create a new personal access token
3. Give it a name (e.g., "Nexus Lessons Admin")
4. Grant access to your base
5. Copy the token and paste it as `VITE_AIRTABLE_API_KEY`

### 3. Get Your Base ID

1. Go to https://airtable.com/api
2. Select your base
3. The Base ID is in the URL: `https://api.airtable.com/v0/{BASE_ID}/...`
4. Copy the Base ID and paste it as `VITE_AIRTABLE_BASE_ID`

### 4. Airtable Table Structure

Your Airtable base should have the following tables:

#### **Lessons** Table
Required fields:
- `Date` (Date field) - Maps to `lesson.date`
- `Start Time` (Single line text or Time field) - Maps to `lesson.startTime`
- `Status` (Single select) - Maps to `lesson.status` (values: מתוכנן, הסתיים, בוטל, ממתין, לא הופיע, ממתין לאישור ביטול)
- `Student_Name` or `Student_Link` (Linked record or Text) - Maps to `lesson.studentName`
- `Teacher_Name` or `Teacher_Link` (Linked record or Text) - Maps to `lesson.teacherName`

Optional fields:
- `Duration` (Number) - Defaults to 60 if not provided
- `Subject` (Text) - Defaults to "מתמטיקה" if not provided
- `Is_Chargeable` (Checkbox)
- `Charge_Reason` (Text)
- `Is_Private` (Checkbox)
- `Lesson_Type` (Single select: private, pair, group, recurring)
- `Notes` (Long text)
- `Payment_Status` (Single select: paid, unpaid, partial)
- `Attendance_Confirmed` (Checkbox)

#### **Students** Table (or "Users" table)
Required fields:
- `Student_Name` or `Name` (Text) - Maps to `student.name`
- `Email` (Email) - Maps to `student.email`
- `Phone` (Phone number) - Maps to `student.phone`

Optional fields:
- `Parent_Name` (Text) - Maps to `student.parentName`
- `Grade` (Text) - Maps to `student.grade`
- `Status` (Single select: active, on_hold, inactive) - Maps to `student.status`
- `Subscription_Type` (Text) - Maps to `student.subscriptionType`
- `Balance` (Number) - Maps to `student.balance`
- `Notes` (Long text) - Maps to `student.notes`

## How It Works

1. **Fetching Data**: When the app loads, it will try to fetch data from Airtable first. If Airtable is not configured or fails, it falls back to mock data.

2. **Updating Lessons**: When Raz updates a time slot in the scheduler (via `updateLesson`), the app will:
   - Send a PATCH request to Airtable to update the lesson record
   - Map the lesson fields to Airtable field names
   - Fall back to mock data if Airtable update fails

3. **Field Mapping**: The app automatically maps between Airtable field names and the internal TypeScript types. See `config/airtable.ts` for the field mappings.

## Security Note

⚠️ **Important**: The Airtable API key will be exposed in the frontend code. For production, consider:
- Using a backend proxy server to hide the API key
- Using environment variables that are only available server-side
- Implementing proper authentication and authorization

## Testing

After setting up `.env.local`:
1. Restart your Vite dev server
2. Open the browser console to see Airtable API logs
3. Check that lessons and students are being fetched from Airtable
4. Try updating a lesson time slot and verify it updates in Airtable
