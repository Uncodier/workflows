# ICP Mining Workflow - Person to Lead Flow Diagram

## Overview
This diagram shows the complete flow from person discovery to lead creation in the Ideal Client Profile Mining workflow.

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ICP MINING WORKFLOW                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

1. PERSON DISCOVERY
   ┌─────────────────┐
   │ callPersonRole  │ ──► Get persons from Finder API
   │ SearchActivity  │
   └─────────────────┘
           │
           ▼
   ┌─────────────────┐
   │ Extract persons │ ──► Normalize data from search_results
   │ from API        │
   └─────────────────┘
           │
           ▼
   ┌─────────────────┐
   │ For each person │
   │ in results      │
   └─────────────────┘
           │
           ▼

2. PERSON VALIDATION & UPSERT
   ┌─────────────────┐
   │ checkExisting   │ ──► Check if person already exists
   │ PersonActivity  │     (by external_person_id, full_name, company_name)
   └─────────────────┘
           │
           ▼
   ┌─────────────────┐
   │ Person exists?   │
   └─────────────────┘
           │
           ├─ YES ──► Use existing person
           │
           ▼
           NO
           │
           ▼
   ┌─────────────────┐
   │ upsertPerson    │ ──► Create new person record
   │ Activity        │     with role_query_id, external_person_id, etc.
   └─────────────────┘
           │
           ▼

3. EMAIL ENRICHMENT PROCESS
   ┌─────────────────┐
   │ Check existing  │ ──► Use emails from person record
   │ person.emails   │
   └─────────────────┘
           │
           ▼
   ┌─────────────────┐
   │ Has valid       │
   │ emails?         │
   └─────────────────┘
           │
           ├─ YES ──► Use existing emails
           │
           ▼
           NO
           │
           ▼
   ┌─────────────────┐
   │ Extract domain  │ ──► From organization.domain, website, or company name
   │ from company    │
   └─────────────────┘
           │
           ▼
   ┌─────────────────┐
   │ leadContact     │ ──► Generate emails using AI
   │ Generation      │     (name + domain + context)
   │ Activity        │
   └─────────────────┘
           │
           ▼
   ┌─────────────────┐
   │ External        │ ──► Fallback: lookup contacts from external API
   │ Contacts        │     (if AI generation fails)
   │ Lookup          │
   └─────────────────┘
           │
           ▼

4. EMAIL VALIDATION
   ┌─────────────────┐
   │ validateContact │ ──► Validate each generated email
   │ Information     │     (check deliverability, format, etc.)
   └─────────────────┘
           │
           ▼
   ┌─────────────────┐
   │ Valid email     │
   │ found?          │
   └─────────────────┘
           │
           ├─ NO ──► Check if person has phone number
           │
           ▼
           YES
           │
           ▼

4a. CONTACT VALIDATION (if no email)
   ┌─────────────────┐
   │ Check person    │ ──► Check if person has phone number
   │ phone numbers   │
   └─────────────────┘
           │
           ▼
   ┌─────────────────┐
   │ Has phone?      │
   └─────────────────┘
           │
           ├─ NO ──► Skip person (no contact info)
           │
           ▼
           YES
           │
           ▼

5. PERSON EMAIL UPDATE (if email found)
   ┌─────────────────┐
   │ updatePerson    │ ──► Update person.emails with validated email
   │ EmailsActivity  │
   └─────────────────┘
           │
           ▼

6. LEAD EXISTENCE CHECK
   ┌─────────────────┐
   │ checkExisting   │ ──► Check if lead already exists for this person
   │ LeadForPerson   │     (by person_id + site_id)
   │ Activity        │
   └─────────────────┘
           │
           ▼
   ┌─────────────────┐
   │ Lead exists?     │
   └─────────────────┘
           │
           ├─ YES ──► Skip person (already has lead)
           │
           ▼
           NO
           │
           ▼

7. LEAD CREATION
   ┌─────────────────┐
   │ createSingleLead│ ──► Create lead with:
   │ Activity        │     • name, email, company_name, position
   │                 │     • person_id (links to person)
   │                 │     • site_id, user_id
   │                 │     • status: 'new', origin: 'lead_generation_workflow'
   └─────────────────┘
           │
           ▼
   ┌─────────────────┐
   │ Lead created    │ ──► Update progress counters
   │ successfully    │     (processed++, foundMatches++)
   └─────────────────┘

## Key Activities and Their Purposes

### Person Management
- **checkExistingPersonActivity**: Checks if person already exists in database
- **upsertPersonActivity**: Creates or updates person record with external API data
- **updatePersonEmailsActivity**: Updates person's email list with validated emails

### Lead Management  
- **checkExistingLeadForPersonActivity**: Prevents duplicate leads for same person
- **createSingleLead**: Creates lead record with person_id reference

### Email Enrichment
- **leadContactGenerationActivity**: AI-powered email generation from name + domain
- **callPersonContactsLookupActivity**: External API lookup for contact information
- **validateContactInformation**: Validates email deliverability and format

## Data Flow

```
Person Data (from Finder API)
    ↓
Person Record (in database)
    ↓
Email Enrichment (AI + External APIs)
    ↓
Validated Email
    ↓
Check if Lead Already Exists
    ↓
Lead Record (with person_id reference)
```

## Correct Order Logic

**Why Email Enrichment comes BEFORE Lead Existence Check:**

1. **Database Constraint**: The `leads` table requires an email field (NOT NULL constraint)
2. **Business Logic**: Without a valid email, we cannot create a lead
3. **Efficiency**: No point checking for existing leads if we don't have a valid email to create one
4. **Validation**: We need to ensure the email is deliverable before proceeding with lead creation

**Contact Information Validation:**

1. **Email Priority**: Try to get a valid email first (preferred contact method)
2. **Phone Fallback**: If no valid email, check if person has phone number
3. **Skip if No Contact**: If neither email nor phone available, skip the person
4. **Lead Creation**: Create lead with either email OR phone (not both required)

## Database Relationships

```
persons table
    ├── id (primary key)
    ├── external_person_id
    ├── full_name
    ├── company_name
    ├── emails (array)
    └── ... other fields

leads table
    ├── id (primary key)
    ├── name
    ├── email
    ├── person_id (foreign key → persons.id)
    ├── site_id
    └── ... other fields
```

## Error Handling

- **Person creation fails**: Log error, continue with next person
- **Email generation fails**: Try external lookup, then skip if no valid email
- **Lead creation fails**: Log error, update progress with error count
- **Duplicate lead**: Skip creation, log as expected behavior

## Progress Tracking

- **processed**: Total persons processed (regardless of outcome)
- **foundMatches**: Persons with valid emails that became leads
- **totalTargets**: Total available persons from API
- **errors**: Array of error messages for debugging
