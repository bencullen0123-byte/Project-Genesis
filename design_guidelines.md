# Design Guidelines: The Citadel - Stripe Recovery Engine

## Design Approach: Utility-First System Dashboard

**Selected Approach:** Fluent Design System (Microsoft) - optimized for data-dense enterprise applications with focus on clarity and efficiency.

**Rationale:** This is a headless backend system requiring minimal operational interfaces for merchant onboarding, system monitoring, and metrics visualization. Design prioritizes information density, rapid comprehension, and operational efficiency over aesthetic flourishes.

---

## Core Design Principles

1. **Data First:** Every pixel serves the purpose of conveying system state or actionable information
2. **Operational Clarity:** Status indicators, metrics, and queue states are immediately scannable
3. **Trust & Professionalism:** Handling financial data requires a polished, reliable appearance
4. **Minimal Distraction:** No animations except loading states and status transitions

---

## Typography System

**Font Stack:** Inter (Google Fonts) - exceptional readability for data-dense interfaces

- **Headers:** 600 weight, sizes: text-2xl (dashboard titles), text-xl (section headers), text-lg (card headers)
- **Body Text:** 400 weight, text-base for descriptions, text-sm for labels/metadata
- **Data Values:** 500 weight, text-lg for primary metrics, text-base for secondary stats
- **Monospace (for IDs/timestamps):** JetBrains Mono, text-sm, 400 weight

---

## Layout System

**Spacing Units:** Tailwind primitives of 4, 6, and 8 (p-4, gap-6, mb-8)

**Grid Structure:**
- Dashboard: Two-column layout (sidebar navigation + main content area)
- Metrics Cards: 3-column grid on desktop (grid-cols-3), 1-column on mobile
- Data Tables: Full-width with horizontal scroll on mobile
- Container Max-Width: max-w-7xl for main content

**Viewport Strategy:**
- No forced viewport heights - natural content flow
- Sticky sidebar navigation (fixed positioning)
- Main content area scrolls independently

---

## Component Library

### 1. Navigation
**Sidebar (Fixed Left):**
- Width: 64 (w-64)
- Logo/brand at top (h-16)
- Navigation links with icons (Heroicons - use CDN)
- Active state: subtle background treatment
- Merchant switcher dropdown at bottom

### 2. Dashboard Metrics Cards
**Layout:** Grid of stat cards showing key metrics
- Card structure: Metric label + Large value + Trend indicator + Sparkline placeholder
- Height: min-h-32
- Padding: p-6
- Border radius: rounded-lg
- Include: Total Recovered, Active Merchants, Pending Tasks, Success Rate

### 3. Data Tables
**Structure:** Striped rows for better scannability
- Headers: Sticky (sticky top-0), text-sm, 600 weight
- Row height: h-12
- Cell padding: px-4 py-3
- Status badges: Inline pill-shaped indicators (pending/running/completed/failed)
- Action column: Icon buttons for details/retry

**Key Tables:**
- Scheduled Tasks Queue (task_type, merchant, status, run_at, actions)
- Recent Merchants (company name, tier, connected date, status)
- Processing Events (event_id, type, processed_at)

### 4. Forms (Merchant Onboarding)
**OAuth Flow Interface:**
- Centered card layout (max-w-md mx-auto)
- Stripe Connect button (use official Stripe button styling)
- Step indicator for multi-step flows
- Form inputs: h-10, px-3, rounded-md
- Label placement: Above inputs with mb-2

### 5. Status Indicators
**System Health Dashboard:**
- Color-coded status dots (• Live indicator pattern)
- Queue depth gauge (visual bar with numerical value)
- Processing rate graph (simple line chart placeholder)
- Last processed timestamp

### 6. Modals/Overlays
**Task Detail Modal:**
- Overlay: Semi-transparent backdrop
- Content: max-w-2xl centered card
- Structure: Header with close button + JSON payload viewer + Action buttons
- Payload display: Monospace font, scrollable container

---

## Page Structures

### Admin Dashboard (Primary Interface)
**Layout:**
```
[Sidebar Navigation]  [Main Content Area]
                      - Page Header (title + time range selector)
                      - Metrics Grid (4 key stats)
                      - Queue Status Table
                      - Recent Activity Feed
```

### Merchant Onboarding
**Flow:** Single-page centered card
- Welcome message + value proposition (2-3 sentences)
- "Connect with Stripe" OAuth button
- Terms agreement checkbox
- Footer with support link

### Queue Monitor
**Real-time Task Viewer:**
- Filter bar (by status, merchant, date range)
- Tasks table with auto-refresh indicator
- Batch action toolbar (retry failed, clear completed)
- Pagination controls

---

## Images

**No large hero images required.** This is an operational dashboard system.

**Icon Usage:**
- Heroicons (outline style) via CDN for navigation and actions
- Status icons: Circle indicators with fill states
- Action icons: 20x20px size (w-5 h-5)

---

## Accessibility Standards

- Consistent keyboard navigation across all tables and forms
- ARIA labels for all icon-only buttons
- Focus indicators: 2px outline on all interactive elements
- Form validation: Inline error messages with ARIA live regions
- Table headers: Proper scope attributes for screen readers

---

## Mobile Responsiveness

- Sidebar: Collapses to hamburger menu on mobile (< md breakpoint)
- Metrics cards: Stack to single column
- Tables: Horizontal scroll with sticky first column
- Forms: Full-width on mobile, max-w-md on desktop
- Touch targets: Minimum 44px height for all interactive elements

---

**Key Constraint:** This system prioritizes operational efficiency over visual flair. Every design decision optimizes for rapid information processing by technical users monitoring payment recovery operations.