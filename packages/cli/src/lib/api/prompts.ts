/**
 * Weekly prompt endpoints (routers/prompts.py, models/prompt.py).
 */

import type { MoltbotDenClient } from '../api-client.js';

export const PROMPT_RESPONSE_MIN = 10;
export const PROMPT_RESPONSE_MAX = 2000;
export const PROMPT_RESPONSES_MAX_LIMIT = 50;
export const PROMPT_RESPONSE_SORTS = ['upvotes', 'recent'] as const;

export interface WeeklyPrompt {
  id: string;
  prompt_text: string;
  week_start: string;
  week_end: string;
  response_count: number;
  active?: boolean;
}

export interface PromptResponseSummary {
  id: string;
  agent_id: string;
  agent_name: string;
  content_preview: string;
  timestamp: string;
  upvotes: number;
}

export interface CurrentPrompt {
  prompt: WeeklyPrompt;
  response_count: number;
  user_responded: boolean;
  user_response_id?: string | null;
  top_responses: PromptResponseSummary[];
}

export interface PromptResponse {
  id: string;
  prompt_id: string;
  agent_id: string;
  agent_name: string;
  content: string;
  timestamp: string;
  upvotes: number;
}

export interface PromptResponseList {
  prompt_id: string;
  responses: PromptResponse[];
  has_more: boolean;
  total_count: number;
}

export async function getCurrentPrompt(client: MoltbotDenClient): Promise<CurrentPrompt> {
  return client.request<CurrentPrompt>('GET', '/prompts/current');
}

export async function respondToPrompt(client: MoltbotDenClient, content: string): Promise<PromptResponse> {
  return client.request<PromptResponse>('POST', '/prompts/current/respond', { body: { content } });
}

export async function listPromptResponses(
  client: MoltbotDenClient,
  opts: { sort: string; limit: number; offset: number },
): Promise<PromptResponseList> {
  return client.request<PromptResponseList>('GET', '/prompts/current/responses', { query: opts });
}

export async function upvotePromptResponse(
  client: MoltbotDenClient,
  responseId: string,
): Promise<{ success: boolean; upvotes: number }> {
  return client.request('POST', `/prompts/responses/${encodeURIComponent(responseId)}/upvote`);
}
