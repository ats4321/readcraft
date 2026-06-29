import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { detectLanguageAndFramework } from "./detector.js";
import type { ProjectContext } from "./types.js";

interface FileInfo {
  absolutePath: string;
  relativePath: string;
  size: number;
}

interface PackageJsonManifest {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  license?: string;
  packageManager?: string;
}

const MAX_TREE_DEPTH = 3;
const MAX_KEY_FILES = 10;
const MAX_FILE_LINES = 200;

const ROOT_MANIFESTS = new Set([
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "cargo.toml",
  "go.mod",
  "composer.json",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".toml",
  ".yaml",
  ".yml",
  ".ini",
  ".conf",
  ".config",
  ".txt",
  ".py",
  ".rs",
  ".go",
  ".php",
  ".cs",
  ".java",
  ".rb",
  ".sh",
  ".sql",
  ".graphql",
  ".gql",
]);

const ENTRY_POINT_RE = /^(index|main|app|server|cli)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|php|cs)$/i;
const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build"]);

function normalizeRelativePath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function shouldIgnoreDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name);
}

function shouldIgnoreFile(name: string): boolean {
  return name === ".env" || name.startsWith(".env.");
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(rootDirectory: string): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  async function walk(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldIgnoreDirectory(entry.name)) {
          continue;
        }

        await walk(path.join(currentDirectory, entry.name));
        continue;
      }

      if (!entry.isFile() || shouldIgnoreFile(entry.name)) {
        continue;
      }

      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = normalizeRelativePath(path.relative(rootDirectory, absolutePath));
      const fileStats = await stat(absolutePath);

      files.push({
        absolutePath,
        relativePath,
        size: fileStats.size,
      });
    }
  }

  await walk(rootDirectory);
  return files;
}

async function buildCompactFileTree(directory: string): Promise<string> {
  const lines: string[] = ["."];

  async function walkTree(currentDirectory: string, depth: number, indent: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    const filtered = entries
      .filter((entry) => !shouldIgnoreDirectory(entry.name) && !shouldIgnoreFile(entry.name))
      .sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) {
          return -1;
        }
        if (!a.isDirectory() && b.isDirectory()) {
          return 1;
        }
        return a.name.localeCompare(b.name);
      });

    for (const entry of filtered) {
      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/`);

        const nextDirectory = path.join(currentDirectory, entry.name);
        if (depth < MAX_TREE_DEPTH - 1) {
          await walkTree(nextDirectory, depth + 1, `${indent}  `);
        } else {
          const descendants = await readdir(nextDirectory, { withFileTypes: true });
          const hasVisibleDescendants = descendants.some(
            (descendant) =>
              !shouldIgnoreDirectory(descendant.name) && !shouldIgnoreFile(descendant.name),
          );
          if (hasVisibleDescendants) {
            lines.push(`${indent}  ...`);
          }
        }
      } else if (entry.isFile() && depth < MAX_TREE_DEPTH) {
        lines.push(`${indent}${entry.name}`);
      }
    }
  }

  await walkTree(directory, 0, "  ");
  return lines.join("\n");
}

function isTextLikeFile(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  const extension = path.posix.extname(relativePath).toLowerCase();

  if (ROOT_MANIFESTS.has(basename.toLowerCase())) {
    return true;
  }

  if (basename.toLowerCase() === "readme.md") {
    return true;
  }

  return TEXT_EXTENSIONS.has(extension);
}

function isEntryPoint(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return ENTRY_POINT_RE.test(basename);
}

function scoreSourceFile(file: FileInfo): number {
  const basename = path.posix.basename(file.relativePath).toLowerCase();
  const relative = file.relativePath.toLowerCase();
  const sizeKb = file.size / 1024;

  let score = 0;

  if (relative.startsWith("src/")) {
    score += 200;
  }

  if (relative.includes("/config") || basename.includes("config")) {
    score += 120;
  }

  if (basename.includes("service") || basename.includes("client")) {
    score += 80;
  }

  if (basename.includes("util") || basename.includes("helper")) {
    score += 40;
  }

  if (isEntryPoint(file.relativePath)) {
    score += 400;
  }

  // Favor files that are likely substantive but still compact for prompting.
  if (sizeKb >= 1 && sizeKb <= 32) {
    score += 120;
  } else if (sizeKb > 32 && sizeKb <= 128) {
    score += 60;
  } else if (sizeKb > 128) {
    score -= 40;
  }

  return score;
}

async function readTruncatedFile(absolutePath: string): Promise<string> {
  const content = await readFile(absolutePath, "utf8");
  const lines = content.split(/\r?\n/);

  if (lines.length <= MAX_FILE_LINES) {
    return content;
  }

  return `${lines.slice(0, MAX_FILE_LINES).join("\n")}\n... [truncated]`;
}

async function readPackageJson(directory: string): Promise<PackageJsonManifest | null> {
  const packageJsonPath = path.join(directory, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    return null;
  }

  const raw = await readFile(packageJsonPath, "utf8");
  return JSON.parse(raw) as PackageJsonManifest;
}

async function readPyprojectMetadata(
  directory: string,
): Promise<{ name?: string; description?: string }> {
  const pyprojectPath = path.join(directory, "pyproject.toml");
  if (!(await fileExists(pyprojectPath))) {
    return {};
  }

  const pyprojectContents = await readFile(pyprojectPath, "utf8");
  const nameMatch = pyprojectContents.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  const descriptionMatch = pyprojectContents.match(/^\s*description\s*=\s*["']([^"']+)["']/m);

  return {
    name: nameMatch?.[1],
    description: descriptionMatch?.[1],
  };
}

function detectPackageManager(packageJson: PackageJsonManifest | null, files: FileInfo[]): string | undefined {
  if (packageJson?.packageManager) {
    return packageJson.packageManager;
  }

  const fileSet = new Set(files.map((file) => file.relativePath.toLowerCase()));

  if (fileSet.has("pnpm-lock.yaml")) {
    return "pnpm";
  }
  if (fileSet.has("yarn.lock")) {
    return "yarn";
  }
  if (fileSet.has("package-lock.json")) {
    return "npm";
  }
  if (fileSet.has("bun.lockb") || fileSet.has("bun.lock")) {
    return "bun";
  }

  return undefined;
}

function detectHasTests(packageJson: PackageJsonManifest | null, files: FileInfo[]): boolean {
  if (packageJson?.scripts?.test) {
    return true;
  }

  return files.some((file) =>
    /(^|\/)(__tests__|tests?|spec)\/|(\.|-)(test|spec)\.(ts|tsx|js|jsx|py|go|rs|php|cs)$/i.test(
      file.relativePath,
    ),
  );
}

function detectHasCi(files: FileInfo[]): boolean {
  return files.some((file) => {
    const relative = file.relativePath.toLowerCase();
    return (
      relative.startsWith(".github/workflows/") ||
      relative === ".gitlab-ci.yml" ||
      relative.startsWith(".circleci/")
    );
  });
}

function findExistingReadme(files: FileInfo[]): FileInfo | undefined {
  return files.find((file) => path.posix.basename(file.relativePath).toLowerCase() === "readme.md");
}

function pickKeyFiles(files: FileInfo[], readmePath?: string): FileInfo[] {
  const fileByPath = new Map(files.map((file) => [file.relativePath, file]));
  const selected: FileInfo[] = [];
  const selectedPaths = new Set<string>();

  const alwaysIncludePaths: string[] = [];

  for (const file of files) {
    const basename = path.posix.basename(file.relativePath).toLowerCase();
    if (ROOT_MANIFESTS.has(basename)) {
      alwaysIncludePaths.push(file.relativePath);
    }
  }

  if (readmePath) {
    alwaysIncludePaths.push(readmePath);
  }

  for (const file of files) {
    if (isEntryPoint(file.relativePath)) {
      alwaysIncludePaths.push(file.relativePath);
    }
  }

  for (const requiredPath of alwaysIncludePaths) {
    const file = fileByPath.get(requiredPath);
    if (!file || selectedPaths.has(requiredPath)) {
      continue;
    }
    selected.push(file);
    selectedPaths.add(requiredPath);
    if (selected.length >= MAX_KEY_FILES) {
      return selected;
    }
  }

  const candidates = files
    .filter((file) => !selectedPaths.has(file.relativePath))
    .filter((file) => isTextLikeFile(file.relativePath))
    .sort((a, b) => {
      const scoreDiff = scoreSourceFile(b) - scoreSourceFile(a);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return a.size - b.size;
    });

  for (const candidate of candidates) {
    selected.push(candidate);
    selectedPaths.add(candidate.relativePath);
    if (selected.length >= MAX_KEY_FILES) {
      break;
    }
  }

  return selected;
}

export async function scanProject(directory: string): Promise<ProjectContext> {
  const rootDirectory = path.resolve(directory);
  const files = await collectFiles(rootDirectory);

  if (files.length === 0) {
    throw new Error("No source files found");
  }

  const [detection, packageJson, pyprojectMetadata, fileTree] = await Promise.all([
    detectLanguageAndFramework(rootDirectory),
    readPackageJson(rootDirectory),
    readPyprojectMetadata(rootDirectory),
    buildCompactFileTree(rootDirectory),
  ]);

  const existingReadmeFile = findExistingReadme(files);
  const keyFileCandidates = pickKeyFiles(files, existingReadmeFile?.relativePath);
  const keyFiles = await Promise.all(
    keyFileCandidates.map(async (file) => ({
      path: file.relativePath,
      content: await readTruncatedFile(file.absolutePath),
    })),
  );

  const existingReadme = existingReadmeFile
    ? await readTruncatedFile(existingReadmeFile.absolutePath)
    : undefined;

  const projectName =
    packageJson?.name ?? pyprojectMetadata.name ?? path.basename(rootDirectory);
  const description = packageJson?.description ?? pyprojectMetadata.description;

  return {
    name: projectName,
    description,
    language: detection.language,
    framework: detection.framework,
    packageManager: detectPackageManager(packageJson, files),
    scripts: packageJson?.scripts ?? {},
    dependencies: Object.keys(packageJson?.dependencies ?? {}),
    devDependencies: Object.keys(packageJson?.devDependencies ?? {}),
    license: packageJson?.license,
    hasTests: detectHasTests(packageJson, files),
    hasCi: detectHasCi(files),
    fileTree,
    keyFiles,
    existingReadme,
  };
}
