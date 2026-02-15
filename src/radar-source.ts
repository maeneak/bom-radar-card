const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const RAINVIEWER_DEFAULT_HOST = 'https://tilecache.rainviewer.com';
const RAINVIEWER_COLOR_SCHEME = 2;
const RAINVIEWER_SMOOTH = 1;
const RAINVIEWER_SNOW = 0;

interface RainviewerFrame {
  time: number;
  path: string;
}

interface RainviewerApiResponse {
  host?: string;
  radar?: {
    past?: RainviewerFrame[];
  };
}

export interface RadarFrame {
  id: string;
  timestampIso: string;
  timeMs: number;
  path: string;
}

export interface RadarSnapshot {
  host: string;
  frames: RadarFrame[];
  latestTimeMs: number;
}

export const buildRadarTileUrl = (host: string, path: string): string =>
  `${host}${path}/256/{z}/{x}/{y}/${RAINVIEWER_COLOR_SCHEME}/${RAINVIEWER_SMOOTH}_${RAINVIEWER_SNOW}.png`;

export const fetchRadarSnapshot = async (fetcher: typeof fetch = fetch): Promise<RadarSnapshot> => {
  const response = await fetcher(RAINVIEWER_API);
  if (!response.ok) {
    throw new Error(`RainViewer API returned ${response.status}`);
  }

  const data = (await response.json()) as RainviewerApiResponse;
  const host = data.host ?? RAINVIEWER_DEFAULT_HOST;
  const rawFrames = data.radar?.past ?? [];
  if (rawFrames.length === 0) {
    throw new Error('No radar frames available');
  }

  const frames = rawFrames.map((frame) => {
    const timeMs = frame.time * 1000;
    const timestampIso = new Date(timeMs).toISOString();
    return {
      id: timestampIso,
      timestampIso,
      timeMs,
      path: frame.path,
    };
  });

  return {
    host,
    frames,
    latestTimeMs: frames[frames.length - 1].timeMs,
  };
};

export const formatRadarTimestamp = (isoTime: string): string => {
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const x = new Date(isoTime);
  return `${weekday[x.getDay()]} ${month[x.getMonth()]} ${x.getDate().toString().padStart(2, '0')} ${x
    .getHours()
    .toString()
    .padStart(2, '0')}:${x.getMinutes().toString().padStart(2, '0')}`;
};

export const getNextSnapshotDelayMs = (latestTimeMs: number, nowMs = Date.now()): number => {
  const nextAvailableTime = latestTimeMs + 10 * 60 * 1000 + 15 * 1000;
  return Math.max(nextAvailableTime - nowMs, 5000);
};

export const getRetryDelayMs = (retryCount: number): number => Math.min(5000 * 2 ** retryCount, 60000);

