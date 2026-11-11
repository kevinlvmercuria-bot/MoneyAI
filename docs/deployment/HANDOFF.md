# MoneyAI 部署交接

最后核验时间为 2026-11-11（北京时间）。当前执行第二阶段。项目也称 NailMate AI，为美甲店提供老板娘和员工账号、顾客联系分派、反馈、备注、预约、今日待办及护理回访。目标是保留可独立运行的本地版，将新版账号工作台迁到 Neon PostgreSQL，通过 GitHub 和 Render Web Service 小范围试用。旧版 AI 审核工作台留在本地。真实收银接入等商家确认系统和订单导出能力后再安排。

## 长期执行规则

1. 项目状态以实际文件、Git、数据库和执行结果为准。未经验证的项目标记为待验证。
2. 每个阶段开始前，核实上一阶段是否实际通过验收。
3. 修改数据库、Git 历史或关键业务逻辑前，优先确认备份和回退路径。
4. 新会话或上下文压缩后，先重读 [AGENTS.md](../../AGENTS.md) 和本文件，再核实现场并继续。
5. 每轮只执行指定阶段，完成对应的测试、权限、安全和备份恢复要求。每轮结束后更新本文件，并区分实际结果和计划。

## 四阶段路线

| 阶段 | 状态 | 范围和验收 |
| --- | --- | --- |
| 1. 备份与建立分支 | 已通过本阶段验收 | 确认运行版本和远端关系，保护现有修改，完成源码备份和 SQL Server 备份校验，创建本地部署分支，验证本地访问。独立数据库恢复演练安排在正式试用前。 |
| 2. 业务日期与回访待办 | 进行中，检查点 A、B、C 已通过 | 操作日期使用服务端北京时间。最近一次可信的已完成美甲服务第 21 天到期，第 20 天无待办，第 22 天未处理仍保留。按订单去重，老板娘分派后进入员工待办。已处理、约好对应维护或有更新服务记录时关闭旧提醒。验证跨午夜、停机补算和并发。 |
| 3. Neon 迁移与数据安全 | 尚未开始 | 在独立试用库迁移新版账号、任务、反馈、备注、产品图片和回访状态。验证权限、离职交接、并发、持久化及隔离备份恢复。 |
| 4. GitHub 与 Render 部署 | 尚未开始 | 推送部署分支后构建 Render Web Service。配置端口、HTTPS、正式登录和限流、健康检查、环境变量及定时备份。开放前初始化老板娘账号，用店内手机验证一位老板娘和一位员工的流程。实例休眠后通过访问补算回访。 |

## 第一阶段留存的实际运行版本

- 主工作目录为 `C:\Users\Kevin\Desktop\赚钱`，Git 根目录就是该目录。Node.js 实际版本为 `24.18.0`，项目声明 `>=22.13.0`。主入口是 Express 5 和原生 HTML、CSS、JavaScript，运行数据存放于 SQL Server。SQLite 文件 `data/nailmate.db` 用于旧版导入及部分测试。
- `http://127.0.0.1:3000` 由 PID `61688` 的 `node.exe server/main.js` 提供。首页和新版脚本的 HTTP 响应逐字节匹配桌面仓库文件，和 Documents 副本的对应文件不匹配。SQL Server 会话同时确认该 PID 连到 `NailMate`。
- 数据库使用本机 `localhost\SQLEXPRESS` 的 Windows 集成认证。引擎为 SQL Server Express `17.0.1000.7`，数据库兼容级别 `170`。只读检查确认有两条账号记录和一条新版状态记录，另有旧版会员、文案及来源表。敏感配置保存在本机。
- 另一个有效仓库位于 `C:\Users\Kevin\Documents\GitHub\MoneyAI`，版本为 `3.2.0`，同样使用 Express 和 SQL Server。`C:\Users\Kevin\Desktop\NailMate-backups` 是历史备份目录，包含两个旧备份批次。

| 文件 | 已核实职责或状态 |
| --- | --- |
| `public/index.html`、`public/workspace.js`、`public/team-workspace.js` | 新版页面及任务、会员与话术工作台 |
| `public/team-store.js` | 共用业务逻辑。护理回访目前只在第 21 天进入推荐。分派、反馈及部分联系冷却仍取演示快照基准日 `2026-11-07`。预约和待办使用当前北京时间。 |
| `server/main.js`、`server/db.js` | 本地服务启动、SQL Server 连接与事务锁。当前服务监听 `127.0.0.1`。 |
| `server/team-routes.js`、`server/team-auth.js`、`database/team-auth.sql` | 新版接口、账号权限和两张新版 SQL Server 表。登录目前限制本机主机名。 |
| `data/team-data.json`、`scripts/build-share.js` | 模拟会员快照与微信分享版构建。实际美甲完成日期仍依赖可靠的服务记录。 |
| `public/legacy.html`、`public/workspace-legacy.js` | 本地旧版 AI 审核入口 |

## Git 基线与本阶段操作

GitHub API 实查的远端为 `https://github.com/kevinlvmercuria-bot/MoneyAI.git`，默认分支 `main`。直接 Git HTTPS 查询遇到连接失败，分支及 SHA 由 GitHub REST API 复核，并与本地对象比较。

| 分支或副本 | 提交与关系 |
| --- | --- |
| 桌面 `main` 和 GitHub `main` | `31306467ea8cfb9594776569ffc997cc7426e47b`。提交相同，共同祖先就是该提交。桌面目录起初有 15 个已跟踪文件修改和 20 个未跟踪文件。 |
| Documents 副本 `main` | `556f0d04e410f50542f9a65b3c2fdc31dbb88aad`。它是远端 `main` 的共同祖先，落后两次提交。它另有 `public/pages/members.js` 和 `server/store.js` 两处未提交的性格标签修改，已在独立备份中保留，原目录未改动。 |
| GitHub `codex/nailmate-upload` | `09ca7b6dfa78278c4a4b401f1a0ec31d5fad7695`，在 `main` 上多一次提交，新增独立的账号版原型与分享文件。 |
| GitHub `fix/sql-server-acceptance` | `12a389740e144064e18b1732595cb30220170c44`，与 `main` 的共同祖先为 `c8e9bfa434db5228be7a685285b6f20010c7dc25`，双方各有独立提交。 |
| 本地 `deploy/neon-render` | 从桌面 `main` 建立。源码基线提交为 `d1a302a53c724a7cebd051058ac6a2ef200eb9c7`，包含已核对的本地新版工作台、员工和反馈优化、图表、回访逻辑及旧版兼容代码。本交接文档有单独提交，当前分支顶端可用 `git rev-parse deploy/neon-render` 查询。 |

- 部署分支保持在桌面工作目录。本轮仅建立本地分支和本地提交，`main` 与远端仍在原提交。其他副本及远端专题分支的改动各自保留。
- `.gitignore` 已增加数据库、备份、私钥、临时文件、模拟快照和生成预览的排除规则。旧 SQLite 已从部署分支最新文件树取消跟踪，磁盘文件仍在原位，祖先提交仍有该历史文件。SQLite、模拟快照、两份预览和敏感配置均保留在本地。静态产品图资源作为界面资源纳入源码。
- 全新检出当前分支时，从受控备份另行提供 `data/team-data.json`。运行旧版来源导入或相关测试时，还需恢复本地 `data/nailmate.db`。推送前复核计划推送的提交内容和历史中已有的演示库。

## 备份和恢复

备份于 2026-11-11 18:09–18:11（北京时间）生成，位于两个 Git 工作区之外。根目录为 `C:\Users\Kevin\MoneyAI-backups\stage1-20261111-180956-8e11f7`。

| 内容 | 位置与检查 |
| --- | --- |
| 桌面完整源码和本地资源 | `desktop/source`，124 个文件，共 33,994,940 字节。包含已修改及未跟踪的重要文件、模拟快照、SQLite 和两份预览。逐文件对照来源做 SHA-256 校验，见 `desktop/source-manifest.json`。 |
| Documents 副本 | `documents/source`，69 个文件，逐文件 SHA-256 校验通过。包含两处未提交修改，见 `documents/source-manifest.json`。 |
| 两个仓库的历史 | `desktop/history.bundle` 和 `documents/history.bundle`，均经 `git bundle verify` 并确认包含各自原始 `main`。 |
| 本地敏感配置 | `private-config/.env.dpapi` 使用 Windows 当前用户保护加密，已验证解密内容与原件一致。跨机器或账号回退时，通过受控渠道重新配置所需值。 |
| SQL Server `NailMate` | `sql/NailMate-stage1-copy-only.bak`，31,449,088 字节。执行了 `BACKUP DATABASE ... WITH COPY_ONLY, CHECKSUM`、`RESTORE VERIFYONLY ... WITH CHECKSUM` 和 `RESTORE HEADERONLY`。确认是同名数据库的完整副本，有备份校验和。SHA-256 为 `f77f794231a3f0c7a2f81f5a739d033ee7534a54494d735ec610cebd02a481db`，见 `sql/backup-verification.json`。 |

备份目录访问权限限于当前 Windows 用户、SYSTEM 和管理员。SQL Server 服务账号另有 `sql` 子目录的写入权限。依赖目录可按锁文件重装。代码回退时，在新目录使用对应 Git bundle 和 `source` 快照恢复，先核对清单和本地配置。数据库完整恢复待验证，正式试用前把备份恢复到独立数据库和文件位置，检查账号、任务、反馈、备注及数据完整性。避免使用现有 `NailMate` 名称或数据文件作为恢复目标。

[SQL Server COPY_ONLY 备份](https://learn.microsoft.com/en-us/sql/relational-databases/backup-restore/copy-only-backups-sql-server) · [SQL Server VERIFYONLY](https://learn.microsoft.com/en-us/sql/t-sql/statements/restore-statements-verifyonly-transact-sql)

## 第一阶段验证

- `npm run check` 通过。隔离环境的 `npm run test:team` 7 项、`npm test` 32 项和 `npm run test:legacy` 2 项全部通过。测试只使用随机命名的独立测试库及临时副本。
- 备份后复核两份源码共 193 个文件的散列。部署分支所提交的源码来自核对过的原工作区文件。现有业务源码、模拟快照和 SQLite 的工作区字节保留，保护性忽略规则和文档单独更新。
- 分支建立后，本地首页、新版脚本、登录会话接口返回 HTTP 200。未登录读取新版工作台数据返回 HTTP 401，原服务进程继续连接 `NailMate`。实际账号密码登录留给门店现场验证，登录权限和业务流程已在隔离测试中覆盖。
- 待验证事项为独立数据库恢复演练，以及正式试用账号和手机的验收。收银接口、Neon 试用库和 Render 部署尚未开始。

## 第二阶段检查点

### A. 业务日期统一，已通过

- 开工基线为本地 `deploy/neon-render` 的 `583710e`，工作区干净。重新核对了第一阶段备份 SHA-256、当前本地端口、SQL Server `SQLEXPRESS/NailMate`、Windows 集成认证及 Git 基线。
- `public/team-store.js`、`public/team-workspace.js`、`server/main.js` 和 `server/team-routes.js` 统一账号版时钟。分派、反馈、14 天冷却、预约、今日待办和回访共用服务端北京时间日期。精确的创建、更新和分派时间保存 UTC。旧反馈从已有 UTC 审计记录推导实际冷却日期，原始历史仍可查看。
- `snapshot.as_of_date` 仍用于模拟会员经营画像和旧版 AI 的模拟审核流程。固定日期也用于自动化测试夹具。认证会话过期和审计时间戳用实际毫秒或 UTC，分别用于计时和审计。检查点 A 无数据库结构变更。
- `npm run check` 通过。以 `TZ=America/Los_Angeles` 运行 `npm run test:team`，9 项全部通过，覆盖 23:59:59、00:00:00、冷却第 13/14 天、伪造请求日期、旧演示日期与重启。Playwright 在隔离数据库账号版中阻断非本机浏览器请求，实测已打开的员工页日期从 11 月 11 日自动更新为 11 月 12 日。进程时区为美国洛杉矶，系统时钟未调整。
- A 的本地检查点为 `5e6f695`。

### B. 第 21 天回访待办，已通过

- `database/team-care-reminders.sql` 新增 `dbo.TeamCareReminders`，以会员和服务订单为复合主键，关联任务 ID 唯一。`server/team-reminders.js` 和 `server/team-routes.js` 在现有 SQL Server 事务锁内补算及持久化，任务与提醒在同一事务内更新。全新启动会先检查表是否存在。
- `public/team-store.js` 只采纳最新的有效已完成美甲订单。真实来源必须明确标记为已完成，并带可信完成日期。历史模拟订单沿用模拟快照日期和标记。旧版未关联订单的反馈继续保留原有历史，无法可靠追溯订单时保留其原始关联信息。
- 老板娘的 `护理回访待分派` 显示到期日和联系限制。有效提醒按订单保留，分派后关联任务，已联系记为已处理，同任务登记对应预约时记为已预约。暂不联系保留负责人和已有跟进安排。订单失效或出现更新服务时，旧提醒失效，关联的待联系任务归档，历史仍可查看。无关预约只参与原有联系资格判断。
- `TZ=America/Los_Angeles` 下的 `npm run test:team` 11 项通过。隔离库验证第 20/21/22 天、重启、并发生成和分派、事务失败重试、取消或未完成订单、日期更正、无关预约、对应预约、新服务归档，以及新表迁移可重复执行和事务回退。
- Playwright 阻断外部浏览器请求后，实测第 22 天老板娘从到期表分派，员工待办随之出现。已重建微信分享版，验证模拟标记及回访到期日可显示。新增表和新后端均在隔离库验收，原 `NailMate` 未应用迁移，原服务未重启。
- B 的本地检查点为 `5ce0675`。

### C. 账号权限回归，已通过

- `public/team-store.js` 修复同名员工重新开通账号时会继承原员工历史访问范围的问题。老板娘继续查看旧任务、反馈与备注，员工端从后端鉴权后的任务归属计算可访问客户。已交接的任务仍保留原反馈人和时间。C 无数据库结构变更。
- `server/team.test.js` 在隔离 SQL Server 中验证老板娘分派、查看反馈和并发拒重。两位员工分别验证只能访问本人任务及备注。越权任务 ID 返回 404，员工调用老板娘接口或改派返回 403，伪造老板娘身份请求返回 401。离职后旧会话和原凭据返回 401，同名新账号只访问显式分派的任务。重启后任务、反馈历史和备注仍可读取。
- `TZ=America/Los_Angeles` 下 `npm run test:team` 11 项通过，`npm run check` 通过，`npm run test:legacy` 2 项通过。C 的检查点提交标题为 `fix: preserve employee access boundaries after handoff`。

## 下一轮从这里继续

核对当前分支和本节已验收检查点，接着执行 D。只使用第一阶段已校验备份，恢复到不同名称和独立文件路径，再做完整性检查及记录核对。
