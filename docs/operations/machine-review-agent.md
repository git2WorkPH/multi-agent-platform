# macOS machine review agent

1. Start Floci and the result consumer. Add `machine` to `API_DEV_PROJECTS` in your local `.env` and restart the API, or grant `machine` in token mode.
2. From the repository folder on your Mac, run `pnpm agent:machine`.
3. In the dashboard, open **machine → Results → machine-review**. Review each flagged path and its reason.

The default scope is `~/Downloads`, `~/Desktop`, and `~/Applications`. Set `MACHINE_SCAN_FOLDERS` to a JSON array of specific folders inside your home directory to change the scope. The scanner checks at most 1,000 entries by default and stops descending at a bounded depth. Missing folders and permission errors count as skipped. The scan does not descend into app bundles or follow symlinks into directories.

**Cleanup review** includes broken symbolic links and old installers or partial downloads. File age is based on modification time, with a default threshold of 90 days. Files with no obvious relationship to an application can still be useful. The scan does not determine which apps use a file.

**Security review** includes executable extensions disguised by a document or image suffix and executable names with bidirectional display controls. These are filename signals and can produce false positives. This scan does not inspect file contents or verify signatures. macOS Gatekeeper and XProtect provide separate protections. [Apple Platform Security](https://support.apple.com/en-au/guide/security/sec469d47bd8/web)

The agent reads filesystem metadata and publishes a local digest containing relative paths and reasons. It does not open, execute, move, or delete scanned files. The digest is excluded from consolidation and model prompts.
