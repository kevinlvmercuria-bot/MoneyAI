# NailMate API

基址 `/api`。所有 POST 请求使用 `Content-Type: application/json`。接口用于同一个本地演示工作区。写入成功后返回数据库快照，页面据此更新，复盘由已执行任务聚合。

## 接口一览

| 方法和路径 | 请求示例 | 成功响应 |
| --- | --- | --- |
| GET `/api/state` | 无 | `{ "members": [...], "tasks": [...], "logs": [...] }` |
| POST `/api/tasks` | `{"goal":"balance","memberIds":["M0002"]}` | `{"created":1,"state":{...}}` |
| POST `/api/tasks/:id/review` | `{"decision":"approve","message":"你好，需要帮你预约吗？"}` 或 `{"decision":"reject"}` | `{"state":{...}}` |
| POST `/api/tasks/:id/execute` | `{"scenario":"booking"}` | `{"state":{...}}` |
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
