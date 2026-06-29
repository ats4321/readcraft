import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { scanProject } from "../src/scanner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

const tempDirectories: string[] = [];

async function copyFixtureToTemp(fixtureName: string): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "readcraft-test-"));
  tempDirectories.push(tempDir);

  const fixtureSource = path.join(fixturesDir, fixtureName);
  await cp(fixtureSource, tempDir, { recursive: true });
  return tempDir;
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("scanProject", () => {
  it("builds a project context for a Node/Express fixture", async () => {
    const directory = path.join(fixturesDir, "node-express");
    const context = await scanProject(directory);

    expect(context.name).toBe("sample-express-app");
    expect(context.description).toBe("Sample Express project fixture");
    expect(context.language).toBe("JavaScript/TypeScript");
    expect(context.framework).toBe("Express");
    expect(context.dependencies).toContain("express");
    expect(context.devDependencies).toContain("typescript");
    expect(context.scripts.test).toBe("vitest");
    expect(context.hasTests).toBe(true);
    expect(context.hasCi).toBe(true);
    expect(context.fileTree).toContain("src/");
    expect(context.fileTree).toContain("one/");
    expect(context.fileTree).toContain("...");
    expect(context.fileTree).not.toContain("two/");
    expect(context.keyFiles.length).toBeLessThanOrEqual(10);
    expect(context.keyFiles.some((file) => file.path === "package.json")).toBe(true);
    expect(context.keyFiles.some((file) => file.path === "README.md")).toBe(true);
    expect(context.existingReadme).toContain("# Sample Express App");
  });

  it("limits key files to 10 and truncates key file content to 200 lines", async () => {
    const directory = await copyFixtureToTemp("node-express");
    const srcDir = path.join(directory, "src");

    await mkdir(srcDir, { recursive: true });
    const longFilePath = path.join(srcDir, "main.ts");
    const longContent = Array.from({ length: 220 }, (_, index) => `console.log("line ${index + 1}");`).join("\n");
    await writeFile(longFilePath, longContent, "utf8");

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        writeFile(path.join(srcDir, `feature-${index + 1}.ts`), `export const feature${index + 1} = true;\n`, "utf8"),
      ),
    );

    const context = await scanProject(directory);
    const longFile = context.keyFiles.find((file) => file.path === "src/main.ts");

    expect(context.keyFiles.length).toBe(10);
    expect(longFile).toBeDefined();
    expect(longFile?.content).toContain('console.log("line 1");');
    expect(longFile?.content).toContain('console.log("line 200");');
    expect(longFile?.content).not.toContain('console.log("line 201");');
    expect(longFile?.content).toContain("... [truncated]");
  });
});
