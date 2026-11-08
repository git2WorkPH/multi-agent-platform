import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { signInToGmail } from "../../agents/gmail-agent/login.ts";

it("validates the loopback state and exchanges a PKCE code without a secret", async () => {
  let browser: Promise<void> | undefined;
  let login: URL | undefined;
  const request = vi.fn<typeof fetch>(async (endpoint, init) => {
    expect(endpoint).toBe("https://oauth2.googleapis.com/token");
    const params = new URLSearchParams(String(init?.body));
    expect(params.get("code")).toBe("fixture-code");
    expect(params.has("client_secret")).toBe(false);
    expect(createHash("sha256").update(params.get("code_verifier")!).digest("base64url")).toBe(
      login?.searchParams.get("code_challenge"),
    );
    return Response.json({ access_token: "fixture-token" });
  });
  const token = await signInToGmail({
    clientId: "fixture-client",
    request,
    showLogin(url) {
      login = url;
      browser = (async () => {
        const callback = new URL(url.searchParams.get("redirect_uri")!);
        expect(callback.hostname).toBe("127.0.0.1");
        expect(url.searchParams.get("scope")).toBe(
          "https://www.googleapis.com/auth/gmail.metadata",
        );
        callback.searchParams.set("code", "fixture-code");
        callback.searchParams.set("state", "wrong");
        expect((await fetch(callback)).status).toBe(400);
        callback.searchParams.set("state", url.searchParams.get("state")!);
        expect((await fetch(callback)).status).toBe(200);
      })();
      void browser.catch(() => {});
    },
  });
  await browser;
  expect(token).toBe("fixture-token");
  expect(request).toHaveBeenCalledOnce();
});
