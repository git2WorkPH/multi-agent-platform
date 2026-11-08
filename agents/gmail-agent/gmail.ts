import { urgencyReason } from "./urgency.ts";
import { z } from "zod";
import { urgentEmailDigest } from "../../packages/contracts/src/urgent-email.ts";

const messageId = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const messagesPage = z.object({
  messages: z.array(z.object({ id: messageId })).default([]),
  nextPageToken: z.string().optional(),
});
const metadata = z.object({
  threadId: messageId,
  internalDate: z.string().regex(/^\d+$/),
  labelIds: z.array(z.string()).default([]),
  payload: z
    .object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]) })
    .optional(),
});
const oauthToken = z.object({ access_token: z.string().min(1) });
const messagesUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

export async function exchangeGmailToken(params: URLSearchParams, request = fetch) {
  const response = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: params,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `Gmail authorization failed (HTTP ${response.status}). Check the OAuth client type, credentials, and consent.`,
    );
  return oauthToken.parse(await response.json()).access_token;
}

export async function scanGmail(
  options: { limit: number; accountIndex: number } & (
    { accessToken: string } | { clientId: string; clientSecret: string; refreshToken: string }
  ),
  request = fetch,
) {
  const access_token =
    "accessToken" in options
      ? options.accessToken
      : await exchangeGmailToken(
          new URLSearchParams({
            client_id: options.clientId,
            client_secret: options.clientSecret,
            refresh_token: options.refreshToken,
            grant_type: "refresh_token",
          }),
          request,
        );
  const get = async (url: URL) => {
    const result = await request(url, {
      headers: { Authorization: `Bearer ${access_token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (result.status === 404 && url.pathname !== new URL(messagesUrl).pathname) return undefined;
    if (!result.ok)
      throw new Error(
        `Gmail inbox read failed (HTTP ${result.status}). Check Gmail API access and the metadata scope.`,
      );
    return result.json();
  };
  const ids = new Set<string>();
  let token: string | undefined;
  const seenTokens = new Set<string>();
  do {
    const url = new URL(messagesUrl);
    url.searchParams.append("labelIds", "INBOX");
    url.searchParams.append("labelIds", "UNREAD");
    url.searchParams.set("maxResults", String(options.limit - ids.size));
    if (token) url.searchParams.set("pageToken", token);
    const page = messagesPage.parse(await get(url));
    for (const message of page.messages) ids.add(message.id);
    token = page.nextPageToken;
    if (token && seenTokens.has(token))
      throw new Error("Gmail returned a repeated pagination token");
    if (token) seenTokens.add(token);
  } while (token && ids.size < options.limit && seenTokens.size < options.limit);

  const messages = [];
  let scanned = 0;
  for (const id of [...ids].slice(0, options.limit)) {
    const url = new URL(`${messagesUrl}/${id}`);
    url.searchParams.set("format", "metadata");
    for (const header of ["Subject", "From"]) url.searchParams.append("metadataHeaders", header);
    url.searchParams.set("fields", "threadId,internalDate,labelIds,payload(headers)");
    const raw = await get(url);
    if (raw === undefined) continue;
    const message = metadata.parse(raw);
    if (!message.labelIds.includes("INBOX") || !message.labelIds.includes("UNREAD")) continue;
    scanned++;
    const header = (name: string, fallback: string) =>
      message.payload?.headers
        .find((item) => item.name.toLowerCase() === name)
        ?.value.trim()
        .slice(0, 180) || fallback;
    const subject = header("subject", "(No subject)");
    const sender = header("from", "(Unknown sender)");
    const reason = urgencyReason(
      subject,
      message.labelIds.includes("IMPORTANT")
        ? "Gmail marked this unread message important."
        : undefined,
    );
    if (reason)
      messages.push({
        subject,
        sender,
        receivedAt: new Date(Number(message.internalDate)).toISOString(),
        reason,
        link: `https://mail.google.com/mail/u/${options.accountIndex}/#all/${message.threadId}`,
      });
  }
  messages.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return urgentEmailDigest.parse({
    scanned,
    moreUnread: Boolean(token) || ids.size > options.limit,
    messages,
  });
}
