# ChatGPT 安装助手 Tauri 版

这是一个 Tauri 2 桌面应用版本的 ChatGPT 安装助手。

功能：

- 优先查找本程序同目录、当前目录、下载目录里的 `ChatGPT Installer.exe`
- 找到安装包后检查文件是否写入完成
- 调用 PowerShell 检查安装包 Authenticode 签名状态
- 签名无明显异常时请求管理员权限启动安装包
- 如果本地没有安装包，尝试 `winget install --id 9PLM9XGG6VKS --source msstore`
- 如果 `winget` 不可用或失败，打开 Microsoft Store 网页和商店应用页面，并继续监控下载目录

## 开发运行

需要先安装 Rust/Cargo 和 Node.js。

```powershell
npm install
npm run tauri dev
```

## 打包

```powershell
npm run tauri build
```

Windows 云端构建默认生成免安装 exe。常见输出位置：

```text
src-tauri\target\release\
```

## GitHub Actions 云端打包

本项目已经包含工作流：

```text
.github\workflows\build-tauri-windows.yml
```

使用方法：

1. 把整个项目推送到 GitHub 仓库
2. 打开仓库的 Actions 页面
3. 选择 `Build Tauri Windows`
4. 点击 `Run workflow`
5. 构建完成后，在该次 workflow 页面底部下载 artifact：`ChatGPT-installer-assistant-windows`，或下载 Tauri action 自动上传的 Windows artifact

也可以推送形如 `v1.0.0` 的 tag 自动触发构建：

```powershell
git tag v1.0.0
git push origin v1.0.0
```

## 当前环境说明

当前机器已经通过了前端构建：

```powershell
npm run build
```

但当前机器没有检测到 `cargo`，所以还不能直接生成 Tauri 的最终 exe/msi/nsis 安装包。安装 Rust 后重新运行：

```powershell
npm run tauri build
```

## 数字签名

Tauri 不强制你给 exe 签名；不签名也能运行。但分发给别人时，Windows SmartScreen 可能显示“未知发布者”。

正式分发建议使用 OV/EV 代码签名证书。自己用或内部分发可以不签名，或使用自签名证书。
