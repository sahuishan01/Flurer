use serde::{de::Deserializer, Deserialize, Serialize};
use wmi::{COMLibrary, WMIConnection};

// WMI's uint64 properties are supposed to travel over DCOM as numeric strings
// (a documented WMI quirk), which is why these fields were originally typed
// as Option<String> - but some providers/systems hand back a real integer
// VARIANT instead, which then fails to deserialize into a String. Accept
// either representation rather than assuming one.
fn deserialize_flexible_u64<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrNumber {
        Text(String),
        Number(u64),
    }

    Ok(Option::<StringOrNumber>::deserialize(deserializer)?.and_then(|v| match v {
        StringOrNumber::Text(s) => s.parse().ok(),
        StringOrNumber::Number(n) => Some(n),
    }))
}

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
    #[serde(rename = "Size", default, deserialize_with = "deserialize_flexible_u64")]
    size: Option<u64>,
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
    #[serde(rename = "Size", default, deserialize_with = "deserialize_flexible_u64")]
    size: Option<u64>,
    #[serde(rename = "FreeSpace", default, deserialize_with = "deserialize_flexible_u64")]
    free_space: Option<u64>,
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

// Tauri (via WebView2) may already have COM initialized as single-threaded
// apartment on whatever thread runs this command, and wmi's COMLibrary::new()
// initializes multi-threaded apartment - mixing the two fails with
// RPC_E_CHANGED_MODE (0x80010106). Running the query on a brand-new OS thread
// guarantees no prior CoInitializeEx call to conflict with.
#[tauri::command]
pub fn get_disk_topology() -> Result<Vec<PhysicalDisk>, String> {
    std::thread::spawn(query_disk_topology)
        .join()
        .map_err(|_| "Disk query thread panicked".to_string())?
}

fn query_disk_topology() -> Result<Vec<PhysicalDisk>, String> {
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
                    total_space: logical.size.unwrap_or(0),
                    free_space: logical.free_space.unwrap_or(0),
                });
            }
        }

        disks.push(PhysicalDisk {
            index: drive.index,
            model: drive.model.unwrap_or_else(|| "Unknown disk".to_string()),
            size: drive.size.unwrap_or(0),
            media_type: normalize_media_type(&drive.media_type),
            interface_type: drive.interface_type.unwrap_or_default(),
            volumes,
        });
    }

    Ok(disks)
}
