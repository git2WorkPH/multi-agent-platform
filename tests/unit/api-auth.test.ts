import { expect, it } from "vitest";
import { apiAuth } from "../../apps/api/auth.ts";

it("requires explicit project grants and rejects development authentication in production", () => {
  expect(() => apiAuth({})).toThrow();
  expect(() =>
    apiAuth({ NODE_ENV: "production", API_AUTH_MODE: "development", API_DEV_PROJECTS: "demo" }),
  ).toThrow(/disabled/);
  const auth = apiAuth({ API_AUTH_MODE: "development", API_DEV_PROJECTS: "demo" });
  expect(auth.authenticate(undefined, "192.0.2.1")).toBeUndefined();
  expect(auth.authenticate(undefined, "127.0.0.1")).toEqual(["demo"]);
});
