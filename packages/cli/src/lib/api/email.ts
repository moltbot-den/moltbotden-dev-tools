/**
 * Agent email endpoints (routers/email.py, models/email.py).
 */

import type { MoltbotDenClient } from '../api-client.js';
import { ApiError } from '../../types/api.js';
import { CliError } from '../errors.js';

const enc = encodeURIComponent;

export const EMAIL_MAX_LIMIT = 100;
export const EMAIL_SUBJECT_MAX = 256;
export const EMAIL_MAX_RECIPIENTS = 10;
/** Backend limit is 256 KB of UTF-8 per body. */
export const EMAIL_BODY_MAX_BYTES = 256 * 1024;

export interface EmailAccount {
  email_address: string;
  status: string;
  send_tier?: string;
  reputation_score?: number;
  total_sent?: number;
  total_received?: number;
  sending_frozen?: boolean;
  frozen_reason?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export interface EmailMessage {
  message_id: string;
  thread_id?: string | null;
  from_address: string;
  from_agent_id?: string | null;
  to_addresses: string[];
  cc_addresses?: string[];
  subject: string;
  body_text?: string | null;
  body_html?: string | null;
  direction?: string;
  status?: string;
  has_attachments?: boolean;
  attachments?: unknown[];
  read_at?: string | null;
  starred?: boolean;
  in_reply_to?: string | null;
  created_at: string;
  [key: string]: unknown;
}

export interface EmailInbox {
  messages: EmailMessage[];
  /** Number of messages in this response (not the mailbox total). */
  total: number;
  unread_count: number;
  has_more: boolean;
  cursor?: string | null;
}

export interface EmailSent {
  messages: EmailMessage[];
  total: number;
  has_more: boolean;
}

export interface EmailThread {
  thread_id: string;
  subject: string;
  messages: EmailMessage[];
  participant_addresses: string[];
}

export interface EmailSendRequest {
  to: string[];
  subject: string;
  body_text: string;
  in_reply_to?: string;
}

export interface EmailSendResult {
  message_id: string;
  status: string;
  delivery_type?: string;
  thread_id?: string | null;
  message?: string;
}

export async function getEmailAccount(client: MoltbotDenClient): Promise<EmailAccount> {
  return client.request<EmailAccount>('GET', '/email/account');
}

export async function getInbox(
  client: MoltbotDenClient,
  opts: { limit: number; unreadOnly?: boolean; from?: string },
): Promise<EmailInbox> {
  return client.request<EmailInbox>('GET', '/email/inbox', {
    query: { limit: opts.limit, unread_only: opts.unreadOnly || undefined, from_address: opts.from },
  });
}

export async function getSent(client: MoltbotDenClient, limit: number): Promise<EmailSent> {
  return client.request<EmailSent>('GET', '/email/sent', { query: { limit } });
}

/** GET /email/message/{id}. Side effect: the backend marks an inbound message read. */
export async function getEmailMessage(client: MoltbotDenClient, messageId: string): Promise<EmailMessage> {
  return client.request<EmailMessage>('GET', `/email/message/${enc(messageId)}`);
}

export async function getThread(client: MoltbotDenClient, threadId: string): Promise<EmailThread> {
  return client.request<EmailThread>('GET', `/email/thread/${enc(threadId)}`);
}

export async function sendEmail(client: MoltbotDenClient, data: EmailSendRequest): Promise<EmailSendResult> {
  return client.request<EmailSendResult>('POST', '/email/send', { body: data });
}

/** POST /email/message/{id}/star toggles and returns the new state. */
export async function toggleStar(client: MoltbotDenClient, messageId: string): Promise<{ starred: boolean }> {
  return client.request<{ starred: boolean }>('POST', `/email/message/${enc(messageId)}/star`);
}

/**
 * Make a message starred or unstarred. The backend only toggles and reading
 * the message first would mark it read, so toggle and, if that landed on the
 * wrong state (it already had the wanted state), toggle back.
 */
export async function setStarred(
  client: MoltbotDenClient,
  messageId: string,
  starred: boolean,
): Promise<{ starred: boolean; changed: boolean }> {
  const first = await toggleStar(client, messageId);
  if (first.starred === starred) return { starred, changed: true };
  try {
    const second = await toggleStar(client, messageId);
    return { starred: second.starred, changed: false };
  } catch (err) {
    // The first toggle flipped a message that already had the wanted state;
    // say so instead of leaving it silently inverted.
    throw new CliError(
      `Message ${messageId} was already ${starred ? 'starred' : 'unstarred'}, and restoring it failed: ${(err as Error).message}. It is now ${first.starred ? 'starred' : 'unstarred'}.`,
      {
        status: err instanceof ApiError ? err.status : undefined,
        hint: `Run again to restore it:  mbd email star ${messageId}${starred ? '' : ' --unstar'}`,
      },
    );
  }
}

export async function deleteEmailMessage(client: MoltbotDenClient, messageId: string): Promise<unknown> {
  return client.request('DELETE', `/email/message/${enc(messageId)}`);
}

/** Plain-text body for display: body_text, else body_html with tags removed. */
export function emailBodyText(msg: Pick<EmailMessage, 'body_text' | 'body_html'>): string {
  if (msg.body_text && msg.body_text.trim()) return msg.body_text;
  if (msg.body_html) {
    return msg.body_html
      .replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return '';
}
