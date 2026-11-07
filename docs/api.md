# NailMate API

基址 `/api`。所有 POST 请求使用 `Content-Type: application/json`。接口用于同一个本地演示工作区。写入成功后返回数据库快照，页面据此更新，复盘由已执行任务聚合。

## 接口一览

| 方法和路径 | 请求示例 | 成功响应 |
| --- | --- | --- |
| GET `/api/state` | 无 | `{ "members": [...], "tasks": [...], "logs": [...] }` |
| GET `/api/members/:id/details` | 无 | `{ "orders": [...], "notes": [...], "contacts": [...], "appointments": [...], "careProfile": {...} }` |
| POST `/api/tasks` | `{"goal":"balance","memberIds":["M0002"]}` | `{"created":1,"state":{...}}` |
| POST `/api/tasks/:id/review` | `{"decision":"approve","message":"你好，需要帮你预约吗？"}` 或 `{"decision":"reject"}` | `{"state":{...}}` |
| POST `/api/tasks/:id/execute` | `{"scenario":"booking"}` | `{"state":{...}}` |
| POST `/api/care-records` | `{"memberId":"M0002","outcome":"已沟通","note":"顾客希望稍后联系","owner":"店长","followUp":"2026-11-21"}` | `{"state":{...}}` |
| POST `/api/reset` | `{}` | `{"state":{...}}` |

所有成功响应为 HTTP 200。错误返回 `{"error":"可读提示"}`。400 为字段或 JSON 无效，404 为接口或任务不存在，409 为候选变化、资格失效或任务状态冲突，413 为请求体超过 16 KB，415 为 POST 不是 JSON，500 为服务端或数据库错误。

## 字段与约束

- `members` 是会员快照。字符串字段为 `id`、`style`、`secondary`、`level`、`lastVisit`（`YYYY-MM-DD`）与 `lifecycle`。生命周期取值为 `active`、`due`、`low_frequency`、`dormant`。
- 会员数值字段为 `days`（未到店天数）、`cycle`（平均复购周期天数）、`visits`（历史次数）、`spend`（累计消费，元）、`bal`（余额，元）、`contactDays`（距上次联系天数）、`ratio`（偏离倍数）。`consent`、`complaint`、`appointment` 分别表示营销授权、未处理投诉、未来预约，均为布尔值。
- `goal` 取 `wake`（沉睡唤醒）、`balance`（余额提醒）、`launch`（新品邀约）或 `general`（通用演示）。前三种每次接收当前推荐名单中的 1 至 5 个不同会员编号。通用演示仅接收 1 位会员。后端复核整批请求，有候选失效时整批退回。
- 八栏界面使用同一个 POST `/api/tasks`，请求为 `{"opportunity":"care","memberIds":["M0002"]}`。`opportunity` 取 `all`、`wake`、`repurchase`、`balance`、`care`、`preview`、`scheduled`、`greeting`，不能与 `goal` 同时提交。后端复核本机会当前推荐的最多 8 位会员，整批保存或整批退回。旧 `goal` 请求仍最多 5 人。
- 机会人数可重叠，不相加。普通机会共用授权、无投诉、无未来预约、至少 14 天联系冷却、未处理、无未拒绝任务的限制。沉睡要求 `dormant`；到期复购要求 `due` 或 `low_frequency`；储值关怀要求周期偏离大于 1.15 且有余额；护理回访读取最新美甲服务订单，要求距基准日 1–7 天并同意护理跟进。新品预告面向活跃会员，匹配主/次偏好和未来 14 天发布的美甲款式；日常问候要求活跃、至少 2 次消费且至少 30 天未联系。
- 各机会按业务依据排序，同值按会员编号升序；全部机会先按定时回访、新品预告、日常问候、护理回访、沉睡、复购、储值顺序分配会员，再轮流取人，避免一种机会占满。定时回访要求已有本地关怀计划到期、无待审核/已批准任务、冷却满 14 天；同一计划只执行一次。所有模拟触达都会更新派生冷却天数。任务保留原 `goal` 枚举，具体经营目的在 `context.objective` 保存，审核和执行复核资格及产品。
- 任务状态从 `pending_review` 进入 `approved` 或 `rejected`。只有 `approved` 可以进入 `executed_simulated`。通过时必须传入去除首尾空白后为 1 至 1000 字符的话术。一个会员只能有一条待审核/已批准任务；普通机会还排除已执行会员，定时回访可在冷却期后承接新的到期计划。
- `scenario` 支持 `noReply`（未回复）、`reply`（已回复，未预约）、`booking`（已预约，待到店）、`visit`（已到店并消费）。只有 `visit` 产生固定演示消费 168 元。
- `logs` 返回最新 40 条，包含 `name`（动作名）、`desc`（描述）和 `time`（北京时间 `HH:mm:ss`）。
- `POST /api/reset` 清空关怀记录、文案、演示任务和日志，重建一条通用待审核任务；保留会员、来源数据、上传图片和会员备注。任务 ID 继续递增。界面的「重置界面」只复位前端状态，不调用本接口。

## 执行后的任务示例

```json
{
  "id": "T0002",
  "memberId": "M0002",
  "goal": "balance",
  "status": "executed_simulated",
  "strategy": "余额提醒",
  "priority": 83,
  "message": "你好呀，你的美甲账户还有 ¥880 余额。如果近期想来做美甲，需要我帮你看看预约时间吗？",
  "reason": "96 天未到店 · 平均周期 31 天 · 储值余额 ¥880",
  "editedMessage": "你好，需要帮你预约吗？",
  "result": { "reply": true, "booking": true, "visit": false, "spending": 0 }
}
```

模拟执行前 `result` 为 `null`，审核通过前 `editedMessage` 为空字符串。

## 关怀记录与跟进计划

`GET /api/state` 和写入返回的 `state` 增加 `careRecords` 数组，按记录 ID 倒序。每条记录包含数字 `id`、`memberId`、`outcome`、`note`、`owner`、`followUp` 和 `recordedAsOf`。日期统一为 `YYYY-MM-DD`，未安排跟进时 `followUp` 为 `null`。基准日为 `2026-11-07`。

- `outcome` 支持「已沟通」「未回复」「暂不联系」「推荐不合适」「不再营销」。反馈或原因 `note` 必填，去除首尾空白后最多 1000 字符。负责人 `owner` 必填，最多 80 字符。
- `followUp` 可省略或传 `null`。有日期时必须是真实日期且晚于基准日。「已沟通」「未回复」至少间隔 14 天，即最早 `2026-11-21`。「推荐不合适」「不再营销」不能附带跟进计划。计划到期后可进入定时回访机会，仍须满足联系资格和冷却期。
- 保存前检查联系资格。同一会员同一天不可重复提交；旧记录的计划已到期时可追加新反馈，保留历史记录。重复或并发提交返回 409，记录和日志一起提交。
- 会员快照增加 `careHandled`（是否已处理）、`carePaused`（是否暂不联系）。已处理会员退出推荐；「已沟通」「未回复」将有效 `contactDays` 设为 0；「不再营销」将有效 `consent` 设为 false。审核和执行会重新检查这些限制。
- 这些限制由关怀记录派生，基础会员档案继续保留。重置演示时清空关怀记录、计划、任务和日志，恢复基础会员资格，重建初始任务。

## 来源数据与产品

状态快照增加 `products` 和 `dataSource`。产品包含 `id`、`name`、`style`、`price`，导入后另有 `type`、`isNew`、`isActive`、`launchDate`、`description`、`imageStatus`、`imageAlt`。产品推荐排除未上架、未发布和非美甲款式；新品邀约另检查 `isNew`。任务话术和依据在创建时保存，后续目录更新不改写既有任务。

导入后的 `dataSource` 包含 `kind: "sqlite_import"`、`sourceHash`、`importedAt` 和各来源表的行数 `counts`。尚未导入时为 `{ "kind": "generated_demo" }`。会员增加 `displayName`、`latestNote`、`preferredTechnician`、`cycleConfidence`、`source` 等来源信息。

增强版界面使用会员快照中的 `careProfile` 摘要，包含 `memberId`、`tags`、`lastService`、`preferredService`、`followupDate` 和 `status`；没有来源护理档案时为 `null`。护理机会以真实近期美甲订单和 `optIn` 为准，已有店主关怀记录仍可查看。会员历史接口中的 `careProfile` 继续返回原始档案字段。

会员历史接口返回来源 SQLite 中的原始字段，日期为来源字符串。`orders` 按 `order_date`、`notes` 按 `created_at`、`contacts` 按 `contact_date`、`appointments` 按 `appointment_date` 倒序，各最多 10 条。护理档案不存在时 `careProfile` 为 `null`。接口读取 SQL Server 中保存的快照；会员不存在返回 404，编号格式无效返回 400。

## AI 文案与产品图

状态快照增加 `ai` 和 `copyDrafts`。`ai` 包含 `configured`、可选模型列表 `models`（`id`、`label`）、`defaultModel`、文案风格列表 `styles`（`id`、`label`）和 `defaultStyle`。密钥不随接口返回。`copyDrafts` 是最近 50 条，字段为数字 `id`、`memberId`、`model`、`message`、`originalMessage`、`reason`、`productIds`、`createdAt`、`copiedAt`。未复制时 `copiedAt` 为 null。产品增加 `imageUrl`，未上传时为 null。

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| POST `/api/copy/generate` | `{"memberIds":["M0001"],"model":"Qwen/Qwen3.6-Flash","style":"friendly"}` | `{ "items":[{"id":1,"memberId":"M0001"}], "errors":[], "state":{...} }` |
| POST `/api/copy/:id/save` | `{"message":"店主核对后的邀约"}` | `{"state":{...}}` |
| POST `/api/copy/:id/copied` | `{"message":"实际复制的文案"}`，客户端成功写入剪贴板后调用 | `{"state":{...}}` |
| POST `/api/products/:id/image` | 图片二进制，Content-Type 为 image/png、image/jpeg 或 image/webp | `{"state":{...}}` |
| GET `/api/product-images/:id` | 无 | 图片二进制；`?download=1` 使用附件下载 |

每批 1 至 5 个不同会员，保存文案为 1 至 1000 字符。模型只能选择目录内可用产品，最多 2 个。无效模型或名单格式返回 400；会员联系资格失效、重复生成中的批次或不可用产品返回 409。模型服务失败按会员写入 `errors`（含 `memberId` 和可读 `error`），成功项独立保存。批次级错误不会写入文案。图片最多 5 MB，超限返回 413；格式不符返回 400。

`style` 可省略，默认 `friendly`（自然亲切），兼容旧请求。其他值为 `concise`（简洁直接）、`caring`（温柔关怀）、`professional`（专业推荐）；非法值返回 400，且不调用模型、不写入文案。风格映射为服务端固定的语气和篇幅要求，实际传入模型系统提示；不改变会员事实和产品资格规则。风格仍是本次生成参数，记录在可空的 `context_json` 中；旧字段保持原契约。

模型调用在数据库事务外执行，保存前再次核对会员资格和产品资料。图片以新记录保存，每个产品使用最新绑定图；旧图片 URL 继续有效。更换产品图片不改写生成文案。保存修改会清除该文案的旧复制标记，复制时间独立保存，复制不会改变任务、预约或消费数据。重置演示清除 `CopyDrafts`，保留产品图片；生成进行中重置返回 409。

## 关系经营版新增契约（v4.0）

旧请求仍可省略 `context`。新版生成请求指定沟通目的与产品：

```json
{
  "memberIds": ["M0001"],
  "model": "Qwen/Qwen3.6-Flash",
  "style": "friendly",
  "context": { "objective": "balance", "productId": "P001" }
}
```

`context.objective` 支持 `wake`、`repurchase`、`balance`、`launch`、`care`、`preview`、`scheduled`、`greeting`。普通目的要求选中有效产品；`preview` 仅允许实际匹配的未发布款；`scheduled`、`greeting` 的 `productId` 为 `null`，生成结果允许 `productIds: []`。服务端按本次目的缩小模型可选目录，生成后与保存前再次校验。模型服务仍使用 60 秒超时、900 个输出 token 上限；密钥始终留在服务端。

状态中的任务和文案增加可空 `context`，旧记录为 `null`。定时回访的 `followUp` 由服务端确定；任务可另外包含 `copyDraftId`（来源文案编号）、`executedOn`（模拟触达基准日）。会员增加 `recentNailVisit`（最近 7 天美甲订单事实或 `null`）、`followupRecord`（最新本地反馈或 `null`）、`executedFollowups`（已执行回访计划日期数组）。同一会员的关怀历史不再被新反馈覆盖。

产品快照可包含 `planned: true` 的演示新品灵感 `IDEA-SEA-SALT`，计划发布日期为 `2026-11-14`，`price: null`。它仅由规则追加到演示快照，不写入现有产品表，不作为现售商品推荐；数据库中的 24 条原产品保留。

| 方法和路径 | 请求示例 | 成功响应 |
| --- | --- | --- |
| POST `/api/members/:id/notes` | `{"noteId":null,"type":"preference","text":"喜欢清透款","pinned":true,"author":"店主"}` | `{"state":{...},"details":{...}}` |
| POST `/api/copy/manual` | `{"memberId":"M0001","message":"店主手写内容","context":{"objective":"greeting","productId":null}}` | `{"draftId":13,"state":{...}}` |
| POST `/api/tasks/from-copy` | `{"draftId":13,"message":"店主最终确认的内容"}` | `{"created":1,"taskId":"T0002","state":{...}}` |

备注 `type` 为 `preference`、`communication`、`service`、`care`、`appointment`；`text` 为 1–1200 字符，`author` 为 1–80 字符，`pinned` 为布尔值。`noteId: null` 新增；传本会员已有备注编号则编辑/置顶。编辑以本地覆盖层保存，保留原始来源记录，跨会员编号返回 404。会员详情合并覆盖层，优先展示置顶备注。

手写文案为 1–1000 字符，复用实际产品与联系资格校验，不调用模型。提交审核从数据库读取文案；可选 `message` 用于检查当前页面与已保存文本是否一致，不一致返回 409。先保存编辑再提交，保证审核内容是店主修改后的版本。重复提交或资格失效不会重复创建任务。

页面「演示工具 → 重置界面」只恢复导航、筛选、选择、未保存输入和界面临时状态；已保存文案、备注、任务、关怀、上传图均保留。另一个「清空演示数据」操作确认后才调用原 `POST /api/reset`。
