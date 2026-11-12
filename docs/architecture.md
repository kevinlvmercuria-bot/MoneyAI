# 项目结构与维护入口

维护主线为 `NailMate-GitHub`，当前为 v5，沿用 v4.1 账号工作台的业务基础。目录整理保持现有业务规则、接口契约、数据库状态格式和分享版存储键，新旧版存储均已改为 PostgreSQL；未引入多门店模型。

## 先从哪里阅读

```text
public/index.html
  → 按顺序载入共享规则、业务引擎、图表和页面工厂
  → public/workspace.js
  → public/team-workspace.js 初始化状态、创建页面、绑定导航与刷新

server/main.js 连接数据库、检查启用模块、启动和关闭服务
  → server/app.js 装配认证、新版接口和可选旧版接口
  → server/team-routes.js 校验身份并在事务内协调业务
  → public/team-store.js 执行业务操作
  → server/team-repository.js 保存状态与回访记录
```

## 按功能定位

| 要修改的功能 | 首先阅读 |
| --- | --- |
| 推荐机会、护理回访卡片、分派清单 | `public/app/pages/dashboard.js` |
| 顾客档案、建档、备注、服务登记 | `public/app/pages/members.js` |
| 员工待办、沟通反馈、预约 | `public/app/pages/tasks.js`、`public/app/task-actions.js` |
| 联系进度、员工汇总 | `public/app/pages/reports.js`、`public/team-chart.js` |
| 产品与图片 | `public/app/pages/products.js` |
| 参考话术、草稿、企微联系入口 | `public/app/pages/studio.js` |
| 员工开通、删除与交接弹窗 | `public/app/pages/accounts.js` |
| 登录、退出、分享身份切换 | `public/app/auth.js`，服务端 `server/team-auth.js` |
| 网络错误、状态请求 | `public/app/api.js` |
| 快照索引、可见会员、状态替换 | `public/app/state.js` |
| 翻牌、下拉选择、玻璃效果、Dock | `public/app/effects.js` |
| 业务日期、联系限制、回访窗口 | `public/shared/team-rules.js` |
| 分派、反馈、撤回、备注等服务端复核 | `public/team-store.js` |
| SQL 查询与状态保存 | `server/team-repository.js`、`server/team-reminders.js` |

页面以工厂函数创建。协调器提供 `app` 上下文，页面通过 `app.state`、`app.DATA` 等访问最新数据；状态在刷新后会被替换，不能在模块初始化时解构并长期缓存这些值。模块内部的草稿和局部变量仍由模块自己维护。业务间协作通过明确的上下文方法完成，不使用运行时源码拼接或动态执行。

`public/shared/team-rules.js` 不访问 DOM 或存储，Node 和浏览器共用同一实现。`public/team-store.js` 负责校验操作和状态转移；服务端仍是权限与并发校验的最终执行方。分享版由 `team-persistence.js` 适配浏览器存储。旧的 `options.storage` 调用仍兼容，写入失败仍会阻止提交成功。

## 两种运行模式

| 模式 | 结构准备 | 启动 | 旧 AI 工作台 |
| --- | --- | --- | --- |
| 新旧兼容本地版 | 全新库 `npm run db:init`；升级用 `npm run db:migrate` | `npm start` | 保留，老板娘鉴权 |
| 独立账号版 | `npm run db:init:team` | `npm run start:team` | 页面及 API 返回 404 |

两种模式共用账号版数据，关闭旧入口不删除旧数据库记录。新版使用账号、状态、回访及企微/客服表，不要求旧版 `Members` 或 SQLite。两种模式仍需 `.env` 配置；账号版基础资料仍来自 `data/team-data.json`，当前演示快照仍按 README 的 `data:prepare` 流程获取。现有 `data:prepare` 同时准备旧 SQLite，独立数据包留待后续处理。

`database/migrations.js` 提供可重复的结构迁移。`database/setup.js` 保留兼容版演示初始化与来源导入。PostgreSQL 使用 jsonb、bytea、date 与 timestamptz。原状态结构保留，新增 outboundContacts 保存真实发送事实；企微与客服使用独立表，没有将原状态整体拆表。

## 分享版与旧版边界

`scripts/build-share.js` 从 `public/index.html` 读取脚本顺序，将同一批共享规则和页面模块内嵌到单文件。不要单独修改生成的 HTML。修改共享规则或新版页面后，重新生成分享版并验证老板娘分派、员工反馈与刷新恢复。

旧版前端继续从 `public/legacy.html`、`workspace-legacy.js`、根级 `pages/`、`state.js`、`api.js` 等加载。它们与新版 `public/app/` 名称相似，但属于不同入口。旧版后端统一在 `server/legacy/`；来源导入和演示初始化仍可能引用其存储模块。

## 已退役内容与回退

早期原型的服务端 `app.js`、`members.js`、`config.js`，浏览器 `app.js`、原型 `app.test.js`，以及 `database/init.js`、`001-schema.sql` 已退出维护。`server/app.js` 这个路径被重新用于正式应用装配。原型历史可从修改前的 Git 基线 `9087736` 检索，勿将旧原型文件直接覆盖现有同名模块。

保留 `server/index.js` 的启动转发。保留仍用于初始化的 `database/demo-data.js`、`import-source.js`，以及模拟数据加工脚本；它们并非无引用的废代码。旧版 AI 的有效测试场景由 `npm test` 继续覆盖，`test:legacy` 现检查新旧入口边界与独立账号库。

任务执行时，外层历史 `NailMate` 目录已不在现场，本轮没有删除或移动该目录。不要将此状态视为已完成历史副本差异核验。


## PostgreSQL 与沟通渠道

`server/db.js` 管理 pg 连接及事务级 advisory lock；旧 SQL Server 连接仅留在 `database/sqlserver-source.js`，供一次性搬迁工具使用。`database/transfer-sqlserver.js` 负责来源清单、备份、搬迁和内容核对。

企微发送由 `server/wecom-client.js`、`server/wecom-service.js` 和 `server/wecom-routes.js` 分别处理平台调用、任务状态和 HTTP 权限；页面是 `public/app/wecom.js`。微信客服由 `server/kf-service.js`、`server/kf-routes.js`、`server/wecom-callback.js` 与 `public/app/kf.js` 管理。后台查询随服务启动，真实网络调用在业务事务外执行。

配置与切换流程见 [接入指南](postgresql-wecom.md)。真实平台凭据和部署目标尚需由门店配置，模拟测试不能替代真实联调。


管理员接入配置由 `server/wecom-settings.js` 加密持久化并应用到客户端代理，界面在 `public/app/wecom-admin.js`。会员 Excel/CSV 导入由 `server/member-import.js` 及 `public/app/member-import.js` 处理，复用现有建档规则与事务，不另建一套会员业务表。导入依赖 ExcelJS 与 csv-parse；ExcelJS 的 uuid 依赖固定覆盖为兼容 CommonJS 的 11.1.1，使用现有 v4 API 并通过读写测试，避免旧版依赖的已知漏洞。
