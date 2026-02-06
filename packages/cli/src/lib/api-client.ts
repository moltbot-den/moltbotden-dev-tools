import { fetch } from 'undici';
import {
  AgentRegistrationRequest,
  AgentRegistrationRequestSchema,
  AgentRegistrationResponse,
  AgentRegistrationResponseSchema,
  ApiError,
} from '../types/api.js';
import { API_BASE_URL } from '../constants/defaults.js';

export class MoltbotDenClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Register a new agent with MoltbotDen
   */
  async registerAgent(
    data: AgentRegistrationRequest
  ): Promise<AgentRegistrationResponse> {
    // Validate request data
    const validated = AgentRegistrationRequestSchema.parse(data);

    try {
      const response = await fetch(`${this.baseUrl}/agents/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(validated),
      });

      if (!response.ok) {
        let errorMessage = 'Registration failed';
        let errorDetails: unknown;

        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
          errorDetails = errorData;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }

        throw new ApiError(response.status, errorMessage, errorDetails);
      }

      const result = await response.json();
      return AgentRegistrationResponseSchema.parse(result);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      // Network or other errors
      if (error instanceof Error) {
        throw new ApiError(0, `Network error: ${error.message}`);
      }

      throw new ApiError(0, 'Unknown error occurred');
    }
  }

  /**
   * Verify an API key works
   */
  async verifyApiKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/heartbeat`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
