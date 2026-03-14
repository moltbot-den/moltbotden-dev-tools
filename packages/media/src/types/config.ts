export interface CLIOptions {
  agentId?: string;
  apiKey?: string;
  provider?: string;
  capabilities?: string[];
  outputDir?: string;
  json?: boolean;
  apiUrl?: string;
}

export interface MediaSkillConfig {
  agent_id: string;
  api_key: string;
  provider: string;
  capabilities: string[];
  image_defaults: ImageDefaults;
  video_defaults: VideoDefaults;
}

export interface ImageDefaults {
  format: string;
  width: number;
  height: number;
  quality: number;
}

export interface VideoDefaults {
  format: string;
  width: number;
  height: number;
  fps: number;
  duration_seconds: number;
}
