import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { urgentEmailDigest } from "../../packages/contracts/src/urgent-email.ts";
import { urgencyReason } from "./urgency.ts";

const exec = promisify(execFile);
const response = z.union([
  z.object({ error: z.string() }),
  z.object({
    moreUnread: z.boolean(),
    messages: z
      .array(
        z.object({
          subject: z.string(),
          sender: z.string(),
          receivedAt: z.iso.datetime(),
          messageId: z.string(),
          flagged: z.boolean(),
        }),
      )
      .max(20),
  }),
]);

export function parseMailDigest(raw: string) {
  const result = response.parse(JSON.parse(raw));
  if ("error" in result) throw new Error(result.error);
  const messages = result.messages
    .flatMap((message) => {
      const subject = message.subject.trim().slice(0, 180) || "(No subject)";
      const reason = urgencyReason(
        subject,
        message.flagged ? "This unread message is flagged in Apple Mail." : undefined,
      );
      if (!reason) return [];
      const id = message.messageId.trim().replace(/^<|>$/g, "");
      return [
        {
          subject,
          reason,
          sender: message.sender.trim().slice(0, 180) || "(Unknown sender)",
          receivedAt: message.receivedAt,
          ...(id ? { link: `message://${encodeURIComponent(`<${id}>`)}` } : {}),
        },
      ];
    })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return urgentEmailDigest.parse({
    scanned: result.messages.length,
    moreUnread: result.moreUnread,
    messages,
  });
}

export async function scanAppleMail(address: string, mailboxName: string, limit: number) {
  if (process.platform !== "darwin") throw new Error("Run Apple Mail mode on the macOS host.");
  const script = fileURLToPath(new URL("./read-mail.js", import.meta.url));
  let output: string;
  try {
    const result = await exec(
      "/usr/bin/osascript",
      ["-l", "JavaScript", script, address, mailboxName, String(limit)],
      {
        timeout: 60_000,
        maxBuffer: 256 * 1024,
      },
    );
    output = result.stdout;
  } catch {
    throw new Error(
      "Could not read Apple Mail. Open Mail and allow your terminal to control Mail in Privacy & Security → Automation.",
    );
  }
  return parseMailDigest(output);
}
