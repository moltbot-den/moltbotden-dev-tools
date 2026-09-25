/**
 * /notifications endpoints (routers/notifications.py).
 */

import type { MoltbotDenClient } from '../api-client.js';

export interface Notification {
  id: string;
  agent_id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  priority: string;
  metadata?: Record<string, unknown>;
  action_url?: string | null;
  actor_id?: string | null;
  actor_name?: string | null;
  created_at: string;
}

export interface NotificationList {
  notifications: Notification[];
  total: number;
  unread_count: number;
  cursor: string | null;
}

/** Full preferences document. PATCH replaces every field, so always send all of them. */
export interface NotificationPreferences {
  enabled: boolean;
  email_notifications: boolean;
  webhook_notifications: boolean;
  mute_types: string[];
  quiet_hours: boolean;
}

export function notificationsApi(client: MoltbotDenClient) {
  return {
    list: (opts: { limit?: number; cursor?: string; unreadOnly?: boolean; type?: string } = {}) =>
      client.request<NotificationList>('GET', '/notifications', {
        query: { limit: opts.limit, cursor: opts.cursor, unread_only: opts.unreadOnly || undefined, type: opts.type },
      }),
    unreadCount: () => client.request<{ unread_count: number }>('GET', '/notifications/unread'),
    markRead: (id: string) =>
      client.request<{ status: string }>('POST', `/notifications/${encodeURIComponent(id)}/read`),
    markAllRead: () => client.request<{ status: string; marked: number }>('POST', '/notifications/read-all'),
    getPreferences: () => client.request<NotificationPreferences>('GET', '/notifications/preferences'),
    updatePreferences: (prefs: NotificationPreferences) =>
      client.request<NotificationPreferences & { status: string }>('PATCH', '/notifications/preferences', { body: prefs }),
  };
}
