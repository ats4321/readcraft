import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { GenerateOptions } from "./types.js";

function resolveOutputPath(options: GenerateOptions): string {
  return path.resolve(options.output || "README.md");
}

async function readExistingReadme(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function normalizeHeading(heading: string): string {
  return heading.trim().toLowerCase().replace(/\s+/g, " ");
}

function splitSections(markdown: string): { preamble: string; sections: Map<string, string> } {
  const lines = markdown.split(/\r?\n/);
  const sectionStarts: Array<{ index: number; heading: string }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      sectionStarts.push({ index: i, heading: headingMatch[1] });
    }
  }

  if (sectionStarts.length === 0) {
    return { preamble: markdown.trim(), sections: new Map<string, string>() };
  }

  const preamble = lines.slice(0, sectionStarts[0].index).join("\n").trim();
  const sections = new Map<string, string>();

  for (let i = 0; i < sectionStarts.length; i += 1) {
    const current = sectionStarts[i];
    const next = sectionStarts[i + 1];
    const end = next ? next.index : lines.length;
    const content = lines.slice(current.index, end).join("\n").trim();
    sections.set(normalizeHeading(current.heading), content);
  }

  return { preamble, sections };
}

function mergeReadmes(existingReadme: string, generatedReadme: string): string {
  const existing = splitSections(existingReadme);
  const generated = splitSections(generatedReadme);

  if (generated.sections.size === 0) {
    return generatedReadme;
  }

  const mergedSections: string[] = [];
  const generatedSectionKeys = new Set<string>();

  for (const [key, sectionContent] of generated.sections.entries()) {
    generatedSectionKeys.add(key);
    mergedSections.push(sectionContent);
  }

  for (const [key, sectionContent] of existing.sections.entries()) {
    if (!generatedSectionKeys.has(key)) {
      mergedSections.push(sectionContent);
    }
  }

  const mergedPreamble = generated.preamble || existing.preamble;
  const content = [mergedPreamble, ...mergedSections].filter(Boolean).join("\n\n").trim();
  return `${content}\n`;
}

function buildDiff(oldContent: string, newContent: string): string {
  if (oldContent === newContent) {
    return "No changes detected.";
  }

  const oldLines = oldContent.split(/\r?\n/);
  const newLines = newContent.split(/\r?\n/);
  const maxLines = Math.max(oldLines.length, newLines.length);
  const diffLines: string[] = ["--- existing README", "+++ new README"];

  for (let i = 0; i < maxLines; i += 1) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      diffLines.push(`  ${oldLine ?? ""}`);
      continue;
    }

    if (oldLine !== undefined) {
      diffLines.push(`- ${oldLine}`);
    }
    if (newLine !== undefined) {
      diffLines.push(`+ ${newLine}`);
    }
  }

  return diffLines.join("\n");
}

async function shouldWriteReadme(skipPrompt: boolean): Promise<boolean> {
  if (skipPrompt) {
    return true;
  }

  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question("Write README.md? [Y/n] ");
    const normalized = answer.trim().toLowerCase();
    return normalized === "" || normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

async function ensureOutputDirectory(outputPath: string): Promise<void> {
  const outputDirectory = path.dirname(outputPath);
  await mkdir(outputDirectory, { recursive: true });
}

async function assertWritable(filePath: string): Promise<void> {
  try {
    await access(filePath, constants.W_OK);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return;
    }
    throw new Error(`Output file is not writable: ${filePath}`);
  }
}

export async function writeReadme(generatedReadme: string, options: GenerateOptions): Promise<void> {
  const outputPath = resolveOutputPath(options);
  const existingReadme = await readExistingReadme(outputPath);
  const finalReadme =
    options.update && existingReadme ? mergeReadmes(existingReadme, generatedReadme) : generatedReadme;

  if (options.print) {
    output.write(finalReadme.endsWith("\n") ? finalReadme : `${finalReadme}\n`);
    return;
  }

  if (existingReadme) {
    const diffText = buildDiff(existingReadme, finalReadme);
    output.write(`${diffText}\n`);
  }

  const confirmed = await shouldWriteReadme(options.yes);
  if (!confirmed) {
    return;
  }

  await ensureOutputDirectory(outputPath);
  await assertWritable(outputPath);

  try {
    await writeFile(outputPath, finalReadme, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ((error as { code?: string }).code === "EACCES" || (error as { code?: string }).code === "EPERM")
    ) {
      throw new Error(`Output file not writable: ${outputPath}`);
    }
    throw error;
  }
}
