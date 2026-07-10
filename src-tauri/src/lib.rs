use serde::Serialize;
use std::{
    env,
    fs,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};

const STORE_URL: &str = "https://apps.microsoft.com/detail/9plm9xgg6vks?hl=zh-CN";
const STORE_APP_URL: &str = "ms-windows-store://pdp/?productid=9PLM9XGG6VKS";
const INSTALLER_NAME: &str = "ChatGPT Installer.exe";

#[derive(Serialize)]
struct AppInfo {
    app_dir: String,
    downloads_dir: String,
    store_url: String,
    store_app_url: String,
}

#[derive(Serialize)]
struct WingetResult {
    available: bool,
    success: bool,
    code: Option<i32>,
    message: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        app_dir: app_dir().display().to_string(),
        downloads_dir: downloads_dir().display().to_string(),
        store_url: STORE_URL.to_string(),
        store_app_url: STORE_APP_URL.to_string(),
    }
}

#[tauri::command]
fn find_installer() -> Option<String> {
    find_installer_path().map(|path| path.display().to_string())
}

#[tauri::command]
fn is_download_complete(path: String) -> bool {
    let path = PathBuf::from(path);
    if !path.exists() || !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe")) {
        return false;
    }

    let first_size = match fs::metadata(&path) {
        Ok(meta) => meta.len(),
        Err(_) => return false,
    };
    if first_size == 0 {
        return false;
    }

    thread::sleep(Duration::from_millis(1500));

    fs::metadata(&path)
        .map(|meta| meta.len() == first_size)
        .unwrap_or(false)
}

#[tauri::command]
fn open_store_pages() -> Result<(), String> {
    open_url(STORE_URL)?;
    thread::sleep(Duration::from_millis(400));
    open_url(STORE_APP_URL)?;
    Ok(())
}

#[tauri::command]
fn try_winget() -> WingetResult {
    let Some(winget) = find_on_path("winget.exe") else {
        return WingetResult {
            available: false,
            success: false,
            code: None,
            message: "未检测到 winget。".to_string(),
        };
    };

    match Command::new(winget)
        .args([
            "install",
            "--id",
            "9PLM9XGG6VKS",
            "--source",
            "msstore",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ])
        .output()
    {
        Ok(output) => {
            let code = output.status.code();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let details = if !stdout.is_empty() { stdout } else { stderr };
            WingetResult {
                available: true,
                success: output.status.success(),
                code,
                message: if details.is_empty() {
                    format!("winget 返回代码 {:?}。", code)
                } else {
                    details
                },
            }
        }
        Err(error) => WingetResult {
            available: true,
            success: false,
            code: None,
            message: format!("winget 启动失败: {error}"),
        },
    }
}

#[tauri::command]
fn signature_status(path: String) -> String {
    let Some(powershell) = find_on_path("powershell.exe") else {
        return "未检查".to_string();
    };

    let script = "$sig = Get-AuthenticodeSignature -LiteralPath $args[0]; \
        $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }; \
        Write-Output ($sig.Status.ToString() + '|' + $subject)";

    match Command::new(powershell)
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
            &path,
        ])
        .output()
    {
        Ok(output) if output.status.success() => {
            let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if value.is_empty() {
                "未检查".to_string()
            } else {
                value
            }
        }
        _ => "未检查".to_string(),
    }
}

#[tauri::command]
fn launch_elevated(path: String) -> Result<(), String> {
    let escaped = path.replace('\'', "''");
    let script = format!("Start-Process -FilePath '{}' -Verb RunAs", escaped);
    let Some(powershell) = find_on_path("powershell.exe") else {
        return Err("未找到 powershell.exe，无法请求管理员权限。".to_string());
    };

    Command::new(powershell)
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动安装包失败: {error}"))
}

fn app_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn downloads_dir() -> PathBuf {
    env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Downloads")
}

fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    push_unique(&mut dirs, app_dir());
    if let Ok(cwd) = env::current_dir() {
        push_unique(&mut dirs, cwd);
    }
    push_unique(&mut dirs, downloads_dir());
    dirs
}

fn push_unique(dirs: &mut Vec<PathBuf>, dir: PathBuf) {
    if !dirs.iter().any(|existing| existing == &dir) {
        dirs.push(dir);
    }
}

fn find_installer_path() -> Option<PathBuf> {
    for dir in candidate_dirs() {
        if !dir.exists() {
            continue;
        }

        let exact = dir.join(INSTALLER_NAME);
        if exact.exists() {
            return Some(exact);
        }

        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };

        let mut matches = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with("ChatGPT Installer") && name.ends_with(".exe"))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();

        matches.sort_by_key(|path| fs::metadata(path).and_then(|meta| meta.modified()).ok());
        if let Some(path) = matches.pop() {
            return Some(path);
        }
    }
    None
}

fn open_url(url: &str) -> Result<(), String> {
    Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("打开链接失败: {error}"))
}

fn find_on_path(file_name: &str) -> Option<PathBuf> {
    let path_value = env::var_os("PATH")?;
    env::split_paths(&path_value)
        .map(|dir| dir.join(file_name))
        .find(|path| path.exists())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            find_installer,
            is_download_complete,
            open_store_pages,
            try_winget,
            signature_status,
            launch_elevated
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
