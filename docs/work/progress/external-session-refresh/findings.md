# 发现

截图：外部 QQ 会话在桌面只读，最新用户消息下没有助手回复。Agent 首页最近对话时间/顺序滞后。既有排序规则为默认 Agent 置顶，其余按最新对话时间。

指定 session 及 sidecar 都包含今天 09:41 更新。两次模型调用以 401 api_key_expired / 402 Insufficient Balance 失败，无本轮 TTS 调用。昨天 ttsGenerate receipt uploaded=true，但桌面附件提取缺少 ttsGenerate 且不解码 molibotExecution 封装。缓存刷新失败吞错误；外部会话无轮询。已新增回归：4 项失败。

修复：共享会话刷新 scheduler 更新最近列表/Agent 时间和当前外部会话，按钮复用该 scheduler；恢复可见时刷新。外部刷新同时更新音频文件索引，失败保留缓存并提示，文件请求按连接和请求代次拒绝过期结果。当前封装工具回执复用 decodePiToolDetails，支持音频、图片和视频。
