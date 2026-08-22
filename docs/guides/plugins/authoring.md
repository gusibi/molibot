# Molibot 插件开发与配置契约规范 (Plugin Authoring Contract)

> 适用版本: Molibot v2.9+ (Issue #34)

Molibot 插件采用**插件自有设置与独立存储架构**（Plugin-owned Settings and Storage），插件独立拥有自己的前端设置界面、配置数据与运行状态，而宿主仅维护启用开关与安全生命周期。

---

## 1. 目录结构与存储模型

插件文件统一放置在全局所有者数据根目录 `<dataDir>/plugins/` 下：

```text
<dataDir>/plugins/
  packages/<plugin-id>/       # 插件安装代码与静态资源（升级时可整体替换）
    package.json              # 包含 molibot.plugin 清单声明
    ui/                       # 前端静态资源（Custom 模式）
      index.html
      icon.svg
    runtime.mjs               # 运行时 Action 模块（Custom 模式）
  config/<plugin-id>/         # 持久化用户配置（卸载时默认保留）
    settings.json             # 非敏感常规配置
    secrets.json              # 密钥文件（0600 权限，严禁直接返回前端）
  data/<plugin-id>/           # 持久化业务/领域数据
  cache/<plugin-id>/          # 可随时安全清空的临时缓存
```

---

## 2. 插件清单规范 (`package.json#molibot.plugin`)

所有配置均声明在 `package.json` 中的 `molibot.plugin` 节点下：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "molibot": {
    "plugin": {
      "manifestVersion": 1,
      "id": "my-plugin",
      "name": "My Plugin",
      "version": "1.0.0",
      "description": "One-line plugin summary",
      "engines": {
        "molibot": ">=2.9.0"
      },
      "config": {
        "schemaVersion": 1
      },
      "settings": { ... }
    }
  }
}
```

### 模式 A: Schema Mode (声明式模式)
适用于只有表单字段的简单插件，由 Molibot 宿主原生渲染：

```json
"settings": {
  "mode": "schema",
  "schema": {
    "type": "object",
    "properties": {
      "endpoint": { "type": "string" },
      "apiKey": { "type": "string" },
      "enabled": { "type": "boolean" }
    },
    "required": ["endpoint"]
  },
  "presentation": [
    {
      "key": "endpoint",
      "label": { "zh": "服务地址", "en": "Service Endpoint" },
      "description": { "zh": "API 基础 URL", "en": "API base URL" },
      "placeholder": "https://api.example.com"
    },
    {
      "key": "apiKey",
      "label": { "zh": "API 密钥", "en": "API Key" },
      "secret": true
    }
  ]
}
```

### 模式 B: Custom Mode (自定义界面模式)
适用于具有复杂配置向导、环境检测、安装或交互式测试流程的插件：

```json
"settings": {
  "mode": "custom",
  "ui": {
    "entry": "ui/index.html",
    "icon": "ui/icon.svg"
  }
},
"runtime": {
  "entry": "runtime.mjs"
},
"capabilities": ["spawn", "network"]
```

---

## 3. Custom UI 与 postMessage Bridge 通信协议

自定义界面在沙箱 `iframe` (`sandbox="allow-scripts"`) 中运行，通过 `window.parent.postMessage` 与宿主双向通信。

### 消息格式

#### 插件发往宿主 (Plugin -> Host)
- `ready`: 页面就绪握手。
- `get_settings`: 请求读取当前非敏感配置。
- `save_settings`: 保存非敏感配置 `{ values: { ... } }`。
- `get_secrets_presence`: 请求查看密码字段是否存在 `{ presence: { apiKey: { present: true } } }`。
- `save_secrets`: 更新或清除密码 `{ replace: { apiKey: "..." }, clear: ["oldKey"] }`。
- `invoke_action`: 调用 `runtime.mjs` 中导出的 Settings Action `{ action: "detectEnv", input: { ... } }`。

#### 宿主发往插件 (Host -> Plugin)
- `bootstrap`: 启动元数据（locale, theme, pluginId, pluginVersion, enabled）。
- `settings_data`: 返回的配置对象。
- `secrets_presence`: 密码存在性元数据。
- `action_result` / `action_progress`: 动作执行结果与进度。
- `saved`: 保存成功回执。
- `error`: 错误通知。

---

## 4. Settings Runtime Actions (`runtime.mjs`)

Custom 模式下的运行时动作在独立子进程故障域中执行，具备超时（deadline）、中断与进程树清理保护：

```javascript
export async function detectEnvironment(input, ctx) {
  // ctx.config: 当前配置
  // ctx.secrets: 密钥值（仅运行时可用）
  // ctx.dataDir: 持久化数据根路径
  // ctx.cacheDir: 临时缓存根路径
  // ctx.emitProgress({ step: "...", percent: 50 });
  return { available: true, version: "1.0.0" };
}
```

---

## 5. 生命周期与数据保留约定

- **安装 (Install)**: 校验清单，分配独立目录，激活代码。
- **升级 (Upgrade)**: 仅替换 `packages/<plugin-id>/` 目录代码，配置和数据完全不受影响。
- **停用 (Disable)**: 立即在调用入口处拦截所有能力与 Actions。
- **卸载 (Uninstall)**: 移除插件代码与临时缓存，默认保留 `config/` 与 `data/` 目录。
- **重装 (Reinstall)**: 自动恢复并复用保留的配置与数据。
