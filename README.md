# NailMate AI

美甲店会员复购演示。店主在驾驶舱按经营目标选人，经人工审核后模拟触达，再按目标复盘。演示数据含 2,800 位虚拟会员，不发送营销消息。

## 框架
public/       前端页面与资源
server/       后端接口与业务逻辑
database/     数据库建表与初始化
docs/         项目说明与协作文档


## 启动

需要 Node.js 22 或更新版本，以及 SQL Server 2016 或更新版本（数据库兼容级别至少 130）。推荐 Node.js 24 LTS。

1. 在 SQL Server 中创建专用空库 `NailMate`。初始化账号需要该库的建表和写入权限。运行账号需要对本项目三个表的读写权限。
2. 在本目录执行 `npm ci`，复制 `.env.example` 为 `.env` 并填写连接参数。
3. 执行 `npm run db:init`，再执行 `npm start`。
4. 打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。也可用 `GET /api/state` 检查数据库是否已经接通。

```powershell
npm ci
Copy-Item .env.example .env
# 填好 .env，并先在 SQL Server 中创建 NailMate 空库
npm run db:init
npm start
```

- **SQL 登录**：使用 `DB_AUTH=sql`，填写数据库账号和密码。已知 TCP 端口时填写 `DB_PORT` 并清空 `DB_INSTANCE`。用命名实例连接时填写 `DB_INSTANCE`，由 SQL Server Browser 解析实例端口。
- **Windows 集成登录**：在 Windows 上填写 `DB_AUTH=windows`，命名实例例如 `DB_HOST=localhost` 和 `DB_INSTANCE=SQLEXPRESS01`。需要安装 SQL Server ODBC 驱动和可选依赖 `msnodesqlv8`。若驱动加载失败，检查 `npm ls msnodesqlv8` 和 ODBC 安装情况。
- 使用本地开发实例的自签名证书时，可针对该连接设置 `DB_TRUST_SERVER_CERTIFICATE=true`。`.env` 只保存在本地。
- `db:init` 可重复运行，已有会员数据时跳过填充。「重置演示」会清空当前库的任务和操作日志，重建一条初始任务，会员资料继续保留。服务默认只监听本机回环地址，接口没有用户登录机制。

## 目录与分工

| 位置 | 接手内容 |
| --- | --- |
| `public/index.html`、`public/workspace.js` | 前端维护页面、交互和 API 调用 |
| `public/rules.js` | 前后端共用选人、匹配和话术规则，后端在写入前重新验证 |
| `server/main.js`、`server/store.js`、`server/db.js` | 后端维护路由、事务、状态流转及 SQL 连接 |
| `database/schema.sql`、`database/setup.js`、`database/demo-data.js` | 数据库同学维护表、固定演示数据和初始化 |
| [docs/api.md](docs/api.md) | 联调契约 |

## 联调顺序

1. 初始化 SQL Server，检查 `GET /api/state` 返回 2,800 位会员和一条初始待审核任务。
2. 打开驾驶舱选择「余额提醒」，勾选一位候选并入队。用审核中心修改话术并批准。
3. 选择「已预约，待到店」并确认，查看余额提醒复盘是否增加一条预约。
4. 刷新页面验证任务和记录仍在，再验证拒绝任务无法执行、重复提交不会重复生成或累计。


## 最小版本验收

在项目目录运行 `npm run check` 和 `npm test`。测试使用当前 `.env` 的 SQL Server 连接身份，临时创建随机命名的 `NailMate_Acceptance_...` 测试库，并在结束后清理。该身份需要创建和删除数据库的权限。

`npm test` 验证正式 SQL Server 入口，包括重复初始化、三类经营目标、未授权拦截、整批失败回滚、并发入队、审核状态、四种模拟结果、持久化和重置。旧内存版本的测试入口为 `npm run test:legacy`。

浏览器验收按下面顺序完成。现有数据库有演示记录时，先通过页面的「重置演示」确认清空任务和日志。

| 操作 | 通过标准 |
| --- | --- |
| 选择「余额提醒」，勾选一人入队 | 审核中心出现一条余额提醒任务 |
| 将话术修改为「验收预约」，批准 | 任务进入已批准分类 |
| 模拟执行选择「已预约，待到店」 | 余额提醒复盘显示触达 1、回复 1、预约 1、到店 0、消费 ¥0 |
| 刷新页面，重新打开复盘与任务详情 | 数字不变，话术仍为「验收预约」 |
| 新建一条任务后拒绝 | 拒绝任务无法执行 |
| 再次重置演示 | 只剩一条通用待审核任务，日志为空 |

当前交付采用固定虚拟会员、规则话术和人工选择的模拟结果。所有使用者共享一个本地演示数据库，服务仅监听本机。账号登录、真实消息发送、模型生成、外网部署属于后续迭代内容。
