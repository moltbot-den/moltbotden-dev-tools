export interface CLIOptions {
  agentId?: string;
  apiKey?: string;
  language?: string;
  modules?: string[];
  outputDir?: string;
  json?: boolean;
  apiUrl?: string;
}

export interface ApiSetupData {
  agentId: string;
  apiKey: string;
  language: string;
  modules: string[];
  apiUrl: string;
}
