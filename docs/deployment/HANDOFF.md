# MoneyAI 部署交接

最后核验时间为 2026-11-12（北京时间）。第二阶段的代码、隔离验收和恢复演练已完成。项目也称 NailMate AI，为美甲店提供老板娘和员工账号、顾客联系分派、反馈、备注、预约、今日待办及护理回访。目标是保留可独立运行的本地版，将新版账号工作台迁到 Neon PostgreSQL，通过 GitHub 和 Render Web Service 小范围试用。旧版 AI 审核工作台留在本地。真实收银接入等商家确认系统和订单导出能力后再安排。

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
| 2. 业务日期与回访待办 | A、B、C、D 已通过，本地账号版已切换 | 已在隔离环境验证服务端北京时间、第 21 天待办、停机补算和并发。账号权限回归及 SQL Server 独立恢复通过。现用库完成增量建表，新版本地服务已启动。 |
| 3. Neon 迁移与数据安全 | 暂缓，尚未开始 | 在独立试用库迁移新版账号、任务、反馈、备注、产品图片和回访状态。验证权限、离职交接、并发、持久化及隔离备份恢复。 |
| 4. GitHub 与 Render 部署 | GitHub 已保存源码基线，Render 暂缓 | 从部署分支构建 Render Web Service。配置端口、HTTPS、正式登录和限流、健康检查、环境变量及定时备份。开放前初始化老板娘账号，用店内手机验证一位老板娘和一位员工的流程。实例休眠后通过访问补算回访。 |

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

备份目录访问权限限于当前 Windows 用户、SYSTEM 和管理员。SQL Server 服务账号另有 `sql` 子目录的写入权限。依赖目录可按锁文件重装。代码回退时，在新目录使用对应 Git bundle 和 `source` 快照恢复，先核对清单和本地配置。数据库恢复的实际命令、隔离路径和核对结果见检查点 D。

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
- `TZ=America/Los_Angeles` 下 `npm run test:team` 11 项通过，`npm run check` 通过，`npm run test:legacy` 2 项通过。C 的本地检查点为 `a654663`。

### D. SQL Server 独立恢复，已通过

- 第一阶段 `NailMate-stage1-copy-only.bak` 的 SHA-256 与清单一致。通过 `RESTORE HEADERONLY` 和 `RESTORE FILELISTONLY` 确认是一份带校验和的完整备份，有一份数据文件和一份日志文件。当前账号有恢复权限，目标磁盘有约 148 GB 可用空间，备份内两份文件共约 285 MB。
- 恢复到 `localhost\SQLEXPRESS` 上新建的 `NailMate_RestoreStage2_75e74a4e5130`。执行 `RESTORE VERIFYONLY ... WITH CHECKSUM, MOVE ...`，随后执行 `RESTORE DATABASE ... WITH CHECKSUM, STOP_ON_ERROR, RECOVERY, RESTRICTED_USER, MOVE ...`，两份文件均重定向至备份树下独立目录。运行 `DBCC CHECKDB ([NailMate_RestoreStage2_75e74a4e5130]) WITH NO_INFOMSGS, ALL_ERRORMSGS, TABLERESULTS`，报告 0 个错误。完整命令、逻辑文件名、源路径和目标路径均保存在本地受控证据文件。
- 恢复库为 `ONLINE / RESTRICTED_USER`。原 `NailMate` 仍在线，数据库 ID 保持 5，回访新表尚未应用。原网站进程 PID 61688 继续监听 `127.0.0.1:3000`，会话和静态脚本接口返回 HTTP 200。
- 恢复后读取到 2,800 位会员、2 条账号记录、1 条旧版任务、1,537 条来源会员备注。新版状态可被当前工作台读取，共 5 项任务，其中 4 项待联系、1 项已登记。该任务有 2 条反馈历史，另有 1 条反馈记录和 1 条新版备注。第一阶段备份早于回访表迁移。
- 文件和证据位于 `C:\Users\Kevin\MoneyAI-backups\stage1-20261111-180956-8e11f7\sql\NailMate_RestoreStage2_75e74a4e5130\verification.json` 所在目录。恢复库保留为受限的本地副本。

[SQL Server 恢复参数及 MOVE](https://learn.microsoft.com/en-us/sql/t-sql/statements/restore-statements-arguments-transact-sql) · [DBCC CHECKDB](https://learn.microsoft.com/en-us/sql/t-sql/database-console-commands/dbcc-checkdb-transact-sql)

### 第二阶段复验命令和结果

| 测试 | 环境和复验方式 | 实际结果 |
| --- | --- | --- |
| 北京时间零点、UTC 日期差异、14 天边界、演示日期隔离 | `TZ=America/Los_Angeles` 下运行 `npm run test:team` | 通过 |
| 本地访问、已打开的页面跨零点 | Playwright 阻断非本机请求，隔离服务器注入 23:59:59 和 00:00:00，保持同一浏览器页面 | 通过 |
| 第 20/21/22 天、重复访问、并发生成和分派、失败重试 | `npm run test:team` 的 SQL 回访测试，隔离库和模拟订单 | 通过 |
| 日期更正、已处理、对应预约、无关预约、新服务、取消或未完成订单 | 同一隔离 SQL 回访测试及纯业务规则夹具 | 通过 |
| 未分派员工不可见、越权、离职与同名新账号 | `npm run test:team` 的 SQL 账号测试，隔离库和两名员工 | 通过 |
| 重启后任务、反馈和备注 | SQL 账号及回访测试中重建本地 HTTP 服务并重新登录 | 通过 |
| 独立恢复及原库状态 | 按证据文件重放 SQL 验证命令，仅对原库做状态核查 | 通过 |
| 旧版及业务流程 | `npm test` 32 项、`npm run test:legacy` 2 项 | 通过 |

自动化合计 45 项通过，0 项失败。Playwright 的日期切换、账号版回访分派和分享版为另外验证的浏览器场景。真实收银数据、门店正式账号和手机验收仍待后续阶段。

### 补充功能 · 员工备注

- 员工通过负责的任务添加客户备注并修改本人备注。会员档案、任务详情和话术工作台显示备注作者。老板娘可查看和置顶，交接保留原作者及内容。
- 复用 `TeamDemoState` 的备注和编辑记录，功能本身无需新增数据库表。后端校验任务归属、账号作者标识和备注版本。重设密码保留本人编辑权限，同名重新开通账号按新作者处理。
- 隔离 SQL 验收覆盖越权、并发编辑、重启、交接和同名重开。Playwright 验证员工在任务中添加和编辑，老板娘在档案中看到带作者的修改结果。分享版已重新构建。

### 本地账号版切换

- 2026-11-11 北京时间切换本地账号版，运行代码基线为 `3aebee8`。先为现用 `NailMate` 生成新的完整 `COPY_ONLY, CHECKSUM` 备份，并通过 `RESTORE VERIFYONLY`、备份头及 SHA-256 校验。独立恢复演练使用的是检查点 D 所记录的第一阶段备份。
- 切换备份及证据位于 `C:\Users\Kevin\MoneyAI-backups\stage1-20261111-180956-8e11f7\sql\local-cutover-20261111-212213-7ffe14`。该目录含切换前备份、核验结果、服务日志和旧版启动入口。回退前核对第一阶段保留的源码、现用配置及当前数据库状态。
- 使用 SQL Server 事务执行 `database/team-care-reminders.sql`。核对新表主键及任务唯一索引，同时比对原账号数和原任务状态载荷，结果一致。
- 在本机临时端口完成启动预检后，新进程 PID `55908` 接管 `127.0.0.1:3000`。首页和新版脚本与工作区一致，会话接口返回 200，未登录的工作台请求返回 401。SQL Server 会话确认新进程连接现用 `NailMate`。临时端口已关闭，门店账号重启后需重新登录。
- 本地静态资源已补充沟通结果的必填反馈、会员档案备注字号层级，以及话术工作台的自然亲切、可爱、温柔、简洁和优雅五种表达方式。Playwright 在隔离库验证漏选时提示并聚焦字段、选中后保存、两种窗口宽度的备注字号，以及五种生成结果。微信分享版已重建，本机地址已验证提供相同静态资源。
- 复购机会、会员档案和话术工作台改为以最近到店日期与服务端北京时间计算未到店天数、倍数和会员状态。新品预告的后端资格复核共用同一规则。Playwright 在隔离库验证打开的页面跨零点自动从 132 变为 133 天，平均周期为 33 天，偏离从 4 倍变为 4.03 倍。13 项账号版测试通过，分享版已重建。本地服务重启后由 PID `63964` 接管 3000，首页、脚本和登录会话均通过预检及切换后验证。服务日志和上版启动入口在 `C:\Users\Kevin\MoneyAI-backups\stage1-20261111-180956-8e11f7\recency-restart-20261111-225959-1bf8c3`。

- 护理回访待分派名单改用与其他经营机会共用的翻牌卡片。正面显示回访到期日，背面显示服务完成日及行动建议或联系限制。Playwright 在隔离 SQL 库验证了翻牌、分派限制、分页保留已选顾客、窄窗口横向滚动，以及老板娘分派后员工收到待办。13 项账号版测试通过，微信分享版已重建并验证可翻牌，本地 3000 端口已核对提供新版脚本。

### 护理回访窗口调整

- 当前规则以最近一次有效美甲服务完成日为准，按北京时间第 7–28 天建议护理，第 29–45 天建议卸甲。超过第 45 天的未分派提醒转为已过期。已分派任务可继续登记反馈，已处理或已预约的订单不自动生成第二条回访。分派时在服务端重新验证日期阶段、服务项目和订单。
- 顾客可符合多个机会。卡片共享按会员去重的分派清单，跨分区查看保留原沟通目的，移除后可按其他机会重新加入。后端在同一事务内拒绝为已有待联系任务的顾客重复分派。
- SQL Server `NailMate` 的旧约束已在事务中更新。迁移前后 1,786 条回访记录、两个账号及团队业务状态一致。新约束保留历史第 21 天开始日，现用提醒由应用在访问时按新规则补算。升级前的完整备份位于 `C:\Users\Kevin\MoneyAI-backups\stage1-20261111-180956-8e11f7\sql\NailMate-before-care-window-20261111-231816.bak`，已通过 `RESTORE VERIFYONLY WITH CHECKSUM`，SHA-256 为 `b38683c47dc484605f0d9329883406d1d0164de2c710a63a2659fa8683b9a0f5`。本次备份未执行独立恢复。旧源码、迁移核对和服务日志位于 `C:\Users\Kevin\MoneyAI-backups\care-window-20261111-231816-8aaa4b2a`。
- 13 项账号版测试、32 项业务测试和 2 项旧版测试通过。隔离库验证旧约束升级、重跑和历史记录保留。Playwright 验证第 6、7、28、29、45、46 天边界、跨分区去重及员工卸甲话术，微信分享版已重建并验证。本地新版 PID `59100` 接管 3000，已核对首页、会话、脚本与未登录访问限制。重启后需重新登录。

### 2026-11-12 GitHub 源码基线

- 按用户要求将当前版本推送到 `origin/deploy/neon-render`。本次上传的功能基线为 `4dc0987a2ed52ed720ea7740833078ad951b7657`，推送后用 `git ls-remote` 核对远端提交。GitHub `main` 仍为 `31306467ea8cfb9594776569ffc997cc7426e47b`。
- `npm run check` 通过。复核了计划上传的 Git 历史和文件类型，本地配置、模拟快照、SQLite 文件、数据库备份和生成预览未加入本次上传。全新检出仍需按 README 取得本地数据文件。Neon 迁移和 Render 部署仍暂缓。

### 2026-11-12 本地建档、护理回访冷却与误派撤回

- 老板娘可在会员档案新增、编辑手工档案，分别登记护理回访和营销授权。在顾客档案登记实际美甲完成日后，可以在手工服务记录更正日期。数据沿用 SQL Server `TeamDemoState`，无需增表。账号版手工顾客标为真实数据，模拟顾客和微信分享版的记录标为模拟。服务端防止重复提交和使用过期的表单覆盖已更新的记录。
- 带有效服务订单的护理回访跳过 14 天冷却，翻牌背面仍显示上次联系日期。其他联系机会继续执行冷却，护理回访仍验证顾客授权、订单窗口、其他联系限制及重复分派。
- 误派撤回仅允许老板娘操作未登记反馈的待联系任务。原任务保留为已撤回，员工失去该任务权限，仍在回访窗口内的原订单提醒可重新分派。
- `npm run check`、14 项账号版测试、32 项业务测试和 2 项旧版测试通过。隔离 SQL 验证并发建档、重启恢复、员工可见范围和撤回释放。Playwright 在 390 像素视口验证建档、日期更正、刷新、近期联系提示和撤回后重新分派，并验证分享版刷新保留模拟登记。新版已在 `127.0.0.1:3000` 运行，PID `54972`，已核对首页、静态资源、会话、未登录访问保护和现用数据库。门店账号需重新登录。
- 切换前已为 `NailMate` 生成完整 `COPY_ONLY, CHECKSUM` 备份，并通过 `RESTORE VERIFYONLY WITH CHECKSUM`。路径为 `C:\Users\Kevin\MoneyAI-backups\stage1-20261111-180956-8e11f7\sql\NailMate-before-intake-20261112-001614-86bc2d28.bak`，SHA-256 为 `096fda36b175c2725c6abca77aac55948f88c6b848f84cbdf12bb444ad1230b7`，本次备份未执行独立恢复。启动日志在 `C:\Users\Kevin\MoneyAI-backups\intake-cutover-20261112-002738-fa44f992`。

### 2026-11-12 护理回访推荐布局与通用档案编辑

- 护理回访与其他经营机会复用优先名单标题、推荐数量选择和翻牌区。默认显示 3 张，可选 4、5、8 张。分页移至推荐区底部，翻牌背面继续显示回访建议和联系限制。
- 所有顾客均可由老板娘编辑，移除「手工档案」筛选和档案级别标签。编辑覆盖层保存在 `TeamDemoState.profileEdits`，保留原始会员、服务订单和来源类型。可编辑姓名、等级、入会日期、最近到店、累计消费、余额、周期、款式、技师、护理需求与项目、授权及投诉状态。补录最近到店用于复购，护理仍以美甲完成记录为准。
- `npm run check`、15 项账号版测试、32 项业务测试和 2 项旧版测试通过。Playwright 在 1440 像素视口核对护理回访和储值关怀默认同宽 3 张，并验证切换数量、翻页、联系限制和已有档案刷新后的保存结果。在 390 像素视口验证新建、编辑和弹窗滚动。微信分享版已重新生成并验证。
- 本地新版 PID `60140` 监听 `127.0.0.1:3000`，已核对首页、静态资源、会话、未登录访问保护和现用数据库。切换前备份已通过 `RESTORE VERIFYONLY WITH CHECKSUM`，文件位于 `C:\Users\Kevin\MoneyAI-backups\stage1-20261111-180956-8e11f7\sql\NailMate-before-profile-layout-20261112-004144-32867fe0.bak`。切换前源码差异及日志位于 `C:\Users\Kevin\MoneyAI-backups\profile-layout-20261112-004144-32867fe0`。

### 2026-11-12 会员编号与表达方式

- 新版工作台统一显示 `M0001` 格式会员编号。原模拟会员沿用其编号，新建顾客接续现有最大编号，旧手工登记顾客首次加载时补齐编号。显示编号独立保存在 `TeamDemoState.manualMembers[].member_number`，原主键继续用于订单、分派和备注关联。
- 话术工作台的表达方式统一为自然风、可爱风、温柔风、简洁风、优雅风。Playwright 验证下拉搜索、选中显示、档案与刷新后一致，微信分享版已重建并验证。账号版 16 项和业务回归 32 项测试通过。
- 新版本地服务由 PID `66052` 监听 `127.0.0.1:3000`。已核对首页、脚本、会话和未登录访问保护。切换前数据库备份已通过 `RESTORE VERIFYONLY WITH CHECKSUM`，文件为 `C:\Users\Kevin\MoneyAI-backups\stage1-20261111-180956-8e11f7\sql\NailMate-before-member-number-20261112-020406-4bafb050.bak`。启动日志和切换前源码差异位于 `C:\Users\Kevin\MoneyAI-backups\member-number-20261112-020406-4bafb050`。

### V4.1 源码发布

- 已将建档、护理回访冷却、误派撤回、推荐布局、通用档案编辑、会员编号和表达方式更新推送到 `origin/deploy/neon-render`，功能提交为 `4d4db31765e8ca1abda40e58e510b014ead681bc`。
- V4.1 源码发布使用 Git 标签 `v4.1` 和项目版本 `4.1.0`。发布包依照 README 单独准备运行数据和本地配置。

## 下一轮从这里继续

当前优先完善本地网站功能。手工建档、美甲完成登记、护理回访冷却和误派撤回已通过本地验收。收到恢复部署的指示后，从第三阶段继续，准备独立 Neon 试用库并核对迁移范围，重点包括手工档案及服务记录、`TeamCareReminders` 的唯一键、事务与访问控制。
