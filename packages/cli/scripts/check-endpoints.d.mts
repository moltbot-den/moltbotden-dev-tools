// Types for check-endpoints.mjs (consumed by tests/contract/endpoints.test.ts).
export interface ExtractedEndpoint {
  method: string;
  path: string;
  raw?: string;
  file: string;
  line: number;
}
export interface EndpointResult {
  key: string;
  method: string;
  path: string;
  status: 'ok' | 'missing-path' | 'missing-method';
  specPath: string | null;
  allowedMethods: string[];
  sources: string[];
}
export const DEFAULT_SPEC_URL: string;
export const SNAPSHOT_PATH: string;
export const ALLOWLIST_PATH: string;
export function normalizePath(raw: string): string;
export function extractEndpoints(srcDir?: string): ExtractedEndpoint[];
export function loadSpec(source: string): Promise<{ paths: Record<string, unknown> }>;
export function checkEndpoints(endpoints: ExtractedEndpoint[], spec: { paths?: Record<string, unknown> }): EndpointResult[];
export function loadAllowlist(file?: string): string[];
export function evaluate(
  results: EndpointResult[],
  allowlist: string[],
): { failing: EndpointResult[]; unexpected: EndpointResult[]; stale: string[] };
