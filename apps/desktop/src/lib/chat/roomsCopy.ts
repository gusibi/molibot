export const roomsCopy = {
  "zh-CN": {
    title: "Agent 房间", newRoom: "新建房间", name: "房间名称", members: "成员", primary: "默认回答者", project: "项目", regular: "普通房间",
    create: "创建房间", save: "保存", back: "返回房间列表", edit: "编辑成员", empty: "创建房间，邀请不同 Agent 一起讨论。", placeholder: "发送给默认回答者，或选择 @ 成员…",
    discussion: "多人讨论 · 受限 Plan 模式", direct: "单成员执行", limits: "多人讨论不开放搜索、MCP、Mini Apps 或命令执行。需要操作时，请交给一位成员执行。",
    execute: "交给此成员执行", reply: "回复", cancelReply: "取消引用", stopAll: "全部停止", stop: "停止", resume: "重试 / 继续", steer: "插入当前执行", remove: "删除房间",
    permission: "房间权限上限", inherit: "遵循全局限制", noMembers: "没有可用 Agent，请先在 Agent 设置中启用成员。", approve: "批准本次操作", reject: "拒绝", unknown: "外部操作结果未知，需要先核对结果。",
    queued: "排队中", running: "运行中", waiting_approval: "等待审批", cancelling: "正在停止", paused: "已暂停", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断", blocked: "等待成员空闲或房间写入资格", reconnecting: "连接中断，正在恢复…"
  },
  en: {
    title: "Agent Rooms", newRoom: "New room", name: "Room name", members: "Members", primary: "Primary Agent", project: "Project", regular: "Regular room",
    create: "Create room", save: "Save", back: "Back to rooms", edit: "Edit members", empty: "Create a room and invite different Agents to discuss.", placeholder: "Send to Primary, or select @ members…",
    discussion: "Multi-agent discussion · restricted Plan mode", direct: "Single-member execution", limits: "Discussion cannot search, access MCP or Mini Apps, or run commands. Ask one member to execute when needed.",
    execute: "Ask this member to execute", reply: "Reply", cancelReply: "Clear quote", stopAll: "Stop all", stop: "Stop", resume: "Retry / continue", steer: "Steer active run", remove: "Delete room",
    permission: "Room permission ceiling", inherit: "Follow global restrictions", noMembers: "No enabled Agents. Enable a member in Agent settings first.", approve: "Approve this operation", reject: "Reject", unknown: "An external operation has an unknown outcome. Reconcile it before continuing.",
    queued: "Queued", running: "Running", waiting_approval: "Waiting for approval", cancelling: "Stopping", paused: "Paused", completed: "Completed", failed: "Failed", cancelled: "Stopped", interrupted: "Interrupted", blocked: "Waiting for participant availability or Room writer eligibility", reconnecting: "Connection interrupted. Reconnecting…"
  }
} as const;
