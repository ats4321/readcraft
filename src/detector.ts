import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";

export interface DetectionResult {
  language: string;
  framework?: string;
}

interface PackageJsonManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const MANIFESTS = {
  packageJson: "package.json",
  pyproject: "pyproject.toml",
  requirements: "requirements.txt",
  cargo: "Cargo.toml",
  goMod: "go.mod",
  composer: "composer.json",
} as const;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function hasPackageDependency(manifest: PackageJsonManifest, dependency: string): boolean {
  return Boolean(
    manifest.dependencies?.[dependency] ??
      manifest.devDependencies?.[dependency] ??
      manifest.peerDependencies?.[dependency] ??
      manifest.optionalDependencies?.[dependency],
  );
}

function parseRequirements(contents: string): Set<string> {
  const packages = new Set<string>();
  const lines = contents.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line
      .split("#", 1)[0]
      .trim()
      .split(/[<>=!~\[\];\s]/, 1)[0]
      .toLowerCase();

    if (normalized) {
      packages.add(normalized);
    }
  }

  return packages;
}

async function detectFromPackageJson(directory: string): Promise<DetectionResult | null> {
  const packageJsonPath = path.join(directory, MANIFESTS.packageJson);
  if (!(await fileExists(packageJsonPath))) {
    return null;
  }

  const rawManifest = await readFile(packageJsonPath, "utf8");
  const manifest = JSON.parse(rawManifest) as PackageJsonManifest;

  if (hasPackageDependency(manifest, "next")) {
    return { language: "JavaScript/TypeScript", framework: "Next.js" };
  }

  if (hasPackageDependency(manifest, "react")) {
    return { language: "JavaScript/TypeScript", framework: "React" };
  }

  if (hasPackageDependency(manifest, "express")) {
    return { language: "JavaScript/TypeScript", framework: "Express" };
  }

  return { language: "JavaScript/TypeScript" };
}

async function detectFromPythonManifests(directory: string): Promise<DetectionResult | null> {
  const pyprojectPath = path.join(directory, MANIFESTS.pyproject);
  const requirementsPath = path.join(directory, MANIFESTS.requirements);

  const hasPyproject = await fileExists(pyprojectPath);
  const hasRequirements = await fileExists(requirementsPath);

  if (!hasPyproject && !hasRequirements) {
    return null;
  }

  if (!hasRequirements) {
    return { language: "Python" };
  }

  const requirementsContents = await readFile(requirementsPath, "utf8");
  const requirementsPackages = parseRequirements(requirementsContents);

  if (requirementsPackages.has("django")) {
    return { language: "Python", framework: "Django" };
  }

  if (requirementsPackages.has("fastapi")) {
    return { language: "Python", framework: "FastAPI" };
  }

  return { language: "Python" };
}

async function detectFromFilePresence(directory: string): Promise<DetectionResult | null> {
  const [hasCargoToml, hasGoMod, hasComposer] = await Promise.all([
    fileExists(path.join(directory, MANIFESTS.cargo)),
    fileExists(path.join(directory, MANIFESTS.goMod)),
    fileExists(path.join(directory, MANIFESTS.composer)),
  ]);

  if (hasCargoToml) {
    return { language: "Rust" };
  }

  if (hasGoMod) {
    return { language: "Go" };
  }

  if (hasComposer) {
    return { language: "PHP" };
  }

  const csprojFiles = await glob("**/*.csproj", {
    cwd: directory,
    nodir: true,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
  });

  if (csprojFiles.length > 0) {
    return { language: "C#" };
  }

  return null;
}

export async function detectLanguageAndFramework(directory: string): Promise<DetectionResult> {
  const jsResult = await detectFromPackageJson(directory);
  if (jsResult) {
    return jsResult;
  }

  const pythonResult = await detectFromPythonManifests(directory);
  if (pythonResult) {
    return pythonResult;
  }

  const filePresenceResult = await detectFromFilePresence(directory);
  if (filePresenceResult) {
    return filePresenceResult;
  }

  return { language: "Unknown" };
}
