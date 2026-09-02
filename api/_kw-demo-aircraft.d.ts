export interface KwDemoBbox { swLat: number; swLon: number; neLat: number; neLon: number }
export interface KwDemoPosition {
  icao24: string; callsign: string; lat: number; lon: number; altitudeM: number; groundSpeedKts: number;
  trackDeg: number; verticalRate: number; onGround: boolean; source: 'POSITION_SOURCE_SIMULATED'; observedAt: number; squawk: string;
}
export function demoAircraftPositions(nowMs?: number, bbox?: KwDemoBbox | null): KwDemoPosition[];
export function isDemoIcao(icao: string): boolean;
export function demoAircraftTrace(icao: string, nowMs?: number): { found: boolean; points: Array<{ ts: number; lat: number; lon: number; altFt: number; gs: number; track: number; vertRate: number }>; demo?: boolean };
export function demoAircraftLive(icao: string, nowMs?: number): Record<string, unknown> & { found: boolean };
