import "../../packages/core/load-env.ts";
import { homedir } from "node:os";
import { z } from "zod";
import { publishResult } from "../../packages/messaging/results.ts";
import { scanMachine } from "./scan.ts";

if (process.platform !== "darwin")
  throw new Error("Run the machine review agent on the macOS host.");
const folders = z
  .array(z.string().trim().min(1))
  .min(1)
  .max(10)
  .parse(
    process.env.MACHINE_SCAN_FOLDERS
      ? JSON.parse(process.env.MACHINE_SCAN_FOLDERS)
      : ["Downloads", "Desktop", "Applications"],
  );
const olderThanDays = z.coerce
  .number()
  .int()
  .min(1)
  .max(3650)
  .parse(process.env.MACHINE_SCAN_OLDER_DAYS ?? 90);
const maxEntries = z.coerce
  .number()
  .int()
  .min(1)
  .max(5000)
  .parse(process.env.MACHINE_SCAN_MAX_ENTRIES ?? 1000);
const digest = await scanMachine({ home: homedir(), folders, olderThanDays, maxEntries });
await publishResult(
  "machine-review",
  `${digest.findings.length} review candidates across ${digest.inspected} inspected entries`,
  digest,
  [],
  {
    projectId: "machine",
    topic: "file-review",
    correlationId: "macos",
    includeInConsolidation: false,
  },
);
