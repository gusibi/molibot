# Findings

- 根因：前端与原生层分离后，Logo 只实现了 WebView 状态和 localStorage；原生 tray 使用默认图标，没有系统图标命令。原测试只检查页面资源和浏览器保存，未覆盖原生调用。
- 单一清单：appLogos.json 供页面和 Rust 构建读取；native PNG 随编译嵌入。运行中的 macOS 图标经 NSApplication.applicationIconImage 更新，tray 经现有 molibot-tray 实例更新。
- 桌面偏好复用 desktop-preferences.json 的细粒度 appLogo 字段，临时文件原子替换，保留整对象其余字段；默认形象起步，不导入旧 WebView 偏好。Ready 恢复位于 Tauri 自身开发图标初始化之后。
- 17 个 Logo 均保留原图完整构图与透明通道，仅等比缩放导出 PNG；不添加背景、底板、圆角蒙版，也不裁切透明边缘。默认图原有内容同样保留。原先添加暖色底板的方案已按用户纠正删除。
- Fix 收尾：根因属于原生桥接遗漏 / 验收范围缺口；机器守卫覆盖 native 调用、确认时机、持久化、回滚及 UI 反馈。移除 native 调用和 native apply 步骤均使对应回归失败。现有分层与测试规则已涵盖要求，无需新增长期 pitfalls。
- 原生测试入口是尚未建设的失败占位脚本，不能证明真实系统界面。此处不扩建驱动基础设施，也不启动可能占用用户运行数据的主 App。
