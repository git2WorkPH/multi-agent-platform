# Machine review agent

Added a read-only macOS scanner for the selected Downloads, Desktop, and user Applications folders. The dashboard separates cleanup candidates from filename signals that warrant security review. Results stay in the machine project and out of consolidation.

ESLint, type checks, the dashboard build, 24 unit tests, and 10 Floci integration tests passed. The macOS CLI also published a digest from an isolated fixture directory and Floci stored it. Personal folders were not scanned during verification.
