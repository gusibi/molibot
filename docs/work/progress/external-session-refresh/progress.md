# 进度

开始排查；已有 TTS 转码修复保留。工作区存在大量用户/其他任务改动，仅编辑相关片段。

新增 7 个回归在修复前失败。已修复 canonical tool receipt 媒体读取与外部会话缓存错误隐藏，接入会话刷新 scheduler、标题栏按钮、中英文提示。生产桌面 build 通过；svelte-check 首次发现新增测试返回类型问题，已修正，复查 0 errors / 1 条既有 AgentCityInspector 警告。隔离 vite 服务因沙盒端口限制使用批准的执行权限启动；浏览器因沙盒 MachPort 权限使用批准的执行权限启动。

最终验证：58 项相关测试在临时 DATA_DIR 下连续 5 次全部通过；10 项相关静态 UI 守卫通过；后端定向 TypeScript 检查通过；桌面 svelte-check 0 errors / 1 条既有 AgentCityInspector warning；桌面 Vite build 通过（已有体积提示）。
浏览器冷路径：本任务的隔离 Vite 服务重启后，首次进入 → 手动刷新 → 本地 OGG 解码加载 → 断线保留缓存并恢复 → 会话切换与排序 → 自动刷新 → 中英/明暗/620px 检查全部通过，无 pageerror。API 全部本地模拟；无真实 Provider/渠道调用。
排错记录：首次 browser fixture 缺 dependencies、runs、files 与首次配置标志，补齐后通过；主题初始化脚本曾强制重置 light，改为仅首次写入。既有跨 Profile 测试试图写全局项目目录，被沙盒拒绝；后续统一设置临时 DATA_DIR，测试全部隔离通过。
交付前审查：保留缓存时错误可见；刷新文件索引与消息配套；新连接/会话与较新请求保护齐全；复用工具回执解码器；工作区外文件不暴露。未替换安装包，真实 QQ 投递和原生 App 验证未执行。
