---
name: Full Function Mapping and Reliability Audit
overview: Comprehensive code analysis mapping all functions, identifying issues, broken code, unimplemented features, and critical fixes needed across the entire repository.
todos:
  - id: fix-date-filtering
    content: Re-enable date filtering in nexusApi.getLessons - currently fetches ALL lessons
    status: pending
  - id: fix-timezone
    content: Fix timezone handling in billingRules.getMonthBoundaries to use Asia/Jerusalem instead of local time
    status: pending
  - id: remove-debug-logs
    content: Remove or gate extensive debug logging in nexusApi.getLessons, createLesson, and getChargesReport
    status: pending
  - id: implement-mock-apis
    content: "Implement real Airtable integrations for: weekly slots, homework assignments, system errors, bill actions"
    status: pending
  - id: deduplicate-code
    content: "Extract duplicate code: airtableRequest, parseMonthlyAmount, generateBillingKey to shared utilities"
    status: pending
  - id: implement-business-rules
    content: Implement business rules for multi-student private lessons and overlapping subscriptions
    status: pending
  - id: fix-field-mappings
    content: Document and fix Airtable field name mappings - remove fallback logic
    status: pending
  - id: implement-ui-features
    content: "Implement missing UI features: create student, generate bills, error retry, settings page"
    status: pending
  - id: fix-pagination
    content: Implement proper pagination in airtableClient.getRecords and useStudents hook
    status: pending
  - id: remove-dead-code
    content: Remove unused checkConflict function in Calendar component
    status: pending
  - id: improve-error-handling
    content: Add consistent error handling throughout - avoid silent fallbacks to mock data
    status: pending
  - id: document-side-effects
    content: Document or refactor global cache and rawRecords attachment patterns
    status: pending
---

# Full Function Mapping and Reliability Audit

## Section 1: Full Function List

### Core Application Files

#### `App.tsx`

- **`App`** (React Component)
- **File**: `App.tsx:14`
- **Description**: Main application component with tab-based navigation
- **Inputs**: None (React component)
- **Outputs**: JSX
- **Dependencies**: Layout, Dashboard, Calendar, Students, Inbox, Subscriptions, Billing, Homework, Availability, ErrorCenter
- **Issues**: None critical

- **`renderContent`** (Internal function)
- **File**: `App.tsx:17`
- **Description**: Renders content based on active tab
- **Inputs**: None (uses closure)
- **Outputs**: JSX
- **Dependencies**: All component imports
- **Issues**: Settings tab has hardcoded UI (not functional)

#### `index.tsx`

- **Root render function**
- **File**: `index.tsx:6-16`
- **Description**: React app entry point
- **Inputs**: None
- **Outputs**: Mounts React app
- **Dependencies**: React, ReactDOM, App
- **Issues**: Error handling for missing root element

### Services Layer

#### `services/nexusApi.ts`

- **`airtableRequest<T>`** (Internal async function)
- **File**: `nexusApi.ts:18`
- **Description**: Makes authenticated requests to Airtable API
- **Inputs**: `endpoint: string`, `options?: RequestInit`
- **Outputs**: `Promise<T>`
- **Dependencies**: fetch API, environment variables
- **Issues**: Error handling could be more specific; network errors not always caught

- **`mapAirtableToLesson`** (Internal function)
- **File**: `nexusApi.ts:79`
- **Description**: Maps Airtable record to Lesson type
- **Inputs**: `record: any`
- **Outputs**: `Lesson`
- **Dependencies**: AIRTABLE_CONFIG, LessonStatus enum
- **Issues**: Extensive debug logging in production code; multiple fallback field names suggest schema uncertainty

- **`mapAirtableToStudent`** (Internal function)
- **File**: `nexusApi.ts:171`
- **Description**: Maps Airtable record to Student type
- **Inputs**: `record: any`
- **Outputs**: `Student`
- **Dependencies**: AIRTABLE_CONFIG
- **Issues**: Field name fallbacks indicate schema inconsistency

- **`mapLessonToAirtable`** (Internal function)
- **File**: `nexusApi.ts:190`
- **Description**: Maps Lesson to Airtable fields (updates only)
- **Inputs**: `lesson: Partial<Lesson>`
- **Outputs**: `{ fields: any }`
- **Dependencies**: AIRTABLE_CONFIG
- **Issues**: Only maps status, start_datetime, end_datetime - other fields ignored

- **`handleResponse<T>`** (Internal async function)
- **File**: `nexusApi.ts:228`
- **Description**: Handles HTTP response with error parsing
- **Inputs**: `response: Response`, `url: string`
- **Outputs**: `Promise<T>`
- **Dependencies**: None
- **Issues**: Complex error detection logic; may miss edge cases

- **`parseApiError`** (Exported function)
- **File**: `nexusApi.ts:294`
- **Description**: Extracts error message from error object
- **Inputs**: `err: any`
- **Outputs**: `string`
- **Dependencies**: None
- **Issues**: None

- **`withFallback<T>`** (Internal async function)
- **File**: `nexusApi.ts:300`
- **Description**: Wraps API calls with fallback data
- **Inputs**: `apiCall: () => Promise<T>`, `fallbackData: T | (() => Promise<T>)`
- **Outputs**: `Promise<T>`
- **Dependencies**: None
- **Issues**: Only used in some places, inconsistent error handling

- **`nexusApi.getTeachers`** (Exported async function)
- **File**: `nexusApi.ts:314`
- **Description**: Fetches teachers from Airtable
- **Inputs**: None
- **Outputs**: `Promise<Teacher[]>`
- **Dependencies**: airtableRequest, AIRTABLE_CONFIG
- **Issues**: No fallback; throws if API key missing

- **`nexusApi.getStudents`** (Exported async function)
- **File**: `nexusApi.ts:336`
- **Description**: Fetches students from Airtable with pagination
- **Inputs**: `page: number = 1`
- **Outputs**: `Promise<Student[]>`
- **Dependencies**: airtableRequest, mapAirtableToStudent, AIRTABLE_CONFIG
- **Issues**: Pagination offset calculation may be incorrect; no error handling for pagination failures

- **`nexusApi.getLessons`** (Exported async function)
- **File**: `nexusApi.ts:352`
- **Description**: Fetches lessons from Airtable with date range filtering
- **Inputs**: `start: string`, `end: string`, `teacherId?: string`
- **Outputs**: `Promise<Lesson[]>`
- **Dependencies**: airtableRequest, mapAirtableToLesson, AIRTABLE_CONFIG
- **Issues**: 
- ⚠️ **CRITICAL**: Date filtering is TEMPORARILY COMMENTED OUT (lines 369-383) - fetches ALL records
- Extensive debug logging (lines 412-519) should be removed or gated
- Field discovery logic suggests schema uncertainty
- Attaches rawRecords to array (line 532) - non-standard pattern

- **`nexusApi.getWeeklySlots`** (Exported function)
- **File**: `nexusApi.ts:537`
- **Description**: Returns mock weekly slots
- **Inputs**: None
- **Outputs**: `Promise<WeeklySlot[]>`
- **Dependencies**: None
- **Issues**: ⚠️ **BROKEN**: Returns hardcoded mock data, not connected to Airtable

- **`nexusApi.getSlotInventory`** (Exported function)
- **File**: `nexusApi.ts:546`
- **Description**: Returns mock slot inventory
- **Inputs**: `start: string`, `end: string`
- **Outputs**: `Promise<SlotInventory[]>`
- **Dependencies**: None
- **Issues**: ⚠️ **BROKEN**: Returns hardcoded mock data, not connected to Airtable

- **`nexusApi.updateWeeklySlot`** (Exported function)
- **File**: `nexusApi.ts:555`
- **Description**: Mock update for weekly slot
- **Inputs**: `id: string`, `updates: Partial<WeeklySlot>`
- **Outputs**: `Promise<WeeklySlot>`
- **Dependencies**: None
- **Issues**: ⚠️ **BROKEN**: Mock only, doesn't persist changes

- **`nexusApi.updateSlotInventory`** (Exported function)
- **File**: `nexusApi.ts:560`
- **Description**: Mock update for slot inventory
- **Inputs**: `id: string`, `updates: Partial<SlotInventory>`
- **Outputs**: `Promise<SlotInventory>`
- **Dependencies**: None
- **Issues**: ⚠️ **BROKEN**: Mock only, doesn't persist changes

- **`nexusApi.getHomeworkLibrary`** (Exported async function)
- **File**: `nexusApi.ts:565`
- **Description**: Fetches homework library from Airtable
- **Inputs**: None
- **Outputs**: `Promise<HomeworkLibraryItem[]>`
- **Dependencies**: airtableRequest, AIRTABLE_CONFIG
- **Issues**: Field name fallbacks suggest schema uncertainty

- **`nexusApi.getHomeworkAssignments`** (Exported function)
- **File**: `nexusApi.ts:590`
- **Description**: Returns mock homework assignments
- **Inputs**: None
- **Outputs**: `Promise<HomeworkAssignment[]>`
- **Dependencies**: mockData
- **Issues**: ⚠️ **BROKEN**: Returns mock data only, not connected to Airtable

- **`nexusApi.assignHomework`** (Exported function)
- **File**: `nexusApi.ts:597`
- **Description**: Mock homework assignment
- **Inputs**: `payload: Partial<HomeworkAssignment>`
- **Outputs**: `Promise<HomeworkAssignment>`
- **Dependencies**: None
- **Issues**: ⚠️ **BROKEN**: Mock only, doesn't persist to Airtable

- **`nexusApi.getSystemErrors`** (Exported function)
- **File**: `nexusApi.ts:607`
- **Description**: Returns mock system errors
- **Inputs**: None
- **Outputs**: `Promise<SystemError[]>`
- **Dependencies**: mockData
- **Issues**: ⚠️ **BROKEN**: Returns mock data only

- **`nexusApi.updateLesson`** (Exported async function)
- **File**: `nexusApi.ts:612`
- **Description**: Updates lesson in Airtable
- **Inputs**: `id: string`, `updates: Partial<Lesson>`
- **Outputs**: `Promise<Lesson>`
- **Dependencies**: airtableRequest, mapLessonToAirtable, mapAirtableToLesson, AIRTABLE_CONFIG
- **Issues**: Only updates status, start_datetime, end_datetime - other fields ignored

- **`nexusApi.getMonthlyBills`** (Exported async function)
- **File**: `nexusApi.ts:632`
- **Description**: Fetches monthly bills using charges report service
- **Inputs**: `month: string`, `options?: { statusFilter?, searchQuery? }`
- **Outputs**: `Promise<MonthlyBill[]>`
- **Dependencies**: getChargesReport, airtableClient
- **Issues**: 
- Falls back to mock data on error (line 715)
- Status mapping may not match all Airtable statuses
- Hardcoded lesson price estimate (line 681)

- **`nexusApi.approveAndSendBill`** (Exported function)
- **File**: `nexusApi.ts:719`
- **Description**: Mock bill approval
- **Inputs**: `id: string`
- **Outputs**: `Promise<void>`
- **Dependencies**: None
- **Issues**: ⚠️ **BROKEN**: Mock only, doesn't update Airtable

- **`nexusApi.markBillPaid`** (Exported function)
- **File**: `nexusApi.ts:725`
- **Description**: Mock bill payment marking
- **Inputs**: `id: string`
- **Outputs**: `Promise<void>`
- **Dependencies**: None
- **Issues**: ⚠️ **BROKEN**: Mock only, doesn't update Airtable

- **`nexusApi.mapAirtableToSubscription`** (Exported function)
- **File**: `nexusApi.ts:732`
- **Description**: Maps Airtable record to Subscription
- **Inputs**: `record: any`
- **Outputs**: `Subscription`
- **Dependencies**: None
- **Issues**: Multiple field name variations suggest schema uncertainty

- **`nexusApi.getSubscriptions`** (Exported async function)
- **File**: `nexusApi.ts:763`
- **Description**: Fetches subscriptions from Airtable
- **Inputs**: None
- **Outputs**: `Promise<Subscription[]>`
- **Dependencies**: airtableRequest, mapAirtableToSubscription, AIRTABLE_CONFIG
- **Issues**: None critical

- **`nexusApi.createSubscription`** (Exported async function)
- **File**: `nexusApi.ts:778`
- **Description**: Creates subscription in Airtable
- **Inputs**: `subscription: Partial<Subscription>`
- **Outputs**: `Promise<Subscription>`
- **Dependencies**: airtableRequest, mapAirtableToSubscription, AIRTABLE_CONFIG
- **Issues**: Validation only checks studentId, other fields may be invalid

- **`nexusApi.updateSubscription`** (Exported async function)
- **File**: `nexusApi.ts:829`
- **Description**: Updates subscription in Airtable
- **Inputs**: `id: string`, `updates: Partial<Subscription>`
- **Outputs**: `Promise<Subscription>`
- **Dependencies**: airtableRequest, mapAirtableToSubscription, AIRTABLE_CONFIG
- **Issues**: None critical

- **`nexusApi.pauseSubscription`** (Exported async function)
- **File**: `nexusApi.ts:876`
- **Description**: Pauses subscription
- **Inputs**: `id: string`
- **Outputs**: `Promise<Subscription>`
- **Dependencies**: updateSubscription
- **Issues**: None

- **`nexusApi.resumeSubscription`** (Exported async function)
- **File**: `nexusApi.ts:883`
- **Description**: Resumes subscription
- **Inputs**: `id: string`
- **Outputs**: `Promise<Subscription>`
- **Dependencies**: updateSubscription
- **Issues**: Sets pauseDate to null (string), may cause type issues

- **`nexusApi.searchStudents`** (Exported async function)
- **File**: `nexusApi.ts:891`
- **Description**: Searches students with autocomplete
- **Inputs**: `query: string`, `limit: number = 15`
- **Outputs**: `Promise<Student[]>`
- **Dependencies**: airtableRequest, mapAirtableToStudent, AIRTABLE_CONFIG
- **Issues**: 
- Complex fallback logic (lines 962-999)
- Formula-based search may fail silently
- Local filtering fetches all students (inefficient)

- **`nexusApi.checkLessonConflicts`** (Exported async function)
- **File**: `nexusApi.ts:1003`
- **Description**: Checks for lesson time conflicts
- **Inputs**: `startDatetime: string`, `endDatetime: string`, `studentId?: string`, `teacherId?: string`, `excludeLessonId?: string`
- **Outputs**: `Promise<Lesson[]>`
- **Dependencies**: airtableRequest, mapAirtableToLesson, AIRTABLE_CONFIG
- **Issues**: 
- Client-side filtering after fetch (inefficient)
- Linked record filtering may not work correctly in Airtable formula

- **`nexusApi.createLesson`** (Exported async function)
- **File**: `nexusApi.ts:1085`
- **Description**: Creates new lesson with validation
- **Inputs**: `lesson: Partial<Lesson>`
- **Outputs**: `Promise<Lesson>`
- **Dependencies**: airtableRequest, mapAirtableToLesson, AIRTABLE_CONFIG, checkLessonConflicts (inline)
- **Issues**: 
- ⚠️ **CRITICAL**: Extensive debug logging (lines 1114-1320)
- Student ID validation (lines 1114-1134) - good
- Datetime calculation (lines 1136-1178) - complex, may have timezone issues
- Conflict check is inline (lines 1181-1208) - duplicates checkLessonConflicts logic
- Field mapping uses strict config (lines 1220-1293) - good approach
- Subject and lessonType fields commented out (lines 1277-1289) - not implemented

#### `services/airtableClient.ts`

- **`sleep`** (Internal function)
- **File**: `airtableClient.ts:24`
- **Description**: Sleep utility for backoff
- **Inputs**: `ms: number`
- **Outputs**: `Promise<void>`
- **Dependencies**: None
- **Issues**: None

- **`withRetry<T>`** (Internal async function)
- **File**: `airtableClient.ts:31`
- **Description**: Retry with exponential backoff
- **Inputs**: `fn: () => Promise<T>`, `retries: number = MAX_RETRIES`, `backoffMs: number = INITIAL_BACKOFF_MS`
- **Outputs**: `Promise<T>`
- **Dependencies**: sleep
- **Issues**: Doesn't retry on 4xx except 429 - may miss transient errors

- **`AirtableClient`** (Class)
- **File**: `airtableClient.ts:60`
- **Description**: Data access layer for Airtable with retry/backoff
- **Constructor**: `airtableClient.ts:65`
- **Inputs**: `apiKey?: string`, `baseId?: string`
- **Outputs**: AirtableClient instance
- **Dependencies**: getApiKey, getBaseId
- **Issues**: None

- **`ensureConfigured`** (Private method)
- **File**: `airtableClient.ts:90`
- **Description**: Validates configuration
- **Inputs**: None
- **Outputs**: void (throws if not configured)
- **Dependencies**: None
- **Issues**: None

- **`request<T>`** (Private async method)
- **File**: `airtableClient.ts:103`
- **Description**: Makes authenticated Airtable request with retry
- **Inputs**: `endpoint: string`, `options?: RequestInit`
- **Outputs**: `Promise<T>`
- **Dependencies**: withRetry, fetch API
- **Issues**: Error handling for 403 could be more specific

- **`getRecords<T>`** (Public async method)
- **File**: `airtableClient.ts:187`
- **Description**: Gets records with filtering and sorting
- **Inputs**: `tableId: string`, `options?: { filterByFormula?, sort?, pageSize?, maxRecords? }`
- **Outputs**: `Promise<Array<{ id: string; fields: T }>>`
- **Dependencies**: request
- **Issues**: No pagination support (only first page)

- **`getRecord<T>`** (Public async method)
- **File**: `airtableClient.ts:226`
- **Description**: Gets single record by ID
- **Inputs**: `tableId: string`, `recordId: string`
- **Outputs**: `Promise<{ id: string; fields: T }>`
- **Dependencies**: request
- **Issues**: None

- **`createRecord<T>`** (Public async method)
- **File**: `airtableClient.ts:234`
- **Description**: Creates new record
- **Inputs**: `tableId: string`, `fields: T`
- **Outputs**: `Promise<{ id: string; fields: T }>`
- **Dependencies**: request
- **Issues**: None

- **`updateRecord<T>`** (Public async method)
- **File**: `airtableClient.ts:251`
- **Description**: Updates existing record
- **Inputs**: `tableId: string`, `recordId: string`, `fields: Partial<T>`
- **Outputs**: `Promise<{ id: string; fields: T }>`
- **Dependencies**: request
- **Issues**: None

- **`findRecordByField<T>`** (Public async method)
- **File**: `airtableClient.ts:269`
- **Description**: Finds record by field value
- **Inputs**: `tableId: string`, `fieldName: string`, `fieldValue: string`
- **Outputs**: `Promise<{ id: string; fields: T } | null>`
- **Dependencies**: getRecords
- **Issues**: Only returns first match, no error if multiple found

- **`getTableId`** (Public method)
- **File**: `airtableClient.ts:286`
- **Description**: Gets table ID from config
- **Inputs**: `tableName: keyof typeof AIRTABLE_CONFIG.tables`
- **Outputs**: `string`
- **Dependencies**: AIRTABLE_CONFIG
- **Issues**: None

#### `services/billingService.ts`

- **`calculateLessonPrice`** (Exported function)
- **File**: `billingService.ts:41`
- **Description**: Calculates lesson price based on type
- **Inputs**: `lessonType: string | undefined | null`
- **Outputs**: `number`
- **Dependencies**: None
- **Issues**: Defaults to 175 if type unknown - may hide data issues

- **`isCancellationBillable`** (Exported function)
- **File**: `billingService.ts:65`
- **Description**: Checks if cancellation is billable (<24h)
- **Inputs**: `lessonStartDatetime: string`, `cancellationDatetime?: string | null`
- **Outputs**: `boolean`
- **Dependencies**: None
- **Issues**: Returns false if no cancellationDatetime - may be incorrect business logic

- **`calculateCancellationCharge`** (Exported function)
- **File**: `billingService.ts:89`
- **Description**: Calculates cancellation charge
- **Inputs**: `lessonStartDatetime: string`, `lessonType: string | undefined | null`, `cancellationDatetime?: string | null`
- **Outputs**: `number`
- **Dependencies**: isCancellationBillable, calculateLessonPrice
- **Issues**: None

- **`getBillingMonth`** (Exported function)
- **File**: `billingService.ts:105`
- **Description**: Calculates billing month string (YYYY-MM)
- **Inputs**: `date: Date | string`
- **Outputs**: `string`
- **Dependencies**: None
- **Issues**: None

- **`generateBillingKey`** (Exported function)
- **File**: `billingService.ts:115`
- **Description**: Generates deterministic billing key
- **Inputs**: `studentRecordId: string`, `billingMonth: string`
- **Outputs**: `string`
- **Dependencies**: None
- **Issues**: None

- **`calculateStudentBilling`** (Exported function)
- **File**: `billingService.ts:130`
- **Description**: Calculates billing for single student
- **Inputs**: `lessons: (Lesson | LessonWithCancellation)[]`, `subscriptions: Subscription[]`, `studentId: string`, `billingMonth: string`
- **Outputs**: `BillingCalculationResult`
- **Dependencies**: getBillingMonth, calculateLessonPrice, calculateCancellationCharge, parseSubscriptionAmount
- **Issues**: 
- Subscription date range logic (lines 149-170) may have edge cases
- Cancellation datetime extraction (lines 181-194) tries multiple field names

- **`parseSubscriptionAmount`** (Internal function)
- **File**: `billingService.ts:266`
- **Description**: Parses subscription amount from currency string
- **Inputs**: `amount: string | number | undefined | null`
- **Outputs**: `number`
- **Dependencies**: None
- **Issues**: None

- **`validateBillingFields`** (Exported async function)
- **File**: `billingService.ts:294`
- **Description**: Validates required Airtable fields exist
- **Inputs**: `client: AirtableClient`
- **Outputs**: `Promise<MissingFields[] | null>`
- **Dependencies**: AirtableClient
- **Issues**: Field name detection uses heuristics (lines 308-312, 325-329) - may miss fields

- **`generateMonthlyBill`** (Exported async function)
- **File**: `billingService.ts:439`
- **Description**: Generates or updates monthly bill (idempotent)
- **Inputs**: `client: AirtableClient`, `studentId: string`, `studentName: string`, `billingMonth: string`, `lessons: (Lesson | LessonWithCancellation)[]`, `subscriptions: Subscription[]`
- **Outputs**: `Promise<MonthlyBill>`
- **Dependencies**: validateBillingFields, generateBillingKey, calculateStudentBilling, AirtableClient
- **Issues**: 
- Billing key lookup tries multiple field names (lines 464-488)
- Field names hardcoded (lines 495-503) - may not match Airtable schema

- **`fetchLessonsForBilling`** (Exported async function)
- **File**: `billingService.ts:545`
- **Description**: Fetches lessons with cancellation datetime
- **Inputs**: `client: AirtableClient`, `startDate: string`, `endDate: string`
- **Outputs**: `Promise<LessonWithCancellation[]>`
- **Dependencies**: AirtableClient
- **Issues**: 
- Field name hardcoded as 'start_datetime' (line 554) - should use config
- Cancellation datetime tries multiple field names (lines 568-572)
- Simplified mapping (lines 574-593) - may miss fields

- **`generateAllMonthlyBills`** (Exported async function)
- **File**: `billingService.ts:600`
- **Description**: Generates bills for all students
- **Inputs**: `client: AirtableClient`, `billingMonth: string`, `lessons: (Lesson | LessonWithCancellation)[]`, `subscriptions: Subscription[]`, `students: Array<{ id: string; name: string }>`
- **Outputs**: `Promise<MonthlyBill[]>`
- **Dependencies**: generateMonthlyBill
- **Issues**: Continues on error for individual students - may hide issues

- **`discoverChargeTableSchema`** (Internal async function)
- **File**: `billingService.ts:674`
- **Description**: Discovers schema of charges table
- **Inputs**: `client: AirtableClient`
- **Outputs**: `Promise<ChargeTableSchema | MissingFields[]>`
- **Dependencies**: AirtableClient
- **Issues**: Uses heuristics to find fields (lines 708-770) - may fail if schema changes

- **`isStudentEligible`** (Internal async function)
- **File**: `billingService.ts:807`
- **Description**: Checks if student is eligible for billing
- **Inputs**: `client: AirtableClient`, `studentId: string`, `billingMonth: string`
- **Outputs**: `Promise<boolean>`
- **Dependencies**: AirtableClient
- **Issues**: 
- Complex fallback logic (lines 820-937)
- Field name heuristics (lines 822-828)
- Lesson query uses hardcoded field 'full_name' (line 857)

- **`firstStudentId`** (Internal function)
- **File**: `billingService.ts:948`
- **Description**: Extracts first student ID from field
- **Inputs**: `תלמידיםField: any`
- **Outputs**: `string | null`
- **Dependencies**: None
- **Issues**: None

- **`extractAmount`** (Internal function)
- **File**: `billingService.ts:983`
- **Description**: Extracts numeric value from line_amount or unit_price
- **Inputs**: `lessonFields: any`
- **Outputs**: `number`
- **Dependencies**: None
- **Issues**: None

- **`isBillable`** (Internal function)
- **File**: `billingService.ts:1019`
- **Description**: Checks if lesson is billable
- **Inputs**: `lessonFields: any`
- **Outputs**: `boolean`
- **Dependencies**: None
- **Issues**: Returns false if neither field exists - may be incorrect

- **`createMonthlyCharges`** (Exported async function)
- **File**: `billingService.ts:1044`
- **Description**: Creates monthly charges (idempotent)
- **Inputs**: `client: AirtableClient`, `billingMonth: string`
- **Outputs**: `Promise<CreateMonthlyChargesResult>`
- **Dependencies**: discoverChargeTableSchema, AirtableClient, firstStudentId, extractAmount, isBillable
- **Issues**: 
- Field validation uses hardcoded names (lines 1069-1110)
- Requires 'billing_month' and 'תלמידים' fields in lessons table
- May create charges with 0 amount if fields missing

- **`discoverLookupFields`** (Internal function)
- **File**: `billingService.ts:1248`
- **Description**: Discovers lookup fields in charges table
- **Inputs**: `sampleRecord: any`
- **Outputs**: `ChargesLookupFields`
- **Dependencies**: None
- **Issues**: Uses heuristics to find fields (lines 1252-1311) - may fail

- **`extractStudentRecordId`** (Internal function)
- **File**: `billingService.ts:1319`
- **Description**: Extracts student record ID from charge record
- **Inputs**: `chargeRecord: any`, `studentFieldName: string`
- **Outputs**: `string | null`
- **Dependencies**: None
- **Issues**: None

- **`extractDisplayName`** (Internal function)
- **File**: `billingService.ts:1356`
- **Description**: Extracts display name from lookup fields
- **Inputs**: `chargeRecord: any`, `lookupFields: ChargesLookupFields`
- **Outputs**: `string`
- **Dependencies**: None
- **Issues**: Multiple fallback field names (lines 1378-1400)

- **`extractNumericValue`** (Internal function)
- **File**: `billingService.ts:1408`
- **Description**: Extracts numeric value from lookup field
- **Inputs**: `chargeRecord: any`, `fieldName: string | undefined`
- **Outputs**: `number | undefined`
- **Dependencies**: None
- **Issues**: None

- **`deriveStatus`** (Internal function)
- **File**: `billingService.ts:1448`
- **Description**: Derives status from approval and paid flags
- **Inputs**: `approved: boolean`, `paid: boolean`
- **Outputs**: `'טיוטה' | 'נשלח' | 'שולם'`
- **Dependencies**: None
- **Issues**: None

- **`buildFilterFormula`** (Internal function)
- **File**: `billingService.ts:1461`
- **Description**: Builds Airtable filter formula
- **Inputs**: `billingMonth: string`, `statusFilter: ChargesReportStatusFilter`, `searchQuery?: string`, `studentFieldName?: string`, `displayNameField?: string`
- **Outputs**: `string`
- **Dependencies**: None
- **Issues**: 
- Complex month filtering (lines 1475-1489) tries multiple approaches
- Search query escaping (line 1504) may not handle all cases

- **`getChargesReport`** (Exported async function)
- **File**: `billingService.ts:1537`
- **Description**: Gets charges report from Airtable
- **Inputs**: `client: AirtableClient`, `input: ChargesReportInput`
- **Outputs**: `Promise<ChargesReportResult>`
- **Dependencies**: discoverChargeTableSchema, discoverLookupFields, buildFilterFormula, extractStudentRecordId, extractDisplayName, extractNumericValue, deriveStatus, AirtableClient
- **Issues**: 
- Extensive debug logging (lines 1549-1655)
- Paging not fully implemented (line 1659)
- Field discovery may fail silently

- **`getChargesReportKPIs`** (Exported async function)
- **File**: `billingService.ts:1764`
- **Description**: Calculates KPIs from charges report
- **Inputs**: `client: AirtableClient`, `billingMonth: string`
- **Outputs**: `Promise<ChargesReportKPIs>`
- **Dependencies**: discoverChargeTableSchema, discoverLookupFields, extractNumericValue, AirtableClient
- **Issues**: 
- Throws error if totalAmount field missing (lines 1801-1853)
- Field discovery uses heuristics

#### `services/subscriptionsService.ts`

- **`airtableRequest<T>`** (Internal async function)
- **File**: `subscriptionsService.ts:13`
- **Description**: Makes Airtable API request
- **Inputs**: `endpoint: string`, `options?: RequestInit`
- **Outputs**: `Promise<T>`
- **Dependencies**: fetch API, environment variables
- **Issues**: ⚠️ **DUPLICATE**: Duplicates logic from nexusApi.airtableRequest

- **`parseMonthlyAmount`** (Exported function)
- **File**: `subscriptionsService.ts:78`
- **Description**: Parses monthly amount from currency string
- **Inputs**: `amount: string | number | undefined | null`
- **Outputs**: `number`
- **Dependencies**: None
- **Issues**: ⚠️ **DUPLICATE**: Same logic as billingService.parseSubscriptionAmount

- **`mapAirtableToSubscription`** (Internal function)
- **File**: `subscriptionsService.ts:110`
- **Description**: Maps Airtable record to Subscription
- **Inputs**: `record: any`
- **Outputs**: `Subscription`
- **Dependencies**: None
- **Issues**: Multiple field name variations (lines 114-121)

- **`mapSubscriptionToAirtable`** (Internal function)
- **File**: `subscriptionsService.ts:145`
- **Description**: Maps Subscription to Airtable fields
- **Inputs**: `subscription: Partial<Subscription>`
- **Outputs**: `any`
- **Dependencies**: None
- **Issues**: None

- **`subscriptionsService.listSubscriptions`** (Exported async function)
- **File**: `subscriptionsService.ts:187`
- **Description**: Lists all subscriptions
- **Inputs**: None
- **Outputs**: `Promise<Subscription[]>`
- **Dependencies**: airtableRequest, mapAirtableToSubscription, AIRTABLE_CONFIG
- **Issues**: None

- **`subscriptionsService.createSubscription`** (Exported async function)
- **File**: `subscriptionsService.ts:209`
- **Description**: Creates new subscription
- **Inputs**: `data: Partial<Subscription>`
- **Outputs**: `Promise<Subscription>`
- **Dependencies**: airtableRequest, mapSubscriptionToAirtable, mapAirtableToSubscription, AIRTABLE_CONFIG
- **Issues**: Validation only checks studentId

- **`subscriptionsService.updateSubscription`** (Exported async function)
- **File**: `subscriptionsService.ts:244`
- **Description**: Updates subscription
- **Inputs**: `id: string`, `data: Partial<Subscription>`
- **Outputs**: `Promise<Subscription>`
- **Dependencies**: airtableRequest, mapSubscriptionToAirtable, mapAirtableToSubscription, AIRTABLE_CONFIG
- **Issues**: None

#### `services/mockApi.ts`

- **`mockData.getTeachers`** (Exported async function)
- **File**: `mockApi.ts:60`
- **Description**: Returns mock teachers
- **Inputs**: None
- **Outputs**: `Promise<Teacher[]>`
- **Dependencies**: None
- **Issues**: Used as fallback in some places

- **`mockData.getStudents`** (Exported async function)
- **File**: `mockApi.ts:64`
- **Description**: Returns mock students
- **Inputs**: None
- **Outputs**: `Promise<Student[]>`
- **Dependencies**: None
- **Issues**: Used as fallback

- **`mockData.getLessons`** (Exported async function)
- **File**: `mockApi.ts:68`
- **Description**: Returns mock lessons
- **Inputs**: `start: string`, `end: string`, `teacherId?: string`
- **Outputs**: `Promise<Lesson[]>`
- **Dependencies**: None
- **Issues**: Used as fallback

- **`mockData.updateLesson`** (Exported async function)
- **File**: `mockApi.ts:76`
- **Description**: Mock lesson update
- **Inputs**: `id: string`, `updates: Partial<Lesson>`
- **Outputs**: `Promise<Lesson>`
- **Dependencies**: None
- **Issues**: Updates in-memory array only

- **`mockData.getMonthlyBills`** (Exported async function)
- **File**: `mockApi.ts:83`
- **Description**: Returns empty array
- **Inputs**: `month: string`
- **Outputs**: `Promise<MonthlyBill[]>`
- **Dependencies**: None
- **Issues**: Always returns empty

- **`mockData.getSubscriptions`** (Exported async function)
- **File**: `mockApi.ts:86`
- **Description**: Returns empty array
- **Inputs**: `status: string`
- **Outputs**: `Promise<Subscription[]>`
- **Dependencies**: None
- **Issues**: Always returns empty

- **`mockData.getSystemErrors`** (Exported async function)
- **File**: `mockApi.ts:89`
- **Description**: Returns empty array
- **Inputs**: None
- **Outputs**: `Promise<SystemError[]>`
- **Dependencies**: None
- **Issues**: Always returns empty

### Billing Engine (`billing/` directory)

#### `billing/billingEngine.ts`

- **`generateBillingKey`** (Exported function)
- **File**: `billingEngine.ts:51`
- **Description**: Generates billing key
- **Inputs**: `studentRecordId: string`, `billingMonth: string`
- **Outputs**: `string`
- **Dependencies**: None
- **Issues**: ⚠️ **DUPLICATE**: Same as billingService.generateBillingKey

- **`buildStudentMonth`** (Exported async function)
- **File**: `billingEngine.ts:58`
- **Description**: Builds monthly bill for single student
- **Inputs**: `client: AirtableClient`, `studentRecordId: string`, `billingMonth: string`
- **Outputs**: `Promise<BillingResult | MissingFieldsError | DomainError>`
- **Dependencies**: calculateLessonsContribution, calculateCancellationsContribution, calculateSubscriptionsContribution, calculateTotal, determineBillingStatus, extractStudentId, extractLessonId, AirtableClient
- **Issues**: 
- Uses hardcoded Hebrew field names (lines 92, 100, 108, 170, 197, 210)
- Duplicate billing check (lines 179-194) - good
- Field name 'תלמיד' hardcoded (line 170)

- **`buildMonthForAllActiveStudents`** (Exported async function)
- **File**: `billingEngine.ts:257`
- **Description**: Builds bills for all active students
- **Inputs**: `client: AirtableClient`, `billingMonth: string`
- **Outputs**: `Promise<{ success: BillingResult[]; errors: Array<{ studentId: string; error: DomainError | MissingFieldsError }> }>`
- **Dependencies**: buildStudentMonth, AirtableClient
- **Issues**: 
- Uses hardcoded field 'is_active' (line 267)
- Continues on error - may hide issues

#### `billing/billingRules.ts`

- **`extractStudentId`** (Exported function)
- **File**: `billingRules.ts:19`
- **Description**: Extracts student ID from linked record
- **Inputs**: `linkedRecord: LinkedRecord`
- **Outputs**: `string`
- **Dependencies**: None
- **Issues**: Throws generic error if invalid format

- **`hasMultipleStudents`** (Exported function)
- **File**: `billingRules.ts:32`
- **Description**: Checks if linked record has multiple students
- **Inputs**: `linkedRecord: LinkedRecord`
- **Outputs**: `boolean`
- **Dependencies**: None
- **Issues**: None

- **`getAllStudentIds`** (Exported function)
- **File**: `billingRules.ts:39`
- **Description**: Gets all student IDs from linked record
- **Inputs**: `linkedRecord: LinkedRecord`
- **Outputs**: `string[]`
- **Dependencies**: None
- **Issues**: None

- **`extractLessonId`** (Exported function)
- **File**: `billingRules.ts:52`
- **Description**: Extracts lesson ID from linked record
- **Inputs**: `linkedRecord: LinkedRecord`
- **Outputs**: `string`
- **Dependencies**: extractStudentId
- **Issues**: None

- **`isLessonExcluded`** (Exported function)
- **File**: `billingRules.ts:59`
- **Description**: Checks if lesson should be excluded
- **Inputs**: `status: string`
- **Outputs**: `boolean`
- **Dependencies**: None
- **Issues**: Hardcoded Hebrew status values

- **`isPrivateLesson`** (Exported function)
- **File**: `billingRules.ts:66`
- **Description**: Checks if lesson type is private
- **Inputs**: `lessonType: string`
- **Outputs**: `boolean`
- **Dependencies**: None
- **Issues**: Hardcoded Hebrew value

- **`calculateLessonAmount`** (Exported function)
- **File**: `billingRules.ts:73`
- **Description**: Calculates lesson amount
- **Inputs**: `lesson: LessonsAirtableFields`
- **Outputs**: `number`
- **Dependencies**: None
- **Issues**: Defaults to 175 if line_amount missing

- **`calculateLessonsContribution`** (Exported function)
- **File**: `billingRules.ts:91`
- **Description**: Calculates lessons contribution to billing
- **Inputs**: `lessons: LessonsAirtableFields[]`, `billingMonth: string`, `targetStudentId: string`
- **Outputs**: `LessonsContribution | MissingFieldsError`
- **Dependencies**: isLessonExcluded, isPrivateLesson, hasMultipleStudents, getAllStudentIds, calculateLessonAmount
- **Issues**: 
- Returns MissingFieldsError for multi-student private lessons (lines 123-133) - business rule needed
- Skips lessons if type not private (line 140)

- **`calculateCancellationAmount`** (Exported function)
- **File**: `billingRules.ts:160`
- **Description**: Calculates cancellation charge
- **Inputs**: `cancellation: CancellationsAirtableFields`, `linkedLesson?: LessonsAirtableFields`
- **Outputs**: `number | null`
- **Dependencies**: isPrivateLesson
- **Issues**: Returns null if cannot determine - should return MissingFieldsError

- **`calculateCancellationsContribution`** (Exported function)
- **File**: `billingRules.ts:191`
- **Description**: Calculates cancellations contribution
- **Inputs**: `cancellations: CancellationsAirtableFields[]`, `billingMonth: string`, `getLinkedLesson?: (lessonId: string) => LessonsAirtableFields | undefined`
- **Outputs**: `CancellationsContribution | MissingFieldsError`
- **Dependencies**: extractLessonId, calculateCancellationAmount
- **Issues**: 
- Returns MissingFieldsError if charge cannot be determined (lines 228-249)
- Complex logic for determining charge

- **`getMonthBoundaries`** (Internal function)
- **File**: `billingRules.ts:285`
- **Description**: Gets month boundaries (timezone handling)
- **Inputs**: `billingMonth: string`
- **Outputs**: `{ start: Date; end: Date }`
- **Dependencies**: None
- **Issues**: 
- ⚠️ **CRITICAL**: Uses local time, not Asia/Jerusalem (line 297)
- Comment suggests using date-fns-tz but not implemented

- **`isSubscriptionActiveForMonth`** (Exported function)
- **File**: `billingRules.ts:307`
- **Description**: Checks if subscription is active for billing month
- **Inputs**: `subscription: SubscriptionsAirtableFields`, `billingMonth: string`
- **Outputs**: `boolean`
- **Dependencies**: getMonthBoundaries
- **Issues**: Timezone issue inherited from getMonthBoundaries

- **`parseMonthlyAmount`** (Exported function)
- **File**: `billingRules.ts:338`
- **Description**: Parses monthly amount
- **Inputs**: `amount: string | number`
- **Outputs**: `number`
- **Dependencies**: None
- **Issues**: ⚠️ **DUPLICATE**: Same as billingService.parseSubscriptionAmount and subscriptionsService.parseMonthlyAmount

- **`calculateSubscriptionsContribution`** (Exported function)
- **File**: `billingRules.ts:364`
- **Description**: Calculates subscriptions contribution
- **Inputs**: `subscriptions: SubscriptionsAirtableFields[]`, `billingMonth: string`
- **Outputs**: `SubscriptionsContribution | MissingFieldsError`
- **Dependencies**: isSubscriptionActiveForMonth, parseMonthlyAmount
- **Issues**: 
- Returns MissingFieldsError for overlapping subscriptions (lines 377-399) - business rule needed
- Timezone issue inherited

- **`calculateTotal`** (Exported function)
- **File**: `billingRules.ts:417`
- **Description**: Calculates total billing amount
- **Inputs**: `lessonsTotal: number`, `cancellationsTotal: number`, `subscriptionsTotal: number`
- **Outputs**: `number`
- **Dependencies**: None
- **Issues**: None

- **`determineBillingStatus`** (Exported function)
- **File**: `billingRules.ts:430`
- **Description**: Determines billing status
- **Inputs**: `pendingCancellationsCount: number`, `isPaid: boolean`
- **Outputs**: `BillingStatus`
- **Dependencies**: None
- **Issues**: None

#### `billing/domainErrors.ts`

- **`DomainError`** (Class)
- **File**: `domainErrors.ts:5`
- **Description**: Base domain error class
- **Issues**: None

- **`MissingFieldsError`** (Class)
- **File**: `domainErrors.ts:16`
- **Description**: Error for missing Airtable fields
- **Issues**: None

- **`DuplicateBillingRecordsError`** (Class)
- **File**: `domainErrors.ts:32`
- **Description**: Error for duplicate billing records
- **Issues**: None

- **`AirtableError`** (Class)
- **File**: `domainErrors.ts:52`
- **Description**: Airtable API error
- **Issues**: None

- **`ValidationError`** (Class)
- **File**: `domainErrors.ts:63`
- **Description**: Validation error
- **Issues**: None

#### `billing/index.ts` (CLI)

- **`main`** (Async function)
- **File**: `billing/index.ts:26`
- **Description**: CLI entry point
- **Inputs**: Command line arguments
- **Outputs**: void
- **Dependencies**: AirtableClient, buildStudentMonth, buildMonthForAllActiveStudents, MissingFieldsError, DuplicateBillingRecordsError
- **Issues**: 
- Dry run not implemented (lines 77, 114)
- Validation command not implemented (line 162)

- **`getArg`** (Internal function)
- **File**: `billing/index.ts:17`
- **Description**: Gets command line argument value
- **Inputs**: `flag: string`
- **Outputs**: `string | null`
- **Dependencies**: None
- **Issues**: None

- **`hasFlag`** (Internal function)
- **File**: `billing/index.ts:22`
- **Description**: Checks if command line flag exists
- **Inputs**: `flag: string`
- **Outputs**: `boolean`
- **Dependencies**: None
- **Issues**: None

#### `billing/airtableClient.ts`

- **`AirtableClient`** (Class) - Similar to `services/airtableClient.ts` but for Node.js
- **File**: `billing/airtableClient.ts:81`
- **Description**: Airtable client for billing engine
- **Issues**: 
- ⚠️ **DUPLICATE**: Very similar to services/airtableClient.ts
- Environment variable access tries both process.env and import.meta.env (lines 13-31)
- Has `listRecords` method with pagination (services version doesn't)

### Contracts (`contracts/` directory)

#### `contracts/types.ts`

- Type definitions only - no functions

#### `contracts/validators.ts`

- **`validateStudentsFields`** (Exported function)
- **File**: `validators.ts:78`
- **Description**: Validates Students table fields
- **Inputs**: `fields: any`
- **Outputs**: `ValidationResult<StudentsAirtableFields>`
- **Dependencies**: Type guards (isString, isNumber, etc.)
- **Issues**: None

- **`validateLessonsFields`** (Exported function)
- **File**: `validators.ts:158`
- **Description**: Validates Lessons table fields
- **Inputs**: `fields: any`
- **Outputs**: `ValidationResult<LessonsAirtableFields>`
- **Dependencies**: Type guards
- **Issues**: None

- **`validateCancellationsFields`** (Exported function)
- **File**: `validators.ts:314`
- **Description**: Validates Cancellations table fields
- **Inputs**: `fields: any`
- **Outputs**: `ValidationResult<CancellationsAirtableFields>`
- **Dependencies**: Type guards
- **Issues**: None

- **`validateSubscriptionsFields`** (Exported function)
- **File**: `validators.ts:448`
- **Description**: Validates Subscriptions table fields
- **Inputs**: `fields: any`
- **Outputs**: `ValidationResult<SubscriptionsAirtableFields>`
- **Dependencies**: Type guards
- **Issues**: None

- **`validateBillingFields`** (Exported function)
- **File**: `validators.ts:558`
- **Description**: Validates Billing table fields
- **Inputs**: `fields: any`
- **Outputs**: `ValidationResult<BillingAirtableFields>`
- **Dependencies**: Type guards
- **Issues**: None

#### `contracts/fieldMap.ts`

- **`toCamelCase`** (Exported function)
- **File**: `fieldMap.ts:120`
- **Description**: Converts Airtable field name to camelCase
- **Inputs**: `table: string`, `fieldName: string`
- **Outputs**: `string | null`
- **Dependencies**: Field maps
- **Issues**: None

- **`fromCamelCase`** (Exported function)
- **File**: `fieldMap.ts:143`
- **Description**: Converts camelCase back to Airtable field name
- **Inputs**: `table: string`, `camelCaseKey: string`
- **Outputs**: `string | null`
- **Dependencies**: Field maps
- **Issues**: None

- **`transformToCamelCase`** (Exported function)
- **File**: `fieldMap.ts:163`
- **Description**: Transforms Airtable record to camelCase object
- **Inputs**: `table: string`, `fields: T`
- **Outputs**: `Record<string, any>`
- **Dependencies**: toCamelCase
- **Issues**: Warns on unknown fields but preserves them

- **`transformFromCamelCase`** (Exported function)
- **File**: `fieldMap.ts:186`
- **Description**: Transforms camelCase object back to Airtable fields
- **Inputs**: `table: string`, `camelCaseObj: T`
- **Outputs**: `Record<string, any>`
- **Dependencies**: fromCamelCase
- **Issues**: Skips unknown keys with warning

### Hooks

#### `hooks/useStudents.ts`

- **`useStudents`** (Exported React hook)
- **File**: `useStudents.ts:31`
- **Description**: Centralized hook for managing student data with caching
- **Inputs**: `options: UseStudentsOptions = {}`
- **Outputs**: `UseStudentsReturn`
- **Dependencies**: nexusApi.getStudents
- **Issues**: 
- Global cache shared across instances (lines 21-24)
- Cache duration hardcoded (5 minutes)
- Only fetches first page (100 records) - may miss students

- **`loadStudents`** (Internal async function via useCallback)
- **File**: `useStudents.ts:39`
- **Description**: Loads students from cache or Airtable
- **Issues**: Cache invalidation logic

- **`searchStudents`** (Internal async function via useCallback)
- **File**: `useStudents.ts:102`
- **Description**: Searches students locally from cache
- **Issues**: Requires cache to be loaded first

- **`refreshStudents`** (Internal async function via useCallback)
- **File**: `useStudents.ts:136`
- **Description**: Refreshes students bypassing cache
- **Issues**: None

- **`getStudentById`** (Internal function via useCallback)
- **File**: `useStudents.ts:143`
- **Description**: Gets student by ID from cache
- **Issues**: None

### Components

#### `components/Calendar.tsx`

- **`Calendar`** (React Component)
- **File**: `Calendar.tsx:12`
- **Description**: Main calendar component for lesson management
- **State Management**: Multiple useState hooks
- **Dependencies**: nexusApi, LessonDetailsModal, StudentPicker, StudentsPicker
- **Issues**: 
- Complex state management (20+ state variables)
- Conflict checking logic (lines 88-151) - debounced but may miss rapid changes
- Legacy conflict check (lines 154-164) - client-side only, may be inaccurate
- Student ID validation (lines 176-180) - good
- Extensive debug logging in handleSave (lines 213-221)

- **`checkConflicts`** (Internal async function via useCallback)
- **File**: `Calendar.tsx:88`
- **Description**: Checks for lesson conflicts using API
- **Inputs**: `date: string`, `startTime: string`, `duration: number`, `studentId?: string`, `teacherId?: string`, `excludeLessonId?: string`
- **Outputs**: void (sets conflicts state)
- **Dependencies**: nexusApi.checkLessonConflicts
- **Issues**: None

- **`checkConflict`** (Internal function)
- **File**: `Calendar.tsx:154`
- **Description**: Legacy client-side conflict check
- **Inputs**: `date: string`, `startTime: string`, `duration: number`, `excludeId?: string`
- **Outputs**: `boolean`
- **Dependencies**: lessons state
- **Issues**: ⚠️ **UNUSED**: Not called anywhere, dead code

- **`handleSave`** (Internal async function)
- **File**: `Calendar.tsx:166`
- **Description**: Saves lesson (create or update)
- **Inputs**: None (uses state)
- **Outputs**: void
- **Dependencies**: nexusApi.createLesson, nexusApi.updateLesson, nexusApi.getLessons
- **Issues**: 
- Student ID validation (good)
- Conflict check before save (good)
- Refreshes all lessons after create (inefficient)

- **`handleCancel`** (Internal async function)
- **File**: `Calendar.tsx:260`
- **Description**: Cancels lesson
- **Inputs**: None (uses state)
- **Outputs**: void
- **Dependencies**: nexusApi.updateLesson
- **Issues**: None

- **`handleSlotClick`** (Internal function)
- **File**: `Calendar.tsx:275`
- **Description**: Handles calendar slot click to create lesson
- **Inputs**: `date: Date`, `hour: number`
- **Outputs**: void
- **Dependencies**: None
- **Issues**: None

- **`navigate`** (Internal function)
- **File**: `Calendar.tsx:295`
- **Description**: Navigates calendar view
- **Inputs**: `direction: number`
- **Outputs**: void
- **Dependencies**: None
- **Issues**: None

#### `components/Billing.tsx`

- **`Billing`** (React Component)
- **File**: `Billing.tsx:6`
- **Description**: Billing management component
- **Dependencies**: nexusApi.getMonthlyBills
- **Issues**: 
- "צור חיובים חודשיים" button (line 129) - no onClick handler, not functional

- **`loadBills`** (Internal async function)
- **File**: `Billing.tsx:18`
- **Description**: Loads monthly bills
- **Inputs**: None (uses state)
- **Outputs**: void
- **Dependencies**: nexusApi.getMonthlyBills
- **Issues**: Falls back to empty array on error

- **`getStatusBadge`** (Internal function)
- **File**: `Billing.tsx:58`
- **Description**: Returns status badge JSX
- **Inputs**: `status: string`
- **Outputs**: JSX
- **Dependencies**: None
- **Issues**: None

#### `components/Subscriptions.tsx`

- **`Subscriptions`** (React Component)
- **File**: `Subscriptions.tsx:10`
- **Description**: Subscription management component
- **Dependencies**: subscriptionsService, useStudents, StudentPicker, Toast
- **Issues**: None critical

- **`resolveStudentName`** (Internal function)
- **File**: `Subscriptions.tsx:62`
- **Description**: Resolves student name from subscription
- **Inputs**: `subscription: Subscription`
- **Outputs**: `string`
- **Dependencies**: studentsByIdMap, getStudentById
- **Issues**: Complex fallback logic (lines 64-100)

- **`loadSubscriptions`** (Internal async function)
- **File**: `Subscriptions.tsx:102`
- **Description**: Loads subscriptions from Airtable
- **Inputs**: None
- **Outputs**: void
- **Dependencies**: subscriptionsService.listSubscriptions
- **Issues**: None

- **`getSubscriptionStatus`** (Internal function)
- **File**: `Subscriptions.tsx:116`
- **Description**: Calculates subscription status
- **Inputs**: `subscription: Subscription`
- **Outputs**: `SubscriptionStatus`
- **Dependencies**: None
- **Issues**: Complex date logic (lines 116-173)

- **`handleCreate`** (Internal function)
- **File**: `Subscriptions.tsx:308`
- **Description**: Opens create subscription modal
- **Issues**: None

- **`handleEdit`** (Internal function)
- **File**: `Subscriptions.tsx:323`
- **Description**: Opens edit subscription modal
- **Issues**: None

- **`validateMonthlyAmount`** (Internal function)
- **File**: `Subscriptions.tsx:347`
- **Description**: Validates monthly amount format
- **Inputs**: `amount: string`
- **Outputs**: `boolean`
- **Dependencies**: parseMonthlyAmount
- **Issues**: None

- **`handleSave`** (Internal async function)
- **File**: `Subscriptions.tsx:353`
- **Description**: Saves subscription (create or update)
- **Inputs**: None (uses state)
- **Outputs**: void
- **Dependencies**: subscriptionsService.createSubscription, subscriptionsService.updateSubscription
- **Issues**: None

- **`handlePause`** (Internal async function)
- **File**: `Subscriptions.tsx:407`
- **Description**: Pauses subscription
- **Issues**: None

- **`handleResume`** (Internal async function)
- **File**: `Subscriptions.tsx:427`
- **Description**: Resumes subscription
- **Issues**: None

- **`handleEnd`** (Internal async function)
- **File**: `Subscriptions.tsx:446`
- **Description**: Ends subscription
- **Issues**: None

- **`handleSort`** (Internal function)
- **File**: `Subscriptions.tsx:466`
- **Description**: Handles column sorting
- **Issues**: None

- **`formatDate`** (Internal function)
- **File**: `Subscriptions.tsx:475`
- **Description**: Formats date string
- **Issues**: None

#### `components/Homework.tsx`

- **`Homework`** (React Component)
- **File**: `Homework.tsx:8`
- **Description**: Homework management component
- **Dependencies**: nexusApi, useStudents, StudentPicker
- **Issues**: None critical

- **`loadData`** (Internal async function)
- **File**: `Homework.tsx:27`
- **Description**: Loads homework library and assignments
- **Dependencies**: nexusApi.getHomeworkLibrary, nexusApi.getHomeworkAssignments
- **Issues**: None

- **`handleAssign`** (Internal async function)
- **File**: `Homework.tsx:43`
- **Description**: Assigns homework to student
- **Inputs**: `e: React.FormEvent`
- **Outputs**: void
- **Dependencies**: nexusApi.assignHomework
- **Issues**: ⚠️ **BROKEN**: Uses mock API that doesn't persist

- **`getStatusBadge`** (Internal function)
- **File**: `Homework.tsx:69`
- **Description**: Returns status badge JSX
- **Issues**: None

#### `components/Students.tsx`

- **`Students`** (React Component)
- **File**: `Students.tsx:6`
- **Description**: Student directory component
- **Dependencies**: nexusApi.getStudents
- **Issues**: 
- "הוסף תלמיד חדש" button (line 70) - no onClick handler, not functional
- Profile tabs 'history' and 'tests' not implemented (line 169)

- **`loadData`** (Internal async function)
- **File**: `Students.tsx:17`
- **Description**: Loads students
- **Dependencies**: nexusApi.getStudents
- **Issues**: None

- **`getStatusBadge`** (Internal function)
- **File**: `Students.tsx:37`
- **Description**: Returns status badge JSX
- **Issues**: None

#### `components/Dashboard.tsx`

- **`Dashboard`** (React Component)
- **File**: `Dashboard.tsx:4`
- **Description**: Dashboard with KPIs and charts
- **Dependencies**: None (static data)
- **Issues**: 
- ⚠️ **BROKEN**: All data is hardcoded (lines 5-16)
- No real data integration
- Charts are static

#### `components/LessonDetailsModal.tsx`

- **`LessonDetailsModal`** (React Component)
- **File**: `LessonDetailsModal.tsx:30`
- **Description**: Displays lesson details from Airtable record
- **Dependencies**: AIRTABLE_CONFIG
- **Issues**: 
- Tries to access fields that may not exist (lines 113-116)
- Field name fallbacks (lines 105-108)

- **`formatHebrewDate`** (Internal function)
- **File**: `LessonDetailsModal.tsx:36`
- **Description**: Formats date in Hebrew
- **Issues**: None

- **`formatTimeRange`** (Internal function)
- **File**: `LessonDetailsModal.tsx:52`
- **Description**: Formats time range
- **Issues**: None

- **`getStatusColor`** (Internal function)
- **File**: `LessonDetailsModal.tsx:70`
- **Description**: Gets status color class
- **Issues**: None

#### `components/StudentPicker.tsx`

- **`StudentPicker`** (React Component)
- **File**: `StudentPicker.tsx:20`
- **Description**: Searchable student picker with autocomplete
- **Dependencies**: useStudents
- **Issues**: None

- **`performSearch`** (Internal async function via useCallback)
- **File**: `StudentPicker.tsx:40`
- **Description**: Performs debounced student search
- **Dependencies**: useStudents.searchStudents
- **Issues**: None

- **`handleSelect`** (Internal function)
- **File**: `StudentPicker.tsx:99`
- **Description**: Handles student selection
- **Issues**: None

- **`handleClear`** (Internal function)
- **File**: `StudentPicker.tsx:106`
- **Description**: Clears selection
- **Issues**: None

- **`handleKeyDown`** (Internal function)
- **File**: `StudentPicker.tsx:113`
- **Description**: Handles keyboard navigation
- **Issues**: None

#### `components/StudentsPicker.tsx`

- **`StudentsPicker`** (React Component)
- **File**: `StudentsPicker.tsx:20`
- **Description**: Multi-select student picker
- **Dependencies**: useStudents
- **Issues**: None

- Similar functions to StudentPicker but for multi-select

#### `components/StudentSearchAutocomplete.tsx`

- **`StudentSearchAutocomplete`** (React Component)
- **File**: `StudentSearchAutocomplete.tsx:14`
- **Description**: Student search autocomplete (alternative implementation)
- **Dependencies**: nexusApi.searchStudents
- **Issues**: 
- ⚠️ **DUPLICATE**: Very similar to StudentPicker
- Uses nexusApi.searchStudents directly instead of useStudents hook

#### `components/Availability.tsx`

- **`Availability`** (React Component)
- **File**: `Availability.tsx:8`
- **Description**: Availability management component
- **Dependencies**: nexusApi.getWeeklySlots, nexusApi.updateWeeklySlot
- **Issues**: 
- ⚠️ **BROKEN**: Uses mock API (getWeeklySlots, updateWeeklySlot)
- Changes don't persist
- Exceptions tab not implemented (line 136)

- **`loadData`** (Internal async function)
- **File**: `Availability.tsx:19`
- **Description**: Loads weekly slots
- **Dependencies**: nexusApi.getWeeklySlots
- **Issues**: Uses mock data

- **`handleToggleStatus`** (Internal function)
- **File**: `Availability.tsx:31`
- **Description**: Toggles slot status
- **Issues**: Updates local state only, doesn't call API

- **`handleDelete`** (Internal function)
- **File**: `Availability.tsx:37`
- **Description**: Deletes slot
- **Issues**: Updates local state only, doesn't call API

#### `components/Inbox.tsx`

- **`Inbox`** (React Component)
- **File**: `Inbox.tsx:8`
- **Description**: Inbox for pending tasks
- **Dependencies**: nexusApi.getLessons, nexusApi.getSystemErrors, nexusApi.updateLesson
- **Issues**: 
- Uses mock system errors
- Billing queue logic (line 39) may not work correctly

- **`loadData`** (Internal async function)
- **File**: `Inbox.tsx:20`
- **Description**: Loads lessons and errors
- **Dependencies**: nexusApi.getLessons, nexusApi.getSystemErrors
- **Issues**: Date range uses same date for start and end (line 24)

- **`handleAction`** (Internal async function)
- **File**: `Inbox.tsx:43`
- **Description**: Handles action on inbox item
- **Dependencies**: nexusApi.updateLesson
- **Issues**: None

#### `components/ErrorCenter.tsx`

- **`ErrorCenter`** (React Component)
- **File**: `ErrorCenter.tsx:6`
- **Description**: System error monitoring center
- **Dependencies**: nexusApi.getSystemErrors
- **Issues**: 
- ⚠️ **BROKEN**: Uses mock data (lines 22-26)
- "נסה להפעיל מחדש" button (line 175) - no onClick handler

- **`loadErrors`** (Internal async function)
- **File**: `ErrorCenter.tsx:16`
- **Description**: Loads system errors
- **Dependencies**: nexusApi.getSystemErrors
- **Issues**: Falls back to mock data if empty

- **`getSeverity`** (Internal function)
- **File**: `ErrorCenter.tsx:41`
- **Description**: Determines error severity
- **Issues**: None

- **`copyToClipboard`** (Internal function)
- **File**: `ErrorCenter.tsx:47`
- **Description**: Copies text to clipboard
- **Issues**: Uses alert() for feedback - not user-friendly

#### `components/Layout.tsx`

- **`Layout`** (React Component)
- **File**: `Layout.tsx:23`
- **Description**: Main layout with sidebar navigation
- **Dependencies**: None
- **Issues**: None

- **`SidebarContent`** (Internal function component)
- **File**: `Layout.tsx:36`
- **Description**: Renders sidebar navigation
- **Issues**: None

#### `components/Toast.tsx`

- **`Toast`** (React Component)
- **File**: `Toast.tsx:13`
- **Description**: Toast notification component
- **Dependencies**: None
- **Issues**: None

## Section 2: Per-Function Analysis & Issues

### Critical Issues Found

1. **Date Filtering Disabled in getLessons** (`nexusApi.ts:369-383`)

- Date range filtering is commented out
- Fetches ALL lessons regardless of date range
- Performance and data accuracy issues

2. **Extensive Debug Logging in Production Code**

- `nexusApi.getLessons` (lines 412-519): Field discovery logging
- `nexusApi.createLesson` (lines 1114-1320): Step-by-step debug logs
- `billingService.getChargesReport` (lines 1549-1655): Debug logging
- Should be gated behind `import.meta.env.DEV` or removed

3. **Timezone Issues**

- `billingRules.getMonthBoundaries` uses local time, not Asia/Jerusalem
- May cause incorrect month boundary calculations
- Comment suggests using date-fns-tz but not implemented

4. **Duplicate Code**

- `airtableRequest` duplicated in `nexusApi.ts` and `subscriptionsService.ts`
- `parseMonthlyAmount` duplicated in 3 places
- `generateBillingKey` duplicated in 2 places
- `AirtableClient` similar implementations in `services/` and `billing/`

5. **Field Name Uncertainty**

- Multiple fallback field names throughout codebase
- Suggests Airtable schema is not well-documented
- Field discovery logic uses heuristics

6. **Missing Error Handling**

- Many async functions don't catch errors
- Some functions throw errors that aren't handled by callers
- Network errors may not be properly surfaced

7. **Unreachable Code**

- `Calendar.checkConflict` (line 154) - never called
- Legacy client-side conflict check

8. **Promise Not Awaited**

- None found (TypeScript would catch this)

9. **Incorrect Types**

- `pauseDate` set to `null` in `resumeSubscription` but type expects string
- Some `any` types used where specific types would be better

10. **Side Effects Not Documented**

- Global cache in `useStudents` (lines 21-24) - shared state
- Raw records attached to array in `getLessons` (line 532) - non-standard

## Section 3: Broken / Non-Working Functions

### Functions That Return Mock Data (Not Connected to Airtable)

1. **`nexusApi.getWeeklySlots`** (`nexusApi.ts:537`)

- Returns hardcoded mock data
- Not connected to Airtable
- Used by Availability component

2. **`nexusApi.getSlotInventory`** (`nexusApi.ts:546`)

- Returns hardcoded mock data
- Not connected to Airtable

3. **`nexusApi.updateWeeklySlot`** (`nexusApi.ts:555`)

- Mock update only
- Doesn't persist changes

4. **`nexusApi.updateSlotInventory`** (`nexusApi.ts:560`)

- Mock update only
- Doesn't persist changes

5. **`nexusApi.getHomeworkAssignments`** (`nexusApi.ts:590`)

- Returns mock data only
- Not connected to Airtable

6. **`nexusApi.assignHomework`** (`nexusApi.ts:597`)

- Mock assignment only
- Doesn't persist to Airtable

7. **`nexusApi.getSystemErrors`** (`nexusApi.ts:607`)

- Returns mock data only
- Not connected to Airtable

8. **`nexusApi.approveAndSendBill`** (`nexusApi.ts:719`)

- Mock only
- Doesn't update Airtable

9. **`nexusApi.markBillPaid`** (`nexusApi.ts:725`)

- Mock only
- Doesn't update Airtable

### Functions With Critical Logic Issues

1. **`nexusApi.getLessons`** (`nexusApi.ts:352`)

- ⚠️ **CRITICAL**: Date filtering disabled (lines 369-383)
- Fetches ALL lessons regardless of date range parameter
- Performance issue and incorrect data

2. **`billingRules.getMonthBoundaries`** (`billingRules.ts:285`)

- ⚠️ **CRITICAL**: Uses local time instead of Asia/Jerusalem
- May cause incorrect billing month calculations
- DST handling not implemented

3. **`Calendar.checkConflict`** (`Calendar.tsx:154`)

- ⚠️ **DEAD CODE**: Never called
- Legacy implementation

4. **`billing/index.ts main`** (`billing/index.ts:26`)

- Dry run mode not implemented (lines 77, 114)
- Validation command not implemented (line 162)

### UI Components With Non-Functional Features

1. **`Billing` component** (`Billing.tsx:129`)

- "צור חיובים חודשיים" button has no onClick handler

2. **`Students` component** (`Students.tsx:70`)

- "הוסף תלמיד חדש" button has no onClick handler

3. **`Dashboard` component** (`Dashboard.tsx`)

- All data is hardcoded
- No real integration

4. **`Availability` component** (`Availability.tsx`)

- Changes don't persist (uses mock API)
- Exceptions tab not implemented

5. **`ErrorCenter` component** (`ErrorCenter.tsx:175`)

- "נסה להפעיל מחדש" button has no onClick handler

6. **`App` component** (`App.tsx:38`)

- Settings tab has hardcoded UI, not functional

## Section 4: Unimplemented or Missing Logic

### Missing Airtable Integrations

1. **Weekly Slots Management**

- No Airtable table integration
- All functions return mock data
- Changes don't persist

2. **Slot Inventory Management**

- No Airtable table integration
- All functions return mock data

3. **Homework Assignments**

- `getHomeworkAssignments` returns mock data
- `assignHomework` doesn't persist to Airtable
- No Airtable table for assignments

4. **System Errors**

- `getSystemErrors` returns mock data
- No Airtable table for error logging

5. **Bill Actions**

- `approveAndSendBill` - mock only
- `markBillPaid` - mock only
- No Airtable updates for bill status changes

### Missing Business Logic

1. **Multi-Student Private Lessons**

- `billingRules.calculateLessonsContribution` (lines 123-133)
- Returns MissingFieldsError - business rule needed
- Options: split evenly, charge per student, or disallow

2. **Overlapping Subscriptions**

- `billingRules.calculateSubscriptionsContribution` (lines 377-399)
- Returns MissingFieldsError - business rule needed
- Options: sum, max, or prioritize by type

3. **Cancellation Charge Determination**

- `billingRules.calculateCancellationAmount` (line 179)
- Returns null if cannot determine
- Should have better fallback logic

### Missing Field Mappings

1. **Lesson Subject Field**

- Commented out in `nexusApi.createLesson` (lines 1277-1282)
- Field name not discovered/mapped

2. **Lesson Type Field**

- Commented out in `nexusApi.createLesson` (lines 1284-1289)
- Field name not discovered/mapped

3. **Unit Price and Line Amount Fields**

- Referenced but may not exist in Airtable
- Used as fallbacks in billing calculations

### Missing Features

1. **Student Creation**

- "הוסף תלמיד חדש" button not functional
- No create student API call

2. **Monthly Bill Generation**

- "צור חיובים חודשיים" button not functional
- No onClick handler

3. **Settings Page**

- Hardcoded UI
- No actual settings management

4. **Dashboard Data**

- All KPIs are hardcoded
- No real data integration

5. **Error Retry**

- "נסה להפעיל מחדש" button not functional
- No retry logic

6. **Availability Exceptions**

- Tab exists but not implemented
- "בקרוב" placeholder

7. **Student Profile Tabs**

- 'history' and 'tests' tabs not implemented
- Only 'overview' works

8. **Dry Run Mode**

- CLI dry run not implemented
- Would be useful for testing

9. **Validation Command**

- CLI validate command not implemented
- Would help verify Airtable setup

### Missing Error Handling

1. **Network Error Recovery**

- Many functions don't handle network failures gracefully
- No retry logic in most places (except AirtableClient)

2. **Airtable API Errors**

- Some functions fall back to mock data on error
- May hide real issues

3. **Validation Errors**

- Some validation errors not properly surfaced to UI
- Missing fields errors may not be user-friendly

## Section 5: Critical Fixes (High Priority)

### 1. Re-enable Date Filtering in getLessons

**File**: `services/nexusApi.ts:369-383`
**Issue**: Date filtering is commented out, fetches all lessons
**Fix**: Uncomment and fix filter formula, ensure proper date format

### 2. Fix Timezone Handling

**File**: `billing/billingRules.ts:285-301`
**Issue**: Uses local time instead of Asia/Jerusalem
**Fix**: Implement proper timezone handling using date-fns-tz or similar

### 3. Remove Debug Logging

**Files**:

- `services/nexusApi.ts:412-519, 1114-1320`
- `services/billingService.ts:1549-1655`
**Issue**: Extensive debug logging in production code
**Fix**: Gate behind `import.meta.env.DEV` or remove

### 4. Implement Missing Airtable Integrations

**Files**: Multiple
**Issue**: Many functions return mock data
**Fix**:

- Create Airtable tables for weekly slots, homework assignments, system errors
- Implement real API calls
- Remove mock data fallbacks

### 5. Fix Duplicate Code

**Files**:

- `services/nexusApi.ts` and `services/subscriptionsService.ts` (airtableRequest)
- Multiple files (parseMonthlyAmount, generateBillingKey)
**Issue**: Code duplication
**Fix**: Extract to shared utilities

### 6. Implement Business Rules

**Files**:

- `billing/billingRules.ts:123-133` (multi-student private lessons)
- `billing/billingRules.ts:377-399` (overlapping subscriptions)
**Issue**: Missing business rules cause MissingFieldsError
**Fix**: Implement business rules or document decision

### 7. Fix Field Name Uncertainty

**Files**: Multiple
**Issue**: Multiple fallback field names suggest schema issues
**Fix**:

- Document exact Airtable field names
- Update config/airtable.ts with correct mappings
- Remove fallback logic

### 8. Implement Missing UI Features

**Files**:

- `components/Billing.tsx:129`
- `components/Students.tsx:70`
- `components/ErrorCenter.tsx:175`
- `components/App.tsx:38`
**Issue**: Buttons/features not functional
**Fix**: Implement onClick handlers and functionality

### 9. Fix Pagination

**Files**:

- `services/airtableClient.ts:187` (getRecords)
- `hooks/useStudents.ts:72` (only fetches first page)
**Issue**: No pagination support or only first page
**Fix**: Implement proper pagination with offset handling

### 10. Remove Dead Code

**File**: `components/Calendar.tsx:154`
**Issue**: checkConflict function never called
**Fix**: Remove or implement if needed

### 11. Fix Error Handling

**Files**: Multiple
**Issue**: Inconsistent error handling
**Fix**:

- Add try-catch blocks where missing
- Surface errors to UI properly
- Don't silently fall back to mock data

### 12. Document Side Effects

**Files**:

- `hooks/useStudents.ts:21-24` (global cache)
- `services/nexusApi.ts:532` (rawRecords attached to array)
**Issue**: Side effects not documented
**Fix**: Document or refactor to be more explicit