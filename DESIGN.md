# Arrow design direction

Approved reference: the light lead-management mockup in the project conversation.
Mode: Operate. The user should find a territory, narrow a list and open a lead without
crossing a dashboard. Design guidance: UI/UX Pro Max and Impeccable.

## Tokens
- Font: DM Sans, 400/500/600/700; fallback sans-serif. Google Fonts with display=swap.
- Background #f6f7f9, surface #ffffff, text #182c49, muted #5c697d.
- Accent #1559d6, selected background #eaf2ff, borders #e0e5ed.
- Panel radius 12px, input/button radius 8px; 44px minimum input/action height.
- Space: 4/8/12/16/20/24/36/40px. Text: 12/13/14/15/17/19/34px.
- Semantic badges carry words as well as color. Data is escaped via text nodes.

## Surface
Light sidebar with Leads and Agenda only. Territory controls above full-width search.
Telephone and RDV outcomes are separate filters, and are distinct from imported status.
Additional filters expose exact department and historical status. No charts on entry.
Desktop table becomes stacked records below 800px. Below 520px extra filters collapse
behind a disclosure, preserving search and territory access above the first result.

## Behavior
Filters and pages live in URL parameters. Full-page lead detail preserves the list URL
and has a Societe.com link. Notes are append-only in the interface. Pending saves disable
inputs; failed saves preserve text and retry UUID. Agenda completion is reversible.
Loading skeletons, explicit empty/error/retry states, offline banner and visible focus.
Subtle 150ms control transitions; reduced-motion disables motion. No staged entrance.

## Verification
Screenshots reviewed at 1440px and 375px; browser checks also cover 768px. Test records
are synthetic, kept in scripts and never served as application data. No real write
to customer records is required by the test suite.
