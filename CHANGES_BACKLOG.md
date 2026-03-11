# CubeBoxTimer – Daily Improvement Backlog

This file tracks micro UI/UX improvements. The daily cron picks the first 6 uncompleted items, implements each as a separate commit, and marks them done.

## Pending

- [ ] Show solve count next to session name in header dropdown
- [ ] Add ao50/ao100 to Sidebar session stats (currently only shows ao5/ao12)
- [ ] Make inspection overlay non-fullscreen (inline card below timer instead of modal)
- [ ] Add "Undo last solve" button next to SolveList header
- [ ] Add time distribution bar chart tab to Dashboard (histogram of solve times)
- [ ] Add color-coded trend arrow next to ao5 (up/down vs previous ao5)
- [ ] Normalize all padding/gap to 4px grid (audit and fix inconsistent spacing)
- [ ] Add "Export CSV" button in Dashboard Stats tab
- [ ] Show current session best in header (compact stat pill)
- [ ] Add subtle pulse animation to timer when inspection countdown < 3s
- [ ] Add scramble move count display next to scramble string
- [ ] Add a "mean of 3" (mo3) stat to Dashboard alongside ao5
- [ ] Make solve list rows show relative time ("just now", "2m ago") on hover
- [ ] Add a "Session goal" feature: set a target time, solves shown green/red vs goal
- [ ] Add smooth counter animation to stats numbers on update
- [ ] Increase contrast of muted text in dark mode (--text-faint too faint)
- [ ] Add solve comment/note on right-click (contextmenu) for a solve row
- [ ] Add "Best streak" stat: longest streak of solves under personal mean
- [ ] Show rolling improvement %: "You're 4% faster than last week"
- [ ] Add tabIndex and keyboard nav to SolveList (arrow keys to navigate solves)
- [ ] Make scramble string selectable/copyable with one click
- [ ] Add subtle green tint to timer card background when timer is running
- [ ] Add session total time (sum of all solves) to stats
- [ ] Add a "Compare sessions" view in Dashboard (pick 2 sessions side by side)
- [ ] Add minimalist loading skeleton when Firestore is syncing
- [ ] Unify button border-radius to single CSS var --radius-btn
- [ ] Add focus-visible ring to all interactive elements for keyboard accessibility
- [ ] Add scramble type label badge (e.g. "WCA 3×3") near scramble display
- [ ] Add timer hold delay (configurable 0–500ms) like csTimer spacebar hold
- [ ] Add daily solve goal indicator (e.g., "12/20 solves today")
- [ ] Make chart responsive on mobile (currently overflows on small screens)
- [ ] Add cubic-bezier transition to timer digit changes
- [ ] Show standard deviation trend: whether consistency is improving
- [ ] Add color theme selector beyond dark/light (e.g. "Ocean", "Forest")
- [ ] Add a compact mode toggle that hides sidebar and shrinks UI to just timer
- [ ] Add time zone display in Daily tab header
- [ ] Improve mobile tap targets: ensure all buttons ≥ 44px touch area
- [ ] Add a confetti burst effect when user beats their personal best
- [ ] Add "current session duration" timer in sidebar (time since first solve)
- [ ] Add a "practice mode" banner when not logged in
- [ ] Add print/share button to Daily stats tab
- [ ] Add "recent sessions" quick-switch tooltip on session name hover
- [ ] Improve empty state when session has no solves (friendly illustration or message)
- [ ] Add solve number badge on SolveList rows that are PB (personal best)

## Completed

- [x] Fix hardcoded colors in InspectionTimer (#fff, #1a73e8, #e53935) → use CSS vars
- [x] Fix hardcoded colors in Daily tab header (#555, #e0e0e0) → use CSS vars
- [x] Add "Copy scramble" icon button next to scramble string in Header
- [x] Add subtle fade-in animation when a new solve is added to SolveList
- [x] Add keyboard hint text below timer ("Space to start/stop")
- [x] Add "PB!" flash badge on timer display when a new personal best is set
