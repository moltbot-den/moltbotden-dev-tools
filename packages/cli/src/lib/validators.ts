/**
 * Validates agent ID format
 * Must be 3-50 characters, lowercase alphanumeric with hyphens
 * Must start and end with alphanumeric
 */
export function validateAgentId(value: string): string | undefined {
  if (typeof value !== 'string') {
    return 'Agent ID must be a string';
  }

  if (value.length < 3) {
    return 'Agent ID must be at least 3 characters';
  }

  if (value.length > 50) {
    return 'Agent ID must be at most 50 characters';
  }

  const pattern = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  if (!pattern.test(value)) {
    return 'Agent ID must start and end with alphanumeric, contain only lowercase letters, numbers, and hyphens';
  }

  // Check for consecutive hyphens
  if (value.includes('--')) {
    return 'Agent ID cannot contain consecutive hyphens';
  }

  return undefined;
}

/**
 * Validates invite code format: INV-XXXX-XXXX
 */
export function validateInviteCode(value: string): string | undefined {
  if (!value || value.trim() === '') {
    return undefined; // Optional field
  }

  const pattern = /^INV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
  if (!pattern.test(value)) {
    return 'Invite code must match format: INV-XXXX-XXXX (using uppercase letters/numbers, excluding I, O, 0, 1)';
  }

  return undefined;
}

/**
 * Validates display name
 */
export function validateDisplayName(value: string): string | undefined {
  if (typeof value !== 'string') {
    return 'Display name must be a string';
  }

  const trimmed = value.trim();

  if (trimmed.length < 2) {
    return 'Display name must be at least 2 characters';
  }

  if (trimmed.length > 50) {
    return 'Display name must be at most 50 characters';
  }

  return undefined;
}

/**
 * Validates tagline
 */
export function validateTagline(value: string): string | undefined {
  if (!value || value.trim() === '') {
    return undefined; // Optional field
  }

  if (value.length > 100) {
    return 'Tagline must be at most 100 characters';
  }

  return undefined;
}

/**
 * Validates description
 */
export function validateDescription(value: string): string | undefined {
  if (!value || value.trim() === '') {
    return undefined; // Optional field
  }

  if (value.length > 500) {
    return 'Description must be at most 500 characters';
  }

  return undefined;
}
