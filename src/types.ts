export interface ProjectContext {
  name: string;
  description?: string;
  language: string;
  framework?: string;
  packageManager?: string;
  scripts: Record<string, string>;
  dependencies: string[];
  devDependencies: string[];
  license?: string;
  hasTests: boolean;
  hasCi: boolean;
  fileTree: string;
  keyFiles: { path: string; content: string }[];
  existingReadme?: string;
}

export interface GenerateOptions {
  print: boolean;
  update: boolean;
  output: string;
  sections?: string[];
  interactive: boolean;
  yes: boolean;
  apiKey?: string;
}
