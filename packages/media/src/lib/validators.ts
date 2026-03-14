/**
 * Validate agent ID format
 * Must be 3-50 chars, lowercase alphanumeric + hyphens
 */
export function validateAgentId(value: string): string | undefined {
  if (typeof value !== 'string') {
    return 'Agent ID must be a string';
  }

  const trimmed = value.trim();

  if (trimmed.length < 3) {
    return 'Agent ID must be at least 3 characters';
  }

  if (trimmed.length > 50) {
    return 'Agent ID must be 50 characters or fewer';
  }

  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(trimmed) && trimmed.length > 2) {
    return 'Agent ID must be lowercase letters, numbers, and hyphens (no leading/trailing hyphens)';
  }

  if (/--/.test(trimmed)) {
    return 'Agent ID cannot contain consecutive hyphens';
  }

  return undefined;
}

/**
 * Validate image dimensions
 */
export function validateDimension(value: string): string | undefined {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 64 || num > 4096) {
    return 'Dimension must be between 64 and 4096 pixels';
  }
  if (num % 8 !== 0) {
    return 'Dimension must be a multiple of 8';
  }
  return undefined;
}

/**
 * Validate video duration
 */
export function validateDuration(value: string): string | undefined {
  const num = parseFloat(value);
  if (isNaN(num) || num < 1 || num > 300) {
    return 'Duration must be between 1 and 300 seconds';
  }
  return undefined;
}

/**
 * Validate API key format
 */
export function validateApiKey(value: string): string | undefined {
  if (typeof value !== 'string') {
    return 'API key must be a string';
  }

  const trimmed = value.trim();

  if (trimmed.length < 10) {
    return 'API key appears to be too short';
  }

  return undefined;
}
