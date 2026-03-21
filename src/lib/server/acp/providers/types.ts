import type { AcpAdapterKind, AcpTargetConfig } from "../../settings/schema.js";

export interface AcpProviderProfile {
  id: Exclude<AcpAdapterKind, "custom">;
  label: string;
  commandNamespace: string;
  defaultTargetId: string;
  defaultTargetName: string;
  defaultCommand: string;
  defaultArgs: string[];
  defaultEnvPlaceholder: string;
  matchesTarget: (input: {
    id: string;
    name: string;
    command: string;
    args: string[];
  }) => boolean;
  hasAuthAvailable: (target: AcpTargetConfig) => boolean;
  buildAuthHint: (target: AcpTargetConfig) => string;
}
