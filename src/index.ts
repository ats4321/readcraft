#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";

import { generateReadme } from "./ai.js";
import { scanProject } from "./scanner.js";
import type { GenerateOptions, ProjectContext } from "./types.js";
import { writeReadme } from "./writer.js";

interface CliOptions {
  print?: boolean;
  update?: boolean;
  output?: string;
  sections?: string;
  interactive?: boolean;
  yes?: boolean;
  apiKey?: string;
}

async function applyInteractivePrompts(context: ProjectContext): Promise<ProjectContext> {
  const rl = createInterface({ input, output });
  try {
    const nameAnswer = await rl.question(`Project name (${context.name}): `);
    const descriptionAnswer = await rl.question(
      `One-line description (${context.description ?? "none"}): `,
    );
    const extraContext = await rl.question("Extra context for AI (optional): ");

    const nextContext: ProjectContext = {
      ...context,
      name: nameAnswer.trim() || context.name,
      description: descriptionAnswer.trim() || context.description,
    };

    if (extraContext.trim()) {
      nextContext.keyFiles = [
        ...context.keyFiles,
        { path: "USER_CONTEXT.txt", content: extraContext.trim() },
      ];
    }

    return nextContext;
  } finally {
    rl.close();
  }
}

function parseSections(sections?: string): string[] | undefined {
  if (!sections) {
    return undefined;
  }

  const parsed = sections
    .split(",")
    .map((section) => section.trim())
    .filter((section) => section.length > 0);

  return parsed.length > 0 ? parsed : undefined;
}

function toGenerateOptions(options: CliOptions): GenerateOptions {
  return {
    print: options.print ?? false,
    update: options.update ?? false,
    output: options.output ?? "README.md",
    sections: parseSections(options.sections),
    interactive: options.interactive ?? false,
    yes: options.yes ?? false,
    apiKey: options.apiKey,
  };
}

function renderError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("Missing Gemini API key")) {
      return `${error.message}\nSet GEMINI_API_KEY (or GOOGLE_API_KEY) in your environment or pass --api-key.`;
    }
    return error.message;
  }
  return "Unexpected error";
}

async function run(): Promise<void> {
  const program = new Command();

  program
    .name("readme-gen")
    .description("AI-powered README generator")
    .argument("[directory]", "directory to scan", process.cwd())
    .option("--print", "print generated README to stdout")
    .option("--update", "merge with existing README instead of replacing")
    .option("--output <path>", "write output to a custom path", "README.md")
    .option("--sections <list>", "comma-separated sections to generate")
    .option("--interactive", "prompt for project details and extra context")
    .option("--yes", "skip confirmation prompts")
    .option("--api-key <key>", "Gemini API key")
    .action(async (directory: string, rawOptions: CliOptions) => {
      const options = toGenerateOptions(rawOptions);
      let context = await scanProject(directory);

      if (options.interactive) {
        context = await applyInteractivePrompts(context);
      }

      const spinner = ora("Generating README with AI...").start();
      let generatedReadme: string;
      try {
        generatedReadme = await generateReadme(context, options);
        spinner.succeed("README generated");
      } catch (error) {
        spinner.fail("README generation failed");
        throw error;
      }

      await writeReadme(generatedReadme, options);
    });

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    output.write(`${chalk.red("Error:")} ${renderError(error)}\n`);
    process.exitCode = 1;
  }
}

void run();
