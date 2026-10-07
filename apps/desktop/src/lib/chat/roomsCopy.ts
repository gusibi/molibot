export const roomsCopy = {
  "zh-CN": {
    createTitle: "组建你的 Agent 团队", editTitle: "调整房间成员", setupDescription: "让不同专长的 Agent 在同一个房间里协作。",
    basics: "房间信息", basicsDescription: "给这次协作一个清晰的名字。", namePlaceholder: "例如：产品评审、每周规划…",
    membersDescription: "选择参与协作的 Agent，每位成员保留独立的身份与上下文。", selectedCount: "位已选", agentDescription: "使用此 Agent 的模型与专属指令",
    behavior: "协作方式", behaviorDescription: "设置默认回答者，以及房间的工作范围。", primaryDescription: "没有指定 @ 成员时，由这位 Agent 回答。",
    projectDescription: "关联项目后，成员可在项目的工作范围内协作。", permissionDescription: "成员执行操作时仍需遵守自身权限与全局限制。",
    chooseMembers: "先选择房间成员", teamReady: "位成员准备加入", cancel: "取消", saving: "正在保存…",
    conversations: "会话", newConversation: "新建会话", conversation: "会话",
    memberModels: "使用成员模型",
    title: "Agent Team", newRoom: "新建房间", name: "房间名称", members: "成员", primary: "默认回答者", project: "项目", regular: "普通房间",
    create: "创建房间", save: "保存", back: "返回房间列表", edit: "编辑成员", empty: "创建房间，邀请不同 Agent 一起讨论。", placeholder: "发送给默认回答者，或选择 @ 成员…",
    discussion: "多人讨论 · 只读模式", direct: "单成员执行", limits: "多人讨论不开放搜索、MCP、Mini Apps 或命令执行。需要操作时，请交给一位成员执行。",
    execute: "交给此成员执行", reply: "回复", cancelReply: "取消引用", stopAll: "全部停止", stop: "停止", resume: "重试 / 继续", steer: "插入当前执行", remove: "删除房间",
    permission: "房间权限上限", inherit: "遵循全局限制", noMembers: "没有可用 Agent，请先在 Agent 设置中启用成员。", approve: "批准本次操作", reject: "拒绝", unknown: "外部操作结果未知，需要先核对结果。",
    queued: "排队中", running: "运行中", waiting_approval: "等待审批", cancelling: "正在停止", paused: "已暂停", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断", blocked: "等待成员空闲或房间写入资格", reconnecting: "连接中断，正在恢复…"
  },
  en: {
    createTitle: "Bring your Agents together", editTitle: "Refine your room", setupDescription: "A shared space for Agents with different strengths to collaborate.",
    basics: "Room details", basicsDescription: "Give this collaboration a clear name.", namePlaceholder: "e.g. Product review, Weekly planning…",
    membersDescription: "Choose your team. Each Agent keeps its own identity and context.", selectedCount: "selected", agentDescription: "This Agent’s own model and instructions",
    behavior: "How you collaborate", behaviorDescription: "Choose who responds and where the team works.", primaryDescription: "This Agent responds when you don’t @ a specific member.",
    projectDescription: "Link a project to work within its workspace.", permissionDescription: "Operations still respect each Agent’s permissions and global restrictions.",
    chooseMembers: "Choose your room members", teamReady: "members ready to join", cancel: "Cancel", saving: "Saving…",
    conversations: "Conversations", newConversation: "New conversation", conversation: "Conversation",
    memberModels: "Use member models",
    title: "Agent Teams", newRoom: "New room", name: "Room name", members: "Members", primary: "Primary Agent", project: "Project", regular: "Regular room",
    create: "Create room", save: "Save", back: "Back to rooms", edit: "Edit members", empty: "Create a room and invite different Agents to discuss.", placeholder: "Send to Primary, or select @ members…",
    discussion: "Multi-agent discussion · read-only mode", direct: "Single-member execution", limits: "Discussion cannot search, access MCP or Mini Apps, or run commands. Ask one member to execute when needed.",
    execute: "Ask this member to execute", reply: "Reply", cancelReply: "Clear quote", stopAll: "Stop all", stop: "Stop", resume: "Retry / continue", steer: "Steer active run", remove: "Delete room",
    permission: "Room permission ceiling", inherit: "Follow global restrictions", noMembers: "No enabled Agents. Enable a member in Agent settings first.", approve: "Approve this operation", reject: "Reject", unknown: "An external operation has an unknown outcome. Reconcile it before continuing.",
    queued: "Queued", running: "Running", waiting_approval: "Waiting for approval", cancelling: "Stopping", paused: "Paused", completed: "Completed", failed: "Failed", cancelled: "Stopped", interrupted: "Interrupted", blocked: "Waiting for participant availability or Room writer eligibility", reconnecting: "Connection interrupted. Reconnecting…"
  }
} as const;
