use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceOwnership {
    Managed,
    External,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServiceState {
    Disconnected,
    Ready,
    Incompatible,
    Error,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub endpoint: Option<String>,
    pub ownership: Option<ServiceOwnership>,
    pub state: ServiceState,
    pub version: Option<String>,
}

impl Default for ServiceStatus {
    fn default() -> Self {
        Self {
            endpoint: None,
            ownership: None,
            state: ServiceState::Disconnected,
            version: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceHandshake {
    pub service: String,
    pub version: String,
    pub protocol_version: u32,
    #[serde(default)]
    pub instance_id: Option<String>,
    #[serde(default)]
    pub managed_by_desktop: bool,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiscoveryDecision {
    ConnectExternal,
    StartManaged { port: u16 },
    RejectIncompatible,
}

pub fn decide_service_start(
    handshake: Option<&ServiceHandshake>,
    supported_protocol: u32,
    preferred_port: u16,
    occupied_ports: &HashSet<u16>,
) -> Option<DiscoveryDecision> {
    if let Some(handshake) = handshake {
        if handshake.service == "molibot" && handshake.protocol_version == supported_protocol {
            return Some(DiscoveryDecision::ConnectExternal);
        }
        return Some(DiscoveryDecision::RejectIncompatible);
    }

    select_available_port(preferred_port, occupied_ports)
        .map(|port| DiscoveryDecision::StartManaged { port })
}

pub fn select_available_port(preferred: u16, occupied_ports: &HashSet<u16>) -> Option<u16> {
    (preferred..=u16::MAX).find(|port| !occupied_ports.contains(port))
}

pub fn should_stop_on_quit(ownership: Option<&ServiceOwnership>) -> bool {
    matches!(ownership, Some(ServiceOwnership::Managed))
}

pub fn is_compatible_handshake(handshake: &ServiceHandshake, supported_protocol: u32) -> bool {
    handshake.service == "molibot"
        && handshake.protocol_version == supported_protocol
        && handshake
            .capabilities
            .iter()
            .any(|capability| capability == "service-ownership-v1")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connects_to_compatible_existing_molibot() {
        let handshake = ServiceHandshake {
            service: "molibot".into(),
            version: "2.2.4".into(),
            protocol_version: 1,
            instance_id: Some("instance-1".into()),
            managed_by_desktop: false,
            capabilities: vec!["service-ownership-v1".into()],
        };

        assert_eq!(
            decide_service_start(Some(&handshake), 1, 3000, &HashSet::new()),
            Some(DiscoveryDecision::ConnectExternal)
        );
    }

    #[test]
    fn rejects_non_molibot_or_incompatible_service() {
        let handshake = ServiceHandshake {
            service: "other".into(),
            version: "1.0.0".into(),
            protocol_version: 1,
            instance_id: None,
            managed_by_desktop: false,
            capabilities: vec![],
        };

        assert_eq!(
            decide_service_start(Some(&handshake), 1, 3000, &HashSet::new()),
            Some(DiscoveryDecision::RejectIncompatible)
        );
    }

    #[test]
    fn falls_forward_without_terminating_an_occupied_port() {
        let occupied = HashSet::from([3000, 3001]);

        assert_eq!(
            decide_service_start(None, 1, 3000, &occupied),
            Some(DiscoveryDecision::StartManaged { port: 3002 })
        );
    }

    #[test]
    fn only_stops_app_managed_service_on_quit() {
        assert!(should_stop_on_quit(Some(&ServiceOwnership::Managed)));
        assert!(!should_stop_on_quit(Some(&ServiceOwnership::External)));
        assert!(!should_stop_on_quit(None));
    }

    #[test]
    fn compatibility_requires_the_shared_ownership_capability() {
        let mut handshake = ServiceHandshake {
            service: "molibot".into(),
            version: "2.2.4".into(),
            protocol_version: 1,
            instance_id: None,
            managed_by_desktop: false,
            capabilities: vec![],
        };
        assert!(!is_compatible_handshake(&handshake, 1));
        handshake.capabilities.push("service-ownership-v1".into());
        assert!(is_compatible_handshake(&handshake, 1));
    }
}
