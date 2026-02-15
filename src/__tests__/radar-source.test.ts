import { describe, expect, it } from 'vitest';

import { buildRadarTileUrl, formatRadarTimestamp, getNextSnapshotDelayMs, getRetryDelayMs } from '../radar-source';

describe('radar source helpers', () => {
  it('builds rainviewer tile URLs', () => {
    const url = buildRadarTileUrl('https://tilecache.rainviewer.com', '/v2/radar/123');
    expect(url).toContain('https://tilecache.rainviewer.com/v2/radar/123');
    expect(url).toContain('/256/{z}/{x}/{y}/2/1_0.png');
  });

  it('formats radar timestamps for footer display', () => {
    expect(formatRadarTimestamp('2026-02-15T12:30:00.000Z')).toMatch(/[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{2}:\d{2}/);
  });

  it('computes bounded retry delays', () => {
    expect(getRetryDelayMs(0)).toBe(5000);
    expect(getRetryDelayMs(1)).toBe(10000);
    expect(getRetryDelayMs(10)).toBe(60000);
  });

  it('computes next snapshot delay', () => {
    const latest = 100000;
    const delay = getNextSnapshotDelayMs(latest, latest);
    expect(delay).toBe(10 * 60 * 1000 + 15 * 1000);
    expect(getNextSnapshotDelayMs(latest, latest + 20 * 60 * 1000)).toBe(5000);
  });
});

