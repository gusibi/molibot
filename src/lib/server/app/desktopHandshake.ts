export const DESKTOP_PROTOCOL_VERSION = 1;

export interface DesktopHandshake {
  service: "molibot";
  version: string;
  protocolVersion: number;
  instanceId: string | null;
  managedByDesktop: boolean;
  capabilities: string[];
}

export function buildDesktopHandshake(env: NodeJS.ProcessEnv = process.env): DesktopHandshake {
  return {
    service: "molibot",
    version: String(env.MOLIBOT_VERSION || env.npm_package_version || "0.0.0"),
    protocolVersion: DESKTOP_PROTOCOL_VERSION,
    instanceId: String(env.MOLIBOT_SERVICE_OWNER_ID || "").trim() || null,
    managedByDesktop: env.MOLIBOT_DESKTOP_MANAGED === "1",
    // `runtime-health-v1` tells the supervisor that `/api/desktop/health?deep=1`
    // exists on this build. It must stay a capability rather than an assumed
    // route: an older adopted sidecar answers 404 there, and a supervisor that
    // read 404 as "unhealthy" would restart a perfectly good service.
    capabilities: [
      "service-discovery-v1",
      "service-ownership-v1",
      "desktop-token-v1",
      "runtime-health-v1"
    ]
  };
}
