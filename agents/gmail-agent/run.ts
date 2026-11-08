import "../../packages/core/load-env.ts";
import { z } from "zod";
import { publishResult } from "../../packages/messaging/results.ts";
import { scanAppleMail } from "./apple-mail.ts";
import { scanGmail } from "./gmail.ts";
import { signInToGmail } from "./login.ts";

const env = process.env;
const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(20)
  .parse(env.GMAIL_SCAN_LIMIT ?? 15);
const source = z
  .enum(["apple-mail", "gmail-api"])
  .parse(
    env.GMAIL_SOURCE ??
      (env.APPLE_MAIL_ACCOUNT || !env.GMAIL_CLIENT_ID ? "apple-mail" : "gmail-api"),
  );

async function scan() {
  if (source === "apple-mail") {
    const address = env.APPLE_MAIL_ACCOUNT?.trim();
    if (!address) throw new Error("Set APPLE_MAIL_ACCOUNT to your Gmail address in .env.");
    return scanAppleMail(address, env.APPLE_MAIL_INBOX?.trim() || "INBOX", limit);
  }
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = env;
  if (!GMAIL_CLIENT_ID) throw new Error("Set GMAIL_CLIENT_ID for Gmail API mode.");
  if (GMAIL_REFRESH_TOKEN && !GMAIL_CLIENT_SECRET)
    throw new Error("The existing refresh-token setup requires GMAIL_CLIENT_SECRET.");
  const accountIndex = z.coerce
    .number()
    .int()
    .min(0)
    .max(99)
    .parse(env.GMAIL_ACCOUNT_INDEX ?? 0);
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
  return scanGmail({ ...authorization, limit, accountIndex });
}

const digest = await scan();
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
