export interface KwDemoVesselReport {
  mmsi: string; name: string; lat: number; lon: number; shipType: number;
  heading: number; speed: number; course: number; timestamp: number;
}
export interface KwDemoBbox { swLat: number; swLon: number; neLat: number; neLon: number }
export function demoVesselReports(nowMs?: number, bbox?: KwDemoBbox | null): KwDemoVesselReport[];
export function demoVesselSnapshot(nowMs?: number, opts?: { bbox?: KwDemoBbox | null; includeCandidates?: boolean; includeTankers?: boolean }): {
  snapshotAt: number;
  densityZones: Array<{ id: string; name: string; location: { latitude: number; longitude: number }; intensity: number; deltaPct: number; shipsPerDay: number; note: string }>;
  disruptions: unknown[];
  sequence: number;
  status: { connected: boolean; vessels: number; messages: number };
  candidateReports: KwDemoVesselReport[];
  tankerReports: KwDemoVesselReport[];
};
export function isDemoMmsi(mmsi: string): boolean;
export function isDemoLand(lat: number, lon: number): boolean;
export const KW_DEMO_KOREA_BBOX: KwDemoBbox;
