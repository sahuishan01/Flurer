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
struct RawAssociation {
    #[serde(rename = "Antecedent")]
    antecedent: String,
    #[serde(rename = "Dependent")]
    dependent: String,
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

// WMI escapes backslashes when it renders an object path as text (e.g. inside
// an association's Antecedent/Dependent string), so a DeviceID with
// backslashes - like a physical drive's `\\.\PHYSICALDRIVE0` - shows up there
// with each backslash doubled. Match that rendering to find it by substring.
fn escape_backslashes(value: &str) -> String {
    value.replace('\\', "\\\\")
}

// Pulls the key value out of a quoted `Something.DeviceID="value"` segment of
// a WMI object path string, e.g. "C:" out of a Win32_LogicalDisk path.
fn extract_device_id(path: &str) -> Option<String> {
    let marker = "DeviceID=\"";
    let start = path.find(marker)? + marker.len();
    let rest = &path[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
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

// Rather than building one `ASSOCIATORS OF {Class.Key='...'}` query per disk
// and per partition (fragile: it depends on hand-escaping each DeviceID
// exactly right inside a WQL string literal, and a bad escape shows up as an
// opaque WBEM_E_NOT_FOUND at runtime), pull each association table once with
// a plain SELECT and join them in Rust. Only the physical drive's DeviceID
// ever needs matching against WMI's own escaped rendering of it; everything
// else is a plain string comparison that can't fail a query parse.
fn query_disk_topology() -> Result<Vec<PhysicalDisk>, String> {
    let com_con = COMLibrary::new().map_err(|e| e.to_string())?;
    let wmi_con = WMIConnection::new(com_con).map_err(|e| e.to_string())?;

    let drives: Vec<RawDiskDrive> = wmi_con
        .raw_query("SELECT DeviceID, Index, Model, Size, MediaType, InterfaceType FROM Win32_DiskDrive")
        .map_err(|e| e.to_string())?;

    let drive_to_partition: Vec<RawAssociation> = wmi_con
        .raw_query("SELECT Antecedent, Dependent FROM Win32_DiskDriveToDiskPartition")
        .map_err(|e| e.to_string())?;

    let partition_to_logical: Vec<RawAssociation> = wmi_con
        .raw_query("SELECT Antecedent, Dependent FROM Win32_LogicalDiskToPartition")
        .map_err(|e| e.to_string())?;

    let logical_disks: Vec<RawLogicalDisk> = wmi_con
        .raw_query("SELECT DeviceID, VolumeName, FileSystem, Size, FreeSpace FROM Win32_LogicalDisk")
        .map_err(|e| e.to_string())?;

    let mut logical_by_id: std::collections::HashMap<String, RawLogicalDisk> =
        logical_disks.into_iter().map(|d| (d.device_id.clone(), d)).collect();

    let mut disks = Vec::with_capacity(drives.len());
    for drive in drives {
        let escaped_id = escape_backslashes(&drive.device_id);

        let mut volumes = Vec::new();
        for dp in drive_to_partition.iter().filter(|dp| dp.antecedent.contains(&escaped_id)) {
            for pl in partition_to_logical.iter().filter(|pl| pl.antecedent == dp.dependent) {
                let Some(drive_letter) = extract_device_id(&pl.dependent) else {
                    continue;
                };
                let Some(logical) = logical_by_id.remove(&drive_letter) else {
                    continue;
                };

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
