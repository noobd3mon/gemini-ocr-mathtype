import { describe, it, expect } from 'vitest';
import { normalizeSupabaseUrl } from './supabase-server';

describe('normalizeSupabaseUrl', () => {
  it('keeps a clean project URL as-is', () => {
    expect(normalizeSupabaseUrl('https://abc123.supabase.co')).toBe('https://abc123.supabase.co');
  });

  it('strips trailing slashes', () => {
    expect(normalizeSupabaseUrl('https://abc123.supabase.co/')).toBe('https://abc123.supabase.co');
    expect(normalizeSupabaseUrl('https://abc123.supabase.co///')).toBe('https://abc123.supabase.co');
  });

  it('strips pasted service paths like /rest/v1 — the "Invalid path specified in request URL" trap', () => {
    expect(normalizeSupabaseUrl('https://abc123.supabase.co/rest/v1')).toBe('https://abc123.supabase.co');
    expect(normalizeSupabaseUrl('https://abc123.supabase.co/rest/v1/')).toBe('https://abc123.supabase.co');
    expect(normalizeSupabaseUrl('https://abc123.supabase.co/auth/v1')).toBe('https://abc123.supabase.co');
    expect(normalizeSupabaseUrl('https://abc123.supabase.co/storage/v1')).toBe('https://abc123.supabase.co');
  });

  it('handles stacked service paths and whitespace', () => {
    expect(normalizeSupabaseUrl('  https://abc123.supabase.co/auth/v1/rest/v1/  ')).toBe('https://abc123.supabase.co');
  });
});
