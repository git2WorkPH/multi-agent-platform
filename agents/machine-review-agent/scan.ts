import { lstat, opendir, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { z } from "zod";
import { machineReviewDigest } from "../../packages/contracts/src/machine-review.ts";

type Finding = z.infer<typeof machineReviewDigest>["findings"][number];

const executableSuffix = /\.(?:app|command|sh|pkg|dmg|scpt|workflow|exe|scr|js)$/i;
const disguised =
  /\.(?:pdf|txt|docx?|xlsx?|png|jpe?g)\.(?:app|command|sh|pkg|scpt|workflow|exe|scr|js)$/i;
const installers = new Set([".dmg", ".pkg", ".mpkg"]);
const unfinished = new Set([".download", ".crdownload", ".part"]);

export async function scanMachine(options: {
  home: string;
  folders: readonly string[];
  olderThanDays: number;
  maxEntries: number;
  now?: number;
}) {
  const home = await realpath(options.home);
  const roots = [
    ...new Set(
      options.folders.map((folder) => {
        const target = resolve(home, folder);
        const rel = relative(home, target);
        if (
          !rel ||
          rel === ".." ||
          rel.startsWith(`..${sep}`) ||
          isAbsolute(rel) ||
          rel.split(sep).includes(".git")
        ) {
          throw new Error("Scan folders must be specific locations inside your home directory");
        }
        return target;
      }),
    ),
  ];
  const cutoff = (options.now ?? Date.now()) - options.olderThanDays * 86_400_000;
  const findings: Finding[] = [];
  const visited = new Set<string>();
  let inspected = 0;
  let skipped = 0;
  let truncated = false;

  const report = (category: Finding["category"], path: string, reason: string) => {
    const finding = { category, path: `~/${relative(home, path)}`, reason };
    if (findings.length < 30) findings.push(finding);
    else {
      truncated = true;
      const cleanup = findings.findLastIndex((item) => item.category === "cleanup");
      if (category === "security" && cleanup >= 0) findings.splice(cleanup, 1, finding);
    }
  };
  const code = (error: unknown) =>
    error instanceof Error && "code" in error ? error.code : undefined;

  async function inspect(path: string, depth: number) {
    if (visited.has(path)) return;
    if (inspected >= options.maxEntries) {
      truncated = true;
      return;
    }
    visited.add(path);
    inspected++;
    try {
      const entry = await lstat(path);
      const name = basename(path);
      const ext = extname(name).toLowerCase();
      if (entry.isSymbolicLink()) {
        // Check only target existence. Never enumerate or read through a link.
        try {
          await stat(path);
        } catch (error) {
          if (code(error) === "ENOENT" || code(error) === "ENOTDIR")
            report("cleanup", path, "Symbolic link target could not be found.");
          else skipped++;
        }
        return;
      }
      if (disguised.test(name))
        report(
          "security",
          path,
          "A document or image extension is followed by an executable extension.",
        );
      else if (
        entry.isFile() &&
        /[\u202a-\u202e\u2066-\u2069]/.test(name) &&
        executableSuffix.test(name)
      ) {
        report(
          "security",
          path,
          "Executable filename contains directional controls that can disguise its display.",
        );
      } else if (entry.isFile() && entry.mtimeMs < cutoff && unfinished.has(ext)) {
        report(
          "cleanup",
          path,
          "Old partial-download file. Check whether the download is still needed.",
        );
      } else if (entry.isFile() && entry.mtimeMs < cutoff && installers.has(ext)) {
        report("cleanup", path, "Old installer. Verify whether you still need this copy.");
      }
      if (
        !entry.isDirectory() ||
        /\.(?:app|bundle|framework|plugin|pkg)$/i.test(name) ||
        name === ".git"
      )
        return;
      if (depth >= 6) {
        truncated = true;
        return;
      }
      if ((await realpath(path)) !== path) {
        skipped++;
        return;
      }
      const directory = await opendir(path);
      for await (const child of directory) {
        if (inspected >= options.maxEntries) {
          truncated = true;
          break;
        }
        await inspect(resolve(path, child.name), depth + 1);
      }
    } catch {
      skipped++;
    }
  }

  for (const root of roots) {
    try {
      if ((await realpath(root)) !== root || !(await lstat(root)).isDirectory()) {
        skipped++;
        continue;
      }
    } catch {
      skipped++;
      continue;
    }
    await inspect(root, 0);
  }
  findings.sort((a, b) => b.category.localeCompare(a.category) || a.path.localeCompare(b.path));
  return machineReviewDigest.parse({ inspected, skipped, truncated, findings });
}
