import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const path = fileURLToPath(new URL("../../.env", import.meta.url));
const { error } = config({ path, quiet: true, override: false });

if (error && (!("code" in error) || error.code !== "ENOENT")) {
  throw new Error("Could not load the workspace .env file", { cause: error });
}
