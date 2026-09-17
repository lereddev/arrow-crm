# Arrow CRM

Shared prospecting workspace for a French sales agency. The primary job is finding
a lead, making contact, recording a separate note and planning a follow-up meeting.
The lead explorer is the home, not a metrics dashboard. Mobile usage matters.

Real customer records live in Supabase, never in public assets. Password login,
active-user verification and existing Postgres RLS remain mandatory. Everyone active
can read shared leads and notes; existing ownership rules still govern writes.

Scope: leads, geographical sectors, combined filters, full lead pages, shared notes,
contact outcomes and agenda. No invented analytics, team admin screen or fabricated
next-action dates. UI deletion of notes is intentionally not exposed in this redesign.
