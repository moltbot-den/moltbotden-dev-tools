import { describe, it, expect, vi, afterEach } from 'vitest';
import { CommanderError } from 'commander';
import { ApiError } from '../../src/types/api.js';
import {
  CliError,
  ExitCode,
  exitCodeFor,
  reportError,
  toErrorEnvelope,
  UsageError,
} from '../../src/lib/errors.js';
import { configureOutput, print, resolveColorLevel } from '../../src/lib/output.js';

// Scripts and agents branch on exit codes and parse --json errors, so both
// are a public contract.

afterEach(() => {
  configureOutput({ json: false });
  vi.restoreAllMocks();
});

describe('exit codes', () => {
  it('maps auth failures to 3 and not-found to 4', () => {
    expect(exitCodeFor(new ApiError(401, 'x'))).toBe(ExitCode.AUTH);
    expect(exitCodeFor(new ApiError(403, 'x'))).toBe(ExitCode.AUTH);
    expect(exitCodeFor(new ApiError(404, 'x'))).toBe(ExitCode.NOT_FOUND);
  });

  it('maps other API/network failures and unknown errors to 1', () => {
    expect(exitCodeFor(new ApiError(500, 'x'))).toBe(ExitCode.ERROR);
    expect(exitCodeFor(new ApiError(0, 'x'))).toBe(ExitCode.ERROR);
    expect(exitCodeFor(new Error('x'))).toBe(ExitCode.ERROR);
  });

  it('maps usage errors (ours and commander\'s) to 2, but help/version to 0', () => {
    expect(exitCodeFor(new UsageError('x'))).toBe(ExitCode.USAGE);
    expect(exitCodeFor(new CommanderError(1, 'commander.unknownOption', 'bad'))).toBe(ExitCode.USAGE);
    expect(exitCodeFor(new CommanderError(0, 'commander.helpDisplayed', '(outputHelp)'))).toBe(ExitCode.OK);
  });
});

describe('--json error envelope', () => {
  it('has a stable {error:{status,message,details,exit_code}} shape', () => {
    const err = new ApiError(422, 'Validation failed (HTTP 422):\n  name: required', { detail: [] });
    expect(toErrorEnvelope(err)).toEqual({
      error: {
        status: 422,
        message: 'Validation failed (HTTP 422):\n  name: required',
        details: { detail: [] },
        exit_code: 1,
      },
    });
  });

  it('includes hints from CliError', () => {
    const env = toErrorEnvelope(new CliError('Not authenticated', { exitCode: 3, hint: 'mbd login' }));
    expect(env.error).toMatchObject({ status: null, exit_code: 3, hint: 'mbd login' });
  });

  it('is written to stderr as one JSON line, keeping stdout clean', () => {
    configureOutput({ json: true });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    reportError(new ApiError(404, 'Agent not found (HTTP 404)'));

    expect(stdout).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    const written = String(stderr.mock.calls[0][0]);
    expect(JSON.parse(written)).toEqual({
      error: { status: 404, message: 'Agent not found (HTTP 404)', details: null, exit_code: 4 },
    });
  });
});

describe('output in --json mode', () => {
  it('suppresses every human-oriented helper so stdout stays parseable', () => {
    configureOutput({ json: true });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    print.success('ok');
    print.info('info');
    print.warn('warn');
    print.hint('hint');
    print.header('h');
    print.table([{ header: 'A', key: 'a' }], [{ a: 1 }]);
    print.keyValue([{ label: 'k', value: 'v' }]);
    print.empty('none');
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();

    print.json({ a: 1 });
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe('color policy', () => {
  it('disables color for --json, --no-color and NO_COLOR', () => {
    expect(resolveColorLevel({ argv: [], env: {}, json: true })).toBe(0);
    expect(resolveColorLevel({ argv: ['--no-color'], env: {}, json: false })).toBe(0);
    expect(resolveColorLevel({ argv: [], env: { NO_COLOR: '1' }, json: false })).toBe(0);
  });

  it('lets FORCE_COLOR override NO_COLOR, and ignores an empty NO_COLOR', () => {
    expect(resolveColorLevel({ argv: [], env: { NO_COLOR: '1', FORCE_COLOR: '1' }, json: false })).toBeUndefined();
    expect(resolveColorLevel({ argv: [], env: { NO_COLOR: '' }, json: false })).toBeUndefined();
  });
});
