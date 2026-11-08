import { expect, it, vi } from "vitest";
import { scanGmail } from "../../agents/gmail-agent/gmail.ts";

const options = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "refresh",
  limit: 3,
  accountIndex: 2,
};

it("reads only unread inbox metadata and returns only flagged display fields", async () => {
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com") {
      expect(String(init?.body)).toContain("grant_type=refresh_token");
      return Response.json({ access_token: "test" });
    }
    if (url.pathname.endsWith("/messages")) {
      expect(url.searchParams.getAll("labelIds")).toEqual(["INBOX", "UNREAD"]);
      expect(url.searchParams.has("q")).toBe(false);
      return Response.json({
        messages: ["urgent", "ordinary", "important"].map((id) => ({ id })),
        nextPageToken: "more",
      });
    }
    expect(url.searchParams.get("format")).toBe("metadata");
    expect(url.searchParams.getAll("metadataHeaders")).toEqual(["Subject", "From"]);
    const id = url.pathname.split("/").at(-1);
    return Response.json({
      threadId: id,
      internalDate: id === "important" ? "1760000001000" : "1760000000000",
      labelIds: ["UNREAD", "INBOX", ...(id === "important" ? ["IMPORTANT"] : [])],
      snippet: "Body text must never be published",
      payload: {
        headers: [
          { name: "Subject", value: id === "urgent" ? "Action required today" : "Update" },
          { name: "From", value: "Example" },
        ],
      },
    });
  });
  const result = await scanGmail(options, request);
  expect(result.scanned).toBe(3);
  expect(result.moreUnread).toBe(true);
  expect(result.messages.map((message) => message.link)).toEqual([
    "https://mail.google.com/mail/u/2/#all/important",
    "https://mail.google.com/mail/u/2/#all/urgent",
  ]);
  expect(JSON.stringify(result)).not.toContain("Body text");
});

it("fails without exposing OAuth response content", async () => {
  const request = vi.fn<typeof fetch>(async () => new Response("secret details", { status: 400 }));
  await expect(scanGmail(options, request)).rejects.toThrow(
    "Gmail authorization failed (HTTP 400)",
  );
  expect(request).toHaveBeenCalledOnce();
});
