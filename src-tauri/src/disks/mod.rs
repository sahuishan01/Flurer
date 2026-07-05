use serde::{Deserialize, Serialize};
use wmi::{COMLibrary, WMIConnection};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualDisk {
    pub drive_letter: String,
    pub volume_name: String,
    pub file_system: String,
    pub total_space: u64,
    pub free_space: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDisk {
    pub index: u32,
    pub model: String,
    pub size: u64,
    pub media_type: String,
    pub interface_type: String,
    pub volumes: Vec<VirtualDisk>,
}

#[derive(Deserialize, Debug)]
struct RawDiskDrive {
    #[serde(rename = "DeviceID")]
    device_id: String,
    #[serde(rename = "Index")]
    index: u32,
    #[serde(rename = "Model")]
    model: Option<String>,
    #[serde(rename = "Size")]
    size: Option<String>,
    #[serde(rename = "MediaType")]
    media_type: Option<String>,
    #[serde(rename = "InterfaceType")]
    interface_type: Option<String>,
}

#[derive(Deserialize, Debug)]
struct RawDiskPartition {
    #[serde(rename = "DeviceID")]
    device_id: String,
}

#[derive(Deserialize, Debug)]
struct RawLogicalDisk {
    #[serde(rename = "DeviceID")]
    device_id: String,
    #[serde(rename = "VolumeName")]
    volume_name: Option<String>,
    #[serde(rename = "FileSystem")]
    file_system: Option<String>,
    #[serde(rename = "Size")]
    size: Option<String>,
    #[serde(rename = "FreeSpace")]
    free_space: Option<String>,
}

fn parse_u64(value: &Option<String>) -> u64 {
    value.as_deref().and_then(|s| s.parse().ok()).unwrap_or(0)
}

// WQL associator paths need embedded backslashes doubled, since the query
// itself is a string literal that WMI parses a second time.
fn escape_wql_path(value: &str) -> String {
    value.replace('\\', "\\\\")
}

fn normalize_media_type(raw: &Option<String>) -> String {
    match raw.as_deref() {
        Some(m) if m.to_lowercase().contains("removable") => "Removable".to_string(),
        Some(m) if m.to_lowercase().contains("fixed") => "Fixed".to_string(),
        _ => "Unknown".to_string(),
    }
}

#[tauri::command]
pub fn get_disk_topology() -> Result<Vec<PhysicalDisk>, String> {
    let com_con = COMLibrary::new().map_err(|e| e.to_string())?;
    let wmi_con = WMIConnection::new(com_con).map_err(|e| e.to_string())?;

    let drives: Vec<RawDiskDrive> = wmi_con
        .raw_query("SELECT DeviceID, Index, Model, Size, MediaType, InterfaceType FROM Win32_DiskDrive")
        .map_err(|e| e.to_string())?;

    let mut disks = Vec::with_capacity(drives.len());
    for drive in drives {
        let partitions: Vec<RawDiskPartition> = wmi_con
            .raw_query(format!(
                "ASSOCIATORS OF {{Win32_DiskDrive.DeviceID='{}'}} WHERE AssocClass = Win32_DiskDriveToDiskPartition",
                escape_wql_path(&drive.device_id)
            ))
            .map_err(|e| e.to_string())?;

        let mut volumes = Vec::new();
        for partition in partitions {
            let logical_disks: Vec<RawLogicalDisk> = wmi_con
                .raw_query(format!(
                    "ASSOCIATORS OF {{Win32_DiskPartition.DeviceID='{}'}} WHERE AssocClass = Win32_LogicalDiskToPartition",
                    escape_wql_path(&partition.device_id)
                ))
                .map_err(|e| e.to_string())?;

            for logical in logical_disks {
                volumes.push(VirtualDisk {
                    drive_letter: logical.device_id,
                    volume_name: logical.volume_name.unwrap_or_default(),
                    file_system: logical.file_system.unwrap_or_default(),
                    total_space: parse_u64(&logical.size),
                    free_space: parse_u64(&logical.free_space),
                });
            }
        }

        disks.push(PhysicalDisk {
            index: drive.index,
            model: drive.model.unwrap_or_else(|| "Unknown disk".to_string()),
            size: parse_u64(&drive.size),
            media_type: normalize_media_type(&drive.media_type),
            interface_type: drive.interface_type.unwrap_or_default(),
            volumes,
        });
    }

    Ok(disks)
}
