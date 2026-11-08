import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { scanMachine } from "../../agents/machine-review-agent/scan.ts";

it("finds broken links, old download artifacts, and a disguised executable without traversing linked folders", async () => {
  const home = await mkdtemp(join(tmpdir(), "machine-review-"));
  try {
    const downloads = join(home, "Downloads");
    const other = join(home, "Other");
    await mkdir(downloads);
    await mkdir(other);
    const old = join(downloads, "installer.dmg");
    await writeFile(old, "fixture");
    await utimes(old, new Date(0), new Date(0));
    await writeFile(join(downloads, "invoice.pdf.command"), "fixture");
    await writeFile(join(downloads, "notes.pdf"), "fixture");
    await writeFile(join(other, "hidden.pdf.command"), "fixture");
    await symlink(other, join(downloads, "linked-folder"));
    await symlink(join(home, "missing"), join(downloads, "broken"));
    const options = { home, folders: ["Downloads"], olderThanDays: 90, maxEntries: 100 };
    const report = await scanMachine(options);
    expect(report.findings.map((finding) => [finding.category, finding.path])).toEqual([
      ["security", "~/Downloads/invoice.pdf.command"],
      ["cleanup", "~/Downloads/broken"],
      ["cleanup", "~/Downloads/installer.dmg"],
    ]);
    expect(report.truncated).toBe(false);
    expect((await scanMachine({ ...options, maxEntries: 1 })).truncated).toBe(true);
    expect((await scanMachine({ ...options, folders: ["Downloads/linked-folder"] })).skipped).toBe(
      1,
    );
    await expect(scanMachine({ ...options, folders: ["../"] })).rejects.toThrow(/inside your home/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
