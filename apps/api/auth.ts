import { z } from "zod";
import { digest } from "../../packages/core/results.ts";
import { consolidationScope } from "../../packages/contracts/src/consolidation.ts";

const projects = z.array(consolidationScope.shape.projectId).min(1).max(100);
const grants = z.array(z.strictObject({ token: z.string().min(32).max(512), projects })).min(1);

export function apiAuth(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.API_AUTH_MODE ?? "token";
  if (mode === "development") {
    if (env.NODE_ENV === "production")
      throw new Error("Development authentication is disabled in production");
    const allowed = projects.parse(
      (env.API_DEV_PROJECTS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    return {
      localOnly: true,
      authenticate(_authorization: string | undefined, address: string) {
        return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)
          ? [...new Set(allowed)]
          : undefined;
      },
    };
  }
  if (mode !== "token") throw new Error("Invalid API_AUTH_MODE");
  const credentials = grants.parse(JSON.parse(env.API_AUTH_CONFIG ?? "null"));
  const tokens = new Map(
    credentials.map((grant) => [digest(grant.token), [...new Set(grant.projects)]]),
  );
  if (tokens.size !== credentials.length) throw new Error("Duplicate API token");
  return {
    localOnly: false,
    authenticate(authorization: string | undefined, _address: string) {
      const token = /^Bearer ([^\s]{32,512})$/i.exec(authorization ?? "")?.[1];
      return token ? tokens.get(digest(token)) : undefined;
    },
  };
}
