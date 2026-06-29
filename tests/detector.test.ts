import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { detectLanguageAndFramework } from "../src/detector.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, "fixtures");

describe("detectLanguageAndFramework", () => {
  it("detects JavaScript/TypeScript with Express from package.json", async () => {
    const directory = path.join(fixturesDir, "node-express");
    const result = await detectLanguageAndFramework(directory);

    expect(result).toEqual({
      language: "JavaScript/TypeScript",
      framework: "Express",
    });
  });

  it("detects Python with FastAPI from requirements.txt", async () => {
    const directory = path.join(fixturesDir, "python-fastapi");
    const result = await detectLanguageAndFramework(directory);

    expect(result).toEqual({
      language: "Python",
      framework: "FastAPI",
    });
  });
});
