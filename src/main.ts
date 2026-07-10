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

type StatusMode = "ready" | "working" | "done" | "warn";
type PhaseName = "prepare" | "acquire" | "verify" | "install";

const DOWNLOAD_WAIT_MS = 30 * 60 * 1000;
const POLL_MS = 2000;
const phases: PhaseName[] = ["prepare", "acquire", "verify", "install"];

let logCount = 0;
let busy = false;

const statusText = document.querySelector<HTMLSpanElement>("#status-text")!;
const statusPill = document.querySelector<HTMLDivElement>("#status-pill")!;
const log = document.querySelector<HTMLPreElement>("#log")!;
const logCountEl = document.querySelector<HTMLSpanElement>("#log-count")!;
const startButton = document.querySelector<HTMLButtonElement>("#start-button")!;

function setStatus(message: string, mode: StatusMode = "working") {
  statusText.textContent = message;
  statusPill.dataset.mode = mode;
}

function setPhase(active: PhaseName, done: PhaseName[] = [], warn: PhaseName[] = []) {
  for (const phase of phases) {
    const node = document.querySelector<HTMLElement>(`#phase-${phase}`)!;
    node.classList.toggle("is-active", phase === active);
    node.classList.toggle("is-done", done.includes(phase));
    node.classList.toggle("is-warn", warn.includes(phase));
  }
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
}

async function scanLocalInstaller(): Promise<string | null> {
  const installer = await invoke<string | null>("find_installer");
  if (installer) {
    write(`找到安装包: ${installer}`);
  } else {
    write("未找到本地安装包，继续尝试其他获取方式。");
  }
  return installer;
}

async function installFoundFile(path: string, completed: PhaseName[] = ["prepare", "acquire"]): Promise<boolean> {
  setPhase("verify", completed);
  setStatus("正在验证安装包");

  const complete = await invoke<boolean>("is_download_complete", { path });
  if (!complete) {
    write("安装包还在写入，继续等待。");
    return false;
  }

  const signature = await invoke<string>("signature_status", { path });
  write(`数字签名状态: ${signature}`);

  if (/^(NotSigned|HashMismatch|NotTrusted)/i.test(signature)) {
    setPhase("verify", completed, ["verify"]);
    setStatus("签名异常，已停止自动启动", "warn");
    write("安装包签名异常。请确认文件来源后手动运行。");
    return true;
  }

  setPhase("install", [...completed, "verify"]);
  setStatus("正在启动安装程序");
  await invoke("launch_elevated", { path });
  setPhase("install", ["prepare", "acquire", "verify", "install"]);
  setStatus("已请求管理员权限", "done");
  write("已请求管理员权限启动安装包，请在弹窗中继续安装。");
  return true;
}

async function openStorePages() {
  setPhase("acquire", ["prepare"]);
  setStatus("正在打开 Microsoft Store");
  write("正在打开 Microsoft Store 页面。");
  await invoke("open_store_pages");
}

async function startFlow() {
  if (busy) return;

  setBusy(true);
  setPhase("prepare");
  setStatus("正在准备安装");
  write("开始安装流程。");

  try {
    const info = await invoke<AppInfo>("app_info");
    write(`下载目录: ${info.downloads_dir}`);

    setPhase("acquire", ["prepare"]);
    setStatus("正在查找安装包");
    const local = await scanLocalInstaller();
    if (local && (await installFoundFile(local))) {
      return;
    }

    write("尝试通过系统安装通道获取 ChatGPT。");
    const winget = await invoke<WingetResult>("try_winget");
    if (winget.success) {
      setPhase("install", ["prepare", "acquire"]);
      setStatus("系统安装命令已完成", "done");
      write("系统安装命令已完成。");
      return;
    }

    if (winget.available) {
      write(`系统安装通道未完成: ${winget.message}`);
    } else {
      write("系统安装通道不可用，改为打开 Microsoft Store。");
    }

    await openStorePages();
    write("请在打开的页面下载 ChatGPT Installer.exe；程序会继续监控下载目录。");

    const deadline = Date.now() + DOWNLOAD_WAIT_MS;
    while (Date.now() < deadline) {
      const installer = await invoke<string | null>("find_installer");
      if (installer && (await installFoundFile(installer))) {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
    }

    setPhase("acquire", ["prepare"], ["acquire"]);
    setStatus("等待超时", "warn");
    write("等待超时。也可以把 ChatGPT Installer.exe 放到本程序同目录后重新开始。");
  } catch (error) {
    setStatus("安装流程失败", "warn");
    write(`出错: ${String(error)}`);
  } finally {
    setBusy(false);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  setPhase("prepare");
  setStatus("准备就绪", "ready");
  write("准备就绪。点击“安装 ChatGPT”开始。");

  startButton.addEventListener("click", startFlow);
});
