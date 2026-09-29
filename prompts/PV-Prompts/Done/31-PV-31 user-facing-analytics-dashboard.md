The two existing prompts are too narrow for what you’re actually trying to build. PV15 currently only tracks whether dictionary terms appear and stores `times observed / last observed`, while PV16 is focused specifically on explicit correction learning. :chatgpt-content-reference{index="0"} :chatgpt-content-reference{index="1"}

I’d turn this into a broader **Personal Analytics → Personal Insights** system. The analytics page becomes a real product area that keeps getting smarter as Personal Voice learns how the user works.

### Stronger Cursor prompt

```md
# Personal Voice — User Analytics Dashboard Foundation

We are building a real **user-facing analytics and personal insights area** inside Personal Voice.

This is NOT meant to be a developer telemetry dashboard.

The purpose of this feature is to give the user a place where they can understand:

- how much they use Personal Voice
- how they use it
- which devices they use
- which workflows they rely on
- which words and terminology matter to them
- which shortcuts and features they naturally prefer
- eventually, what Personal Voice has learned about the way they work

Think of this as the beginning of a **personal usage profile** for the user.

The page should feel useful and interesting enough that a user occasionally opens it just to learn something about themselves.

Before changing anything:

1. Read `AGENTS.md`.
2. Inspect the existing Personal Voice analytics/usage instrumentation.
3. Inspect dictation history, dictionary usage, device records, keybindings, destinations, notes, handoffs, and current sync architecture.
4. Reuse existing events/data whenever possible.
5. Do not create duplicate telemetry systems.
6. Do not store microphone audio.
7. Do not unnecessarily store transcript content just for analytics.

---

# GOAL

Create a new **Analytics / Insights dashboard** in Personal Voice.

This should become the central place for understanding how the user uses the application.

The dashboard should initially be based on deterministic structured data.

Do NOT introduce an AI-generated personality/profile yet.

We are building the data foundation first so smarter insights can be added later.

---

# CORE ANALYTICS

## 1. Word Usage

Show meaningful speech usage statistics such as:

- total words dictated
- words dictated today
- words dictated this week
- words dictated this month
- average words per dictation
- longest dictation
- number of dictations

If we already track enough information to estimate speaking time, also show:

- total time spent dictating
- average dictation duration

Do not manufacture values we cannot reliably measure.

---

## 2. Dictionary Usage

Expand the existing dictionary usage concept into something useful for the user.

For each custom dictionary term, track:

- times observed
- last observed
- first observed if practical
- most frequently used terms
- terms never used
- terms used recently

Show useful dashboard information such as:

```text
Most Used Dictionary Terms

Persyn        84 uses
UFIQ          61 uses
Supabase      37 uses
SeaDance      21 uses
```

Do not automatically remove dictionary terms.

This information should help users understand which custom terminology actually matters to them.

---

## 3. Device Usage

Use our existing device identities.

Show:

- which device is used most
- dictation count by device
- word count by device
- percentage of usage by device
- last-used device
- recent device activity

Example:

```text
Your Devices

Desktop       62%
Galaxy        25%
Laptop        13%
```

Use friendly device names where available.

This should work across the user's connected Personal Voice installations.

---

## 4. Keybinding Usage

Track which Personal Voice triggers/actions the user actually uses.

At minimum distinguish:

- Hold to Dictate
- Hold for Voice Note
- Hold for Handoff
- UI button
- Floating control
- other explicit triggers that currently exist

Show:

```text
Most Used Shortcuts

Hold to Dictate       71%
Floating Control      18%
Voice Note Shortcut    8%
Handoff Shortcut       3%
```

This should let us understand how the user naturally prefers to interact with Personal Voice.

Do not record arbitrary keyboard activity.

Only record Personal Voice actions.

---

## 5. Destination Usage

Since Personal Voice now supports different transcript destinations, track how they are used.

Examples:

- Active Field
- Voice Note
- Handoff
- Clipboard
- future destinations

Show both counts and percentage of usage.

Example:

```text
Where Your Voice Goes

Active Field     76%
Voice Notes      16%
Handoffs          8%
```

---

## 6. Feature Usage

Track usage of meaningful Personal Voice features such as:

- Capture Selection
- Voice Notes
- Handoffs
- Dictionary
- Recent Dictation
- Floating Control
- Assistant Mode later
- Screen Context later

Do not track every UI click.

Only track meaningful product actions.

---

## 7. Time Patterns

If timestamps already make this easy and privacy-safe, show patterns like:

- most active day
- most active hour range
- weekday vs weekend use
- recent usage trend

Example:

```text
You use Personal Voice most between 9 AM–12 PM.
```

Do not overbuild this into a giant analytics engine.

Simple aggregation is enough.

---

# DASHBOARD DESIGN

Add a dedicated user-facing Analytics page.

The UI should feel like a modern personal dashboard, not an admin panel.

Keep it compact and visually useful.

Possible layout:

```text
Analytics

┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ 14,284 Words   │ │ 326 Dictations │ │ Desktop 62%    │
│ This Month     │ │ This Month     │ │ Most Used      │
└────────────────┘ └────────────────┘ └────────────────┘

Usage Over Time
[ simple trend visualization ]

Dictionary
[ top terminology ]

Devices
[ device distribution ]

How You Use Personal Voice
[ destination + trigger/keybinding usage ]

Patterns
[ useful deterministic observations ]
```

Do not fill the page with oversized cards.

This app is being intentionally redesigned to be compact and information-dense.

Use concise labels and small visualizations.

---

# PERSONAL INSIGHTS FOUNDATION

This analytics system should be designed so that later we can generate higher-level insights such as:

```text
"You dictate mostly from your desktop."

"You use Personal Voice most heavily in the morning."

"Most of your voice notes are created from your phone."

"You use Persyn-related terminology significantly more than other custom vocabulary."

"You almost always use Hold to Dictate instead of the UI button."

"Your average dictation has become longer over the last month."
```

For THIS phase, generate insights only when they can be derived deterministically from the structured data.

Do not send behavioral data to an LLM yet.

---

# FUTURE USER PROFILE

Design the underlying analytics model so that later we can build a private Personal Voice profile.

Eventually the application may learn things such as:

```text
preferred device
preferred interaction method
common working hours
most-used projects/terminology
average dictation length
common destinations
preferred shortcuts
frequently corrected terms
frequently used applications
voice-note habits
handoff habits
```

This profile could eventually help the Assistant adapt itself to the user.

Do NOT implement the AI profile yet.

Just make sure the analytics data model does not block us from doing this later.

---

# PRIVACY

This is personal analytics for the user, not advertising analytics.

Rules:

- no third-party analytics provider
- no microphone audio storage
- no hidden monitoring
- no arbitrary keyboard tracking
- no unnecessary transcript storage
- user can disable Usage Intelligence
- user can clear analytics data
- telemetry failure must never interfere with dictation
- data stays user-scoped
- use existing Supabase RLS patterns for anything synced

Where aggregated counters are sufficient, prefer them over storing unnecessary raw events.

---

# IMPORTANT ARCHITECTURE RULE

Do not create one database table per metric.

Create a small coherent usage event/aggregation model that future analytics can build upon.

Reuse the usage instrumentation already present in the app.

The dashboard is a VIEW over the user's usage data.

It should not become another parallel system that independently observes the application.

---

# INITIAL INSIGHT IDEAS

In addition to the requested metrics, see if our existing data cleanly supports:

- words saved from typing
- average dictation size
- longest dictation
- number of active days
- current usage streak
- most-used destination
- most-used device
- most-used keybinding
- most-used dictionary group
- percentage of dictations requiring recovery
- percentage of usage coming from floating control
- notes created vs normal dictations
- handoffs sent by device
- usage trend compared with previous week/month

Only implement metrics backed by reliable existing data.

Do not invent estimates merely because they would look interesting.

---

# DEFINITION OF DONE

The user can open the Analytics page and immediately answer:

1. How much am I using Personal Voice?
2. Which device do I use most?
3. What words/terminology do I use most?
4. How do I usually trigger Personal Voice?
5. Where do my transcripts usually go?
6. Which Personal Voice features do I actually use?
7. Are there any obvious patterns in how I use the application?

The underlying system should also provide a clean foundation for a future:

**Personal Insights / Personal Voice Profile**

where the application can begin explaining what it has learned about the user's working habits.

Run the full relevant test suite.

Report:
- existing data reused
- new events introduced
- schema changes
- analytics calculations
- dashboard components
- privacy implications
- what future profile/insight features are now possible

Stop after completing the analytics foundation.
```

A few additional things I think would make this genuinely interesting later are **“words saved from typing,” usage streaks, most productive voice hours, average dictation length over time, which device creates the most notes vs normal dictation, project/dictionary-group usage, and how the user’s behavior changes over time**.

Then I’d make the next phase something much more ambitious than the current PV16: **Personal Insights & User Profile**. That phase would consume this analytics foundation and start producing statements like *“You primarily use Personal Voice as a coding tool from your desktop, but your phone is where most of your voice notes originate.”* That is much closer to the direction you’re describing than simple correction learning.