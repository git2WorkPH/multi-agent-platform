import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { parseMailDigest } from "../../agents/gmail-agent/apple-mail.ts";

it("selects only the configured account and reads bounded unread metadata", () => {
  const source = readFileSync(
    new URL("../../agents/gmail-agent/read-mail.js", import.meta.url),
    "utf8",
  );
  const message = {
    subject: () => "Urgent: review today",
    sender: () => "Example <example@example.test>",
    dateReceived: () => new Date("2026-11-08T00:00:00Z"),
    messageId: () => "<message@example.test>",
    flaggedStatus: () => false,
    content: () => {
      throw new Error("Read message body");
    },
  };
  const accounts = [
    {
      emailAddresses: () => ["other@example.test"],
      mailboxes: () => {
        throw new Error("Read other account");
      },
    },
    {
      emailAddresses: () => ["selected@example.test"],
      mailboxes: () => [
        {
          name: () => "INBOX",
          messages: {
            whose: (filter: { readStatus: boolean }) => {
              expect(filter.readStatus).toBe(false);
              return () => [message, message];
            },
          },
        },
      ],
    },
  ];
  const result = runInNewContext(source + '\nrun(["selected@example.test", "INBOX", "1"])', {
    Application: (name: string) => {
      expect(name).toBe("Mail");
      return { accounts: () => accounts };
    },
  });
  expect(parseMailDigest(result)).toMatchObject({
    scanned: 1,
    moreUnread: true,
    messages: [{ link: "message://%3Cmessage%40example.test%3E" }],
  });
});

it("keeps flagged mail without a Message-ID and omits ordinary mail", () => {
  const entry = {
    subject: "Update",
    sender: "Example",
    receivedAt: "2026-11-08T00:00:00Z",
    messageId: "",
  };
  const result = parseMailDigest(
    JSON.stringify({
      moreUnread: false,
      messages: [
        { ...entry, flagged: true },
        { ...entry, flagged: false },
      ],
    }),
  );
  expect(result.messages).toHaveLength(1);
  expect(result.messages[0]).toMatchObject({
    reason: expect.stringContaining("flagged in Apple Mail"),
  });
  expect(result.messages[0].link).toBeUndefined();
});
