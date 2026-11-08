import "../../packages/core/load-env.ts";
import { z } from "zod";
import { publishResult } from "../../packages/messaging/results.ts";
import { scanGmail } from "./gmail.ts";
import { signInToGmail } from "./login.ts";

const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
if (!GMAIL_CLIENT_ID)
  throw new Error("Set GMAIL_CLIENT_ID in .env using a Google Desktop OAuth client.");
if (GMAIL_REFRESH_TOKEN && !GMAIL_CLIENT_SECRET)
  throw new Error("The existing refresh-token setup requires GMAIL_CLIENT_SECRET.");
const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(20)
  .parse(process.env.GMAIL_SCAN_LIMIT ?? 15);
const accountIndex = z.coerce
  .number()
  .int()
  .min(0)
  .max(99)
  .parse(process.env.GMAIL_ACCOUNT_INDEX ?? 0);
const authorization =
  GMAIL_REFRESH_TOKEN && GMAIL_CLIENT_SECRET
    ? {
        clientId: GMAIL_CLIENT_ID,
        clientSecret: GMAIL_CLIENT_SECRET,
        refreshToken: GMAIL_REFRESH_TOKEN,
      }
    : {
        accessToken: await signInToGmail({
          clientId: GMAIL_CLIENT_ID,
          clientSecret: GMAIL_CLIENT_SECRET,
        }),
      };
const digest = await scanGmail({ ...authorization, limit, accountIndex });
await publishResult(
  "gmail-urgency",
  `${digest.messages.length} flagged out of ${digest.scanned} unread inbox messages checked`,
  digest,
  [],
  {
    projectId: "email",
    topic: "urgent-inbox",
    correlationId: "gmail",
    includeInConsolidation: false,
  },
);
