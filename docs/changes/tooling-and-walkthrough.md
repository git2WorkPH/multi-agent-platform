# Tooling and walkthrough verification

Pinned pnpm 12.18.0 in the workspace and CI, regenerated the lockfile, and added ESLint formatting for JavaScript and TypeScript. CI runs the formatting check. The existing bootstrap formatting edit was included in the repository-wide format pass.

On Node 24.22.2 and pnpm 12.18.0, frozen install, ESLint, type checking, and the dashboard build passed. The suite passed 21 unit tests, 9 live Floci tests, and the Playwright end-to-end test.

The README links a captioned recording of the live local stack using the Mock provider. Browser playback verified the 33.88-second recording at 1280 × 800, including automatic and forced report revisions.
