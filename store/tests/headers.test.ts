import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentSecurityPolicy } from '../src/server/csp.ts';

afterEach(() => vi.unstubAllEnvs());

const parse = (csp: string) => new Map(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k!, v]));

describe('content security policy', () => {
  it('blocks framing, plugins, other sites and form posts elsewhere', () => {
    const p = parse(contentSecurityPolicy({ dev: false, imageBaseUrl: null }));
    expect(p.get('default-src')).toEqual(["'self'"]);
    expect(p.get('frame-ancestors')).toEqual(["'none'"]);
    expect(p.get('object-src')).toEqual(["'none'"]);
    expect(p.get('base-uri')).toEqual(["'self'"]);
    expect(p.get('form-action')).toEqual(["'self'"]);
    expect(p.get('connect-src')).toEqual(["'self'"]);
  });

  it('never allows eval in production, only while developing', () => {
    expect(contentSecurityPolicy({ dev: false, imageBaseUrl: null })).not.toContain('unsafe-eval');
    expect(contentSecurityPolicy({ dev: true, imageBaseUrl: null })).toContain('unsafe-eval');
  });

  it('allows product pictures only from the configured picture host', () => {
    expect(parse(contentSecurityPolicy({ dev: false, imageBaseUrl: 'https://img.example.test/shop' })).get('img-src')).toEqual(["'self'", 'data:', 'https://img.example.test']);
    expect(parse(contentSecurityPolicy({ dev: false, imageBaseUrl: null })).get('img-src')).toEqual(["'self'", 'data:']);
  });
});
