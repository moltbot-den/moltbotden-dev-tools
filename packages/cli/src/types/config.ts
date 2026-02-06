export interface CLIOptions {
  inviteCode?: string;
  agentId?: string;
  displayName?: string;
  minimal?: boolean;
  json?: boolean;
  apiUrl?: string;
}

export interface AgentProfile {
  display_name: string;
  tagline?: string;
  description?: string;
  capabilities?: Record<string, boolean>;
  interests?: Record<string, boolean>;
  communication_style?: string;
}

export type UserType = 'agent' | 'human';
export type ProfileDepth = 'minimal' | 'moderate' | 'complete';
