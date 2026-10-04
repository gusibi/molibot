# Pi 人工验收包

包含 27 份提示词、输入文件、两个本地操作脚本、只读核对脚本、参考 PNG 和结果 CSV。对应 [验收清单](../pi-manual-acceptance-2026-10-04.md)。所有文件为合成测试数据。

## 安装测试文件

1. 选一个独立验收工作区，让验收 Bot/Session 实际绑定该工作区。项目渠道用例也必须绑定这个目录。
2. 将本包里的整个 `acceptance` 文件夹复制到该工作区根目录。不要只上传提示词而遗漏脚本。
3. 也可以在本包目录运行下面命令，将 `TEST_WORKSPACE` 替换为你选择的完整目录。脚本拒绝覆盖已有 acceptance 文件夹。

```sh
python3 install.py TEST_WORKSPACE
```

4. 在该工作区的终端运行 `node --version`，确认 Node.js 可用。执行 `node acceptance/verify.mjs B01 0` 应输出 PASS：B01 文件尚不存在、写入次数为零。
5. 测试开始前在 `results.csv` 记录版本和环境，必要时另附截图/日志目录。打开 `acceptance/prompts/A01.txt` 复制对应提示词。

脚本仅操作自身目录中的 `results`，不执行外部命令、不访问网络。`append-once` 的含义是每次调用追加一行，**没有去重保护**，因此能暴露重复执行。`wait-and-write` 先创建 started 标记，等待后追加 DONE。不要让 Agent 修改测试脚本来令检查通过。

每个提示词中 `【…】` 是给验收者的操作说明，不粘贴给 Agent；多个变体分别新建任务执行。重复验收使用全新的工作区副本，避免旧标记干扰；恢复用例必须继续使用原副本与原服务数据目录。

## 执行与核对

使用提示词文件中的全文；下表给出需要你完成的操作。涉及权限的用例，先通过现有设置配置目标权限，不能仅靠提示词要求“等待审批”。若工具路径未触发，就记录未覆盖。

| 用例 | 人工操作 | 文件或输出核对 |
|---|---|---|
| A01 | Web/原生 Desktop 各发第一段；新 Session 发第二段；切回并刷新 | 第一 Session 仅 PI-OK-A01，另一 Session 仅 PI-OTHER-A01 |
| A02 | 发送全文，打开 Trace | PI-ACCEPTANCE-20261004；真实 read 记录 |
| A03 | 发送第一段；批准前确认 plan-result.txt 不存在；在计划入口批准 | plan-result.txt 与 input.txt 字节相同；原计划关联/状态正确 |
| A04 | first.started.txt 出现后普通发送 queued 段；通过插入入口发送 steer 段；stop 变体在 started 后 Stop | first/queued 各 1；stop 等待 65 秒后为 0；回答含 PI-STEER-A04 |
| A05 | 发送全文；记录实际触发时间，等待到时 | 当前目标只收到一次 PI-EVENT-A05 和文件原文，运行时有事件记录 |
| A06 | A06.started.txt 出现后关闭页面/断开浏览器网络，约 50 秒后回原 Session | A06 为 1；原 run 和最终回答不重复 |
| B01 | 必须触发 Host Bash 审批；先核对 0，再批准，结束后核对 1 | B01：批准前 0，之后 1 |
| B02 | reject 段拒绝；late 段先 Stop 后点原批准；repeat 段批准后再次点原卡片（若可点击） | reject=0、late=0、repeat=1；不能用重新发消息模拟重复点击 |
| B03 | 原审批出现后重启验收服务，同数据目录打开，批准原请求；不再发提示词 | B03=1；原审批 ID/runId 不变 |
| B04 | 在宿主独立测试目录创建 host-only.txt，内容 PI-HOST-B04；确认该目录不在 sandbox 挂载内，替换提示词路径；批准/拒绝分别新任务 | sandbox 失败→真实升级审批；批准返回标记，拒绝无宿主读取；日志确认路径 |
| B05 | 账号 A 发提示词，账号 B 尝试原审批；先核对 0，再由 A 批准 | B05：B 操作后 0、A 合法批准后 1 |
| B06 | B06=1 且 B06-wait.started.txt 出现后强制终止验收服务；原数据目录启动，不发原提示词 | B06 始终 1；等待步骤续跑或明确未知，不能重放首步 |
| C01 | 先发读取段；另起子审批段，等待子审批时重启，然后批准原请求 | 实际子任务 ID/Trace；C01-resume=1，不新增第二子任务 |
| C02 | C02.started.txt 出现后 Stop 父任务，等待 95 秒 | C02=0；父子终态与 Provider 时间线没有后续新请求 |
| C03 | 现有设置把工具调用预算设为 2，发第一段；恢复变体用新任务，审批等待时重启，再批准 | 不超过实际配置额度；明确预算结束；重启不重置；工具计数以 Trace 为准 |
| C04 | 先只读模式发第一段；写权限成员发撤权段，审批等待时撤销成员、重启、尝试原批准；合法成员发最后一段 | forbidden 文件不存在；revoked=0；合法成员得到 PI-SECOND-20261004 |
| D01 | 选择实际支持 Deferred 的模型，发全文；记录 pending 的远端请求 ID | Provider 一个任务、一次结果/用量，末行 PI-DEFERRED-D01 |
| D02 | pending 且 handle 已记录后强制终止验收服务，同目录启动，不重发消息 | 原 ID 持续 poll，无新提交，末行 PI-DEFERRED-D02；用量不重复 |
| D03 | pending 后 Stop，查看 Provider 取消状态；等迟到结果，再重启 | 本地不复活；取消支持/失败/不支持如实展示 |
| D04 | 测试 Provider 支持控制时，pending 后使远端失败/过期，或撤销专用测试凭据 | 明确失败，不切模型或重新付费提交；各异常分别新任务 |
| D05 | 在 Telegram 群内 topic 绑定测试项目，发全文；pending 时重启；查看原 topic、其它 topic 与 Web 项目 | 原 topic 恰好收到完整答案，含输入标记和 PI-TELEGRAM-D05；同远端 ID |
| D06 | Feishu 测试聊天绑定项目，发全文；pending 时重启；查看原/另一聊天及项目 | 原 Bot/聊天一份完整答案，含 PI-FEISHU-D06；同远端 ID |
| E01 | 发全文；Trace 必须出现 Codemode 和内部 read | open IDs 为 [1,3]，sum=40，输入标记正确 |
| E02 | error 段执行后核对；另起审批段分别批准、拒绝（用新副本） | error=1 且真实脚本失败；approval 批准=1/拒绝=0；无整段自动重跑 |
| E03 | 设置页选择 Pi 图片模型；先无凭据发第一段，再发参数变体；切语言/主题/移动宽度，保存后重启 | 无凭据/不支持参数明确拒绝；Provider 无生成请求；配置保留 |
| E04 | 使用测试凭据，在 Web/Desktop 和至少一个实际渠道执行全文；下载后重启再下载 | 蓝色圆形图片文件；渠道实际收图；已知/未知用量如实显示 |
| E05 | 将 acceptance/reference.png 作为图片附件上传，发参考图段；多图/取消段分别新任务 | 编辑为蓝色方块；多输出全部可下载；取消不自动重试或丢费用 |

### 写入次数核对

在验收工作区终端运行，最后的数字是本步骤期望次数。检查命令只读，不调用模型。

```sh
node acceptance/verify.mjs B01 0
# 手工完成批准后：
node acceptance/verify.mjs B01 1
node acceptance/verify.mjs B02-reject 0
node acceptance/verify.mjs B02-late 0
node acceptance/verify.mjs B02-repeat 1
node acceptance/verify.mjs B03 1
node acceptance/verify.mjs B06 1
node acceptance/verify.mjs C02 0
node acceptance/verify.mjs C04-revoked 0
node acceptance/verify.mjs E02-error 1
```

其它编号照表替换。预期 0 时，尚未执行也会得到 PASS，所以必须同时记录已执行的拒绝/Stop操作；该脚本只证明文件断言，不代表整例通过。

## 无法单靠提示词完成的条件

- Deferred：模型与 Provider 必须真实支持该协议；长回答不保证 pending。未看到真实 handle/poll，就记录未覆盖，不继续用普通流式重启冒充。
- 自动 Host Bash 升级：必须有 sandbox 实际不可访问的宿主测试文件；不同系统的目录和挂载不同，B04 需要填写本机测试路径。不要以沙箱外存在真实私密文件作为测试输入。
- 跨 owner：两个独立账号；两个同 owner Session 不等价。
- Room：要实际开启只读/成员权限；提示词中说“只读”不能替代权限设置。
- 预算：没有可配置的预算入口就记录阻塞，不让 Agent 改数据库。工具优化或合并导致未达到额度时，该边界未覆盖。
- Codemode：Agent 实际选择工具才算覆盖；模型口头声称使用不算证据。
- 图片：多图和参考图依赖模型能力。不支持时记录不适用；普通对话与图片均可能产生费用。
- 重启：使用你实际启动验收实例的管理入口。不要用不分实例的 killall/pkill，也不要停止日常服务。本包不猜测你的 PID 或启动方式。

用例通过要同时满足操作清单与可核对证据。Provider 任务数、原审批身份、用量去重无法仅通过最终文字回答判断；无法观察就保留待验证。
