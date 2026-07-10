import { invoke } from "@tauri-apps/api/core";

type AppInfo = {
  app_dir: string;
  downloads_dir: string;
  store_url: string;
  store_app_url: string;
};

type WingetResult = {
  available: boolean;
  success: boolean;
  code: number | null;
  message: string;
};

const DOWNLOAD_WAIT_MS = 30 * 60 * 1000;
const POLL_MS = 2000;

let logCount = 0;
let busy = false;

const statusText = document.querySelector<HTMLSpanElement>("#status-text")!;
const statusPill = document.querySelector<HTMLDivElement>("#status-pill")!;
const log = document.querySelector<HTMLPreElement>("#log")!;
const logCountEl = document.querySelector<HTMLSpanElement>("#log-count")!;
const startButton = document.querySelector<HTMLButtonElement>("#start-button")!;
const openStoreButton = document.querySelector<HTMLButtonElement>("#open-store-button")!;
const scanButton = document.querySelector<HTMLButtonElement>("#scan-button")!;
const appDir = document.querySelector<HTMLElement>("#app-dir")!;
const downloadsDir = document.querySelector<HTMLElement>("#downloads-dir")!;

function setStatus(message: string, mode: "ready" | "working" | "done" | "warn" = "working") {
  statusText.textContent = message;
  statusPill.dataset.mode = mode;
}

function write(message: string) {
  const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  log.textContent += `[${stamp}] ${message}\n`;
  log.scrollTop = log.scrollHeight;
  logCount += 1;
  logCountEl.textContent = `${logCount} 条`;
}

function setBusy(value: boolean) {
  busy = value;
  startButton.disabled = value;
  scanButton.disabled = value;
}

async function scanLocalInstaller(): Promise<string | null> {
  const installer = await invoke<string | null>("find_installer");
  if (installer) {
    write(`找到安装包: ${installer}`);
  } else {
    write("未找到本地 ChatGPT Installer.exe。");
  }
  return installer;
}

async function installFoundFile(path: string): Promise<boolean> {
  const complete = await invoke<boolean>("is_download_complete", { path });
  if (!complete) {
    write("安装包还在写入，继续等待。");
    return false;
  }

  const signature = await invoke<string>("signature_status", { path });
  write(`数字签名状态: ${signature}`);

  if (/^(NotSigned|HashMismatch|NotTrusted)/i.test(signature)) {
    setStatus("签名异常，已停止自动启动", "warn");
    write("安装包签名异常。请确认文件来源后手动运行。");
    return true;
  }

  await invoke("launch_elevated", { path });
  setStatus("已请求管理员权限", "done");
  write("已请求管理员权限启动安装包，请在弹窗中继续安装。");
  return true;
}

async function openStorePages() {
  setStatus("正在打开商店页面");
  write("正在打开 Microsoft Store 网页和商店应用。");
  await invoke("open_store_pages");
}

async function startFlow() {
  if (busy) return;

  setBusy(true);
  setStatus("正在检查本地安装包");
  write("开始安装流程。");

  try {
    const local = await scanLocalInstaller();
    if (local && (await installFoundFile(local))) {
      return;
    }

    setStatus("正在尝试 winget");
    write("尝试通过 winget 从 Microsoft Store 安装。");
    const winget = await invoke<WingetResult>("try_winget");
    if (!winget.available) {
      write("未检测到 winget，改用商店页面方式。");
    } else if (winget.success) {
      setStatus("winget 命令已完成", "done");
      write("winget 已完成安装命令。");
      return;
    } else {
      write(`winget 未完成安装: ${winget.message}`);
    }

    await openStorePages();
    write("请在打开的页面下载 ChatGPT Installer.exe；程序会监控下载目录。");

    const deadline = Date.now() + DOWNLOAD_WAIT_MS;
    while (Date.now() < deadline) {
      const installer = await invoke<string | null>("find_installer");
      if (installer && (await installFoundFile(installer))) {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
    }

    setStatus("等待超时", "warn");
    write("等待超时。也可以把 ChatGPT Installer.exe 放到本程序同目录后重新开始。");
  } catch (error) {
    setStatus("流程失败", "warn");
    write(`出错: ${String(error)}`);
  } finally {
    setBusy(false);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const info = await invoke<AppInfo>("app_info");
  appDir.textContent = info.app_dir;
  downloadsDir.textContent = info.downloads_dir;
  write(`程序目录: ${info.app_dir}`);
  write(`下载目录: ${info.downloads_dir}`);
  write(`目标页面: ${info.store_url}`);
  setStatus("准备就绪", "ready");

  startButton.addEventListener("click", startFlow);
  openStoreButton.addEventListener("click", openStorePages);
  scanButton.addEventListener("click", scanLocalInstaller);
});
