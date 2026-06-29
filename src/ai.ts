import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

import type { GenerateOptions, ProjectContext } from "./types.js";

type ResolvedProvider = "gemini" | "anthropic";

const MODELS: Record<ResolvedProvider, string> = {
  gemini: "gemini-1.5-pro",
  anthropic: "claude-sonnet-4-6",
};

const SYSTEM_PROMPT = `You are an expert technical writer. You generate README.md files for software projects.
Your output is always valid Markdown, professional, and accurate to the actual project.
Never invent features. Only describe what you can see in the provided context.
Do not include a preamble or explanation — output only the README content.`;

function normalizeProvider(
  provider: GenerateOptions["provider"],
): "auto" | "gemini" | "anthropic" {
  if (!provider) {
    return "auto";
  }

  return provider === "google" ? "gemini" : provider;
}

function resolveProvider(options: GenerateOptions): ResolvedProvider {
  const requested = normalizeProvider(options.provider);
  if (requested && requested !== "auto") {
    return requested;
  }

  if (process.env.ANTHROPIC_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    return "anthropic";
  }

  return "gemini";
}

function resolveApiKey(provider: ResolvedProvider, options: GenerateOptions): string {
  if (options.apiKey) {
    return options.apiKey;
  }

  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (apiKey) {
      return apiKey;
    }
    throw new Error(
      "Missing API key for Gemini/Google. Set GEMINI_API_KEY (or GOOGLE_API_KEY), or pass --api-key with --provider gemini.",
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    return apiKey;
  }

  throw new Error(
    "Missing API key for Anthropic. Set ANTHROPIC_API_KEY, or pass --api-key with --provider anthropic.",
  );
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

async function requestGeminiReadme(client: GoogleGenerativeAI, userPrompt: string): Promise<string> {
  const model = client.getGenerativeModel({
    model: MODELS.gemini,
    systemInstruction: SYSTEM_PROMPT,
  });
  const response = await model.generateContent(userPrompt);
  const text = response.response.text();

  return extractReadmeText(text);
}

async function requestAnthropicReadme(client: Anthropic, userPrompt: string): Promise<string> {
  const response = await client.messages.create({
    model: MODELS.anthropic,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return extractReadmeText(text);
}

async function withSingleRetry(requestName: string, fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (firstError) {
    try {
      return await fn();
    } catch {
      const message =
        firstError instanceof Error ? firstError.message : `Unknown error from ${requestName}.`;
      throw new Error(`${requestName} request failed after retry: ${message}`);
    }
  }
}

export async function generateReadme(
  context: ProjectContext,
  options: GenerateOptions,
): Promise<string> {
  const provider = resolveProvider(options);
  const apiKey = resolveApiKey(provider, options);
  const userPrompt = buildUserPrompt(context, options);

  if (provider === "gemini") {
    const client = new GoogleGenerativeAI(apiKey);
    return withSingleRetry("Gemini API", () => requestGeminiReadme(client, userPrompt));
  }

  const client = new Anthropic({ apiKey });
  return withSingleRetry("Anthropic API", () => requestAnthropicReadme(client, userPrompt));
}
