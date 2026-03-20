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
