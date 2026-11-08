# Machine review agent rationale

Add a read-only scanner for selected macOS user folders. Use bounded filesystem metadata checks and report the evidence for cleanup candidates and security signals. Broken links can be checked directly. Application ownership and malware status cannot be inferred from file age or names. Keep findings in a separate local project and out of model prompts.
