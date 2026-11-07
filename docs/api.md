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
- 任务状态从 `pending_review` 进入 `approved` 或 `rejected`。只有 `approved` 可以进入 `executed_simulated`。通过时必须传入去除首尾空白后为 1 至 1000 字符的话术。审核通过、模拟执行时复查联系资格。一个会员同时只能有一条未拒绝任务。
- `scenario` 支持 `noReply`（未回复）、`reply`（已回复，未预约）、`booking`（已预约，待到店）、`visit`（已到店并消费）。只有 `visit` 产生固定演示消费 168 元。
- `logs` 返回最新 40 条，包含 `name`（动作名）、`desc`（描述）和 `time`（北京时间 `HH:mm:ss`）。
- 重置会删除共享演示任务和日志，保留会员，重建一条通用待审核任务。任务 ID 继续递增。

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
- `followUp` 可省略或传 `null`。有日期时必须是真实日期且晚于基准日。「已沟通」「未回复」至少间隔 14 天，即最早 `2026-11-21`。「推荐不合适」「不再营销」不能附带跟进计划。计划仅供查看。
- 保存前检查会员联系资格，同一会员在本轮演示中只保存一次。重复或并发提交返回 409，记录和日志一起提交。
- 会员快照增加 `careHandled`（是否已处理）、`carePaused`（是否暂不联系）。已处理会员退出推荐；「已沟通」「未回复」将有效 `contactDays` 设为 0；「不再营销」将有效 `consent` 设为 false。审核和执行会重新检查这些限制。
- 这些限制由关怀记录派生，基础会员档案继续保留。重置演示时清空关怀记录、计划、任务和日志，恢复基础会员资格，重建初始任务。

## 来源数据与产品

状态快照增加 `products` 和 `dataSource`。产品包含 `id`、`name`、`style`、`price`，导入后另有 `type`、`isNew`、`isActive`、`launchDate`、`description`、`imageStatus`、`imageAlt`。产品推荐排除未上架、未发布和非美甲款式；新品邀约另检查 `isNew`。任务话术和依据在创建时保存，后续目录更新不改写既有任务。

导入后的 `dataSource` 包含 `kind: "sqlite_import"`、`sourceHash`、`importedAt` 和各来源表的行数 `counts`。尚未导入时为 `{ "kind": "generated_demo" }`。会员增加 `displayName`、`latestNote`、`preferredTechnician`、`cycleConfidence`、`source` 等来源信息。

增强版界面使用会员快照中的 `careProfile` 摘要，包含 `memberId`、`tags`、`lastService`、`preferredService`、`followupDate` 和 `status`；没有来源护理档案时为 `null`。护理页据此排除 `not_due` 和无明确需求的来源记录，已有店主关怀记录仍可查看。会员历史接口中的 `careProfile` 继续返回原始档案字段。

会员历史接口返回来源 SQLite 中的原始字段，日期为来源字符串。`orders` 按 `order_date`、`notes` 按 `created_at`、`contacts` 按 `contact_date`、`appointments` 按 `appointment_date` 倒序，各最多 10 条。护理档案不存在时 `careProfile` 为 `null`。接口读取 SQL Server 中保存的快照；会员不存在返回 404，编号格式无效返回 400。

## AI 文案与产品图

状态快照增加 `ai` 和 `copyDrafts`。`ai` 包含 `configured`、可选模型列表 `models`（`id`、`label`）和 `defaultModel`。密钥不随接口返回。`copyDrafts` 是最近 50 条，字段为数字 `id`、`memberId`、`model`、`message`、`originalMessage`、`reason`、`productIds`、`createdAt`、`copiedAt`。未复制时 `copiedAt` 为 null。产品增加 `imageUrl`，未上传时为 null。

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| POST `/api/copy/generate` | `{"memberIds":["M0001"],"model":"Qwen/Qwen3.6-Flash"}` | `{ "items":[{"id":1,"memberId":"M0001"}], "errors":[], "state":{...} }` |
| POST `/api/copy/:id/save` | `{"message":"店主核对后的邀约"}` | `{"state":{...}}` |
| POST `/api/copy/:id/copied` | `{"message":"实际复制的文案"}`，客户端成功写入剪贴板后调用 | `{"state":{...}}` |
| POST `/api/products/:id/image` | 图片二进制，Content-Type 为 image/png、image/jpeg 或 image/webp | `{"state":{...}}` |
| GET `/api/product-images/:id` | 无 | 图片二进制；`?download=1` 使用附件下载 |

每批 1 至 5 个不同会员，保存文案为 1 至 1000 字符。模型只能选择目录内可用产品，最多 2 个。无效模型或名单格式返回 400；会员联系资格失效、重复生成中的批次或不可用产品返回 409。模型服务失败按会员写入 `errors`（含 `memberId` 和可读 `error`），成功项独立保存。批次级错误不会写入文案。图片最多 5 MB，超限返回 413；格式不符返回 400。

模型调用在数据库事务外执行，保存前再次核对会员资格和产品资料。图片以新记录保存，每个产品使用最新绑定图；旧图片 URL 继续有效。更换产品图片不改写生成文案。保存修改会清除该文案的旧复制标记，复制时间独立保存，复制不会改变任务、预约或消费数据。重置演示清除 `CopyDrafts`，保留产品图片；生成进行中重置返回 409。
