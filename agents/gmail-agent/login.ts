import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { exchangeGmailToken } from "./gmail.ts";

export async function signInToGmail(options: {
  clientId: string;
  clientSecret?: string;
  showLogin?: (url: URL) => void;
  request?: typeof fetch;
}) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  // Attach a rejection handler before any callback or timeout can fire.
  void promise.catch(() => {});
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Connection", "close");
    if (
      request.method !== "GET" ||
      url.pathname !== "/gmail/callback" ||
      url.searchParams.get("state") !== state
    ) {
      response.writeHead(400).end("Invalid Gmail sign-in callback.");
      return;
    }
    const code = url.searchParams.get("code");
    if (url.searchParams.has("error") || !code) {
      response.writeHead(400).end("Gmail consent was cancelled or denied. Return to the terminal.");
      reject(new Error("Gmail consent was cancelled or denied."));
      return;
    }
    response.end("Google sign-in complete. You can close this tab and return to the terminal.");
    resolve(code);
  });
  try {
    await new Promise<void>((ready, fail) => {
      server.once("error", fail);
      server.listen(0, "127.0.0.1", ready);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Gmail loopback listener failed");
    const redirectUri = `http://127.0.0.1:${address.port}/gmail/callback`;
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/gmail.metadata",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      prompt: "select_account",
    }).toString();
    const timeout = setTimeout(() => reject(new Error("Gmail sign-in timed out.")), 180_000);
    try {
      if (options.showLogin) options.showLogin(url);
      else {
        console.log(`Sign in to Gmail in your browser. If it doesn't open, use this URL:\n${url}`);
        if (process.platform === "darwin") execFile("/usr/bin/open", [url.href], () => {});
        else if (process.platform === "linux") execFile("xdg-open", [url.href], () => {});
      }
      const code = await promise;
      const params = new URLSearchParams({
        client_id: options.clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      if (options.clientSecret) params.set("client_secret", options.clientSecret);
      return await exchangeGmailToken(params, options.request);
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    server.close();
    server.closeAllConnections();
  }
}
