import { GoogleGenerativeAI } from "@google/generative-ai";

import type { GenerateOptions, ProjectContext } from "./types.js";

const MODEL = "gemini-1.5-pro";

const SYSTEM_PROMPT = `You are an expert technical writer. You generate README.md files for software projects.
Your output is always valid Markdown, professional, and accurate to the actual project.
Never invent features. Only describe what you can see in the provided context.
Do not include a preamble or explanation — output only the README content.`;

function resolveApiKey(options: GenerateOptions): string {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing Gemini API key. Set GEMINI_API_KEY (or GOOGLE_API_KEY) or pass --api-key. Get a key at https://aistudio.google.com/app/apikey.",
    );
  }
  return apiKey;
}

function formatScripts(scripts: Record<string, string>): string {
  const entries = Object.entries(scripts);
  if (entries.length === 0) {
    return "None";
  }

  return entries.map(([name, command]) => `${name}: ${command}`).join(", ");
}

function formatDependencies(context: ProjectContext): string {
  const allDependencies = [...context.dependencies, ...context.devDependencies];
  if (allDependencies.length === 0) {
    return "None";
  }
  return allDependencies.join(", ");
}

function formatKeyFiles(context: ProjectContext): string {
  if (context.keyFiles.length === 0) {
    return "None";
  }

  return context.keyFiles
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join("\n\n");
}

function buildUserPrompt(context: ProjectContext, options: GenerateOptions): string {
  const sectionsLine =
    options.sections && options.sections.length > 0
      ? `- Only generate these sections: ${options.sections.join(", ")}`
      : "";

  const existingReadmeBlock = context.existingReadme
    ? `\nExisting README (update/improve this):\n${context.existingReadme}\n`
    : "";

  return `Generate a complete README.md for the following project.

Project Context:
- Name: ${context.name}
- Language: ${context.language}
- Framework: ${context.framework ?? "N/A"}
- Dependencies: ${formatDependencies(context)}
- Scripts: ${formatScripts(context.scripts)}
- License: ${context.license ?? "N/A"}

File Tree:
${context.fileTree}

Key Source Files:
${formatKeyFiles(context)}
${existingReadmeBlock}
Requirements:
- Include all applicable standard sections
- Use real code examples from the source files where possible
- Write installation and usage steps that actually work
- Keep the tone professional but approachable
${sectionsLine}`;
}

function extractReadmeText(text: string): string {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("Gemini API returned an empty response.");
  }

  return trimmed;
}

async function requestReadme(client: GoogleGenerativeAI, userPrompt: string): Promise<string> {
  const model = client.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
  });
  const response = await model.generateContent(userPrompt);
  const text = response.response.text();

  return extractReadmeText(text);
}

export async function generateReadme(
  context: ProjectContext,
  options: GenerateOptions,
): Promise<string> {
  const apiKey = resolveApiKey(options);
  const userPrompt = buildUserPrompt(context, options);
  const client = new GoogleGenerativeAI(apiKey);

  try {
    return await requestReadme(client, userPrompt);
  } catch (firstError) {
    try {
      return await requestReadme(client, userPrompt);
    } catch {
      const message =
        firstError instanceof Error ? firstError.message : "Unknown error from Gemini API.";
      throw new Error(`Gemini API request failed after retry: ${message}`);
    }
  }
}
