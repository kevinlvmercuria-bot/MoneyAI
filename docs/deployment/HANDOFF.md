# MoneyAI 部署交接

## 2026-11-14 v5.2 队员仓库发布

- 按用户要求，以队员仓库 `kevinlvmercuria-bot/MoneyAI` 的 main 为基线，快进纳入个人仓库的构建修复 `795ed317703028de494e7be9ac08ab2b5adcc5d1`，版本更新为 v5.2 / 5.2.0。
- package.json、package-lock.json、README、CHANGELOG 与部署说明同步版本；保留 v5.1 及既有历史标签。构建资源与脚本功能见下方修复记录。
- 在独立检出中发布，不修改主聊天工作区、暂存区或本机配置，不纳入手册、ZIP 和其他过程材料。本轮只发布源码及版本标签，未操作 Render、Neon 或本机业务服务。
- 发布前运行语法检查、公网配置测试、无 Git 构建回归与版本一致性核对。云端实际登录、分派反馈与重启持久化仍待验收；此前数据库测试权限限制不因本次发布而消除。

## 2026-11-14 Render 首次构建失败修复

- 首次部署 `4f45a45` 的 npm 依赖安装成功，但构建脚本缺少旧提交对象，且 Render 检出环境没有可用 origin，导致 `git fetch` 失败，尚未进入 Neon 连接阶段。
- 改为提交 `database/fixtures/team-demo.json.gz`，构建只在本地解压和验证模拟标记及 2,800 位会员，不再读取 Git 历史或访问 remote。数据来自固定历史版本，不从日常 data 或业务数据库复制；来源和内容哈希见 fixtures/README。
- 新增回归测试通过：没有 .git、PATH 为空的源码包能首次和重复生成数据，已有不同数据与压缩文件损坏时停止且原文件保留。全项目语法检查通过。本轮仅修改构建资源与脚本，没有连接、迁移或重置数据库。
- Render 使用个人仓库 `diYOUNG-Breeze/MoneyAI`；本次在其 main 的独立检出中准备修复，避免混入主工作区未提交改动。云端重新部署、登录及持久化仍需验收。

## 2026-11-14 v5.1 公网演示适配发布

- 用户授权将公网适配作为 v5.1 / 5.1.0 推送至 kevinlvmercuria-bot/MoneyAI，目标 main 与 v5.1 标签。
- 新增公网 Host/Origin 校验、HTTPS Secure 登录 Cookie、平台 PORT、云端模拟资料构建及账号版启动脚本。首次管理员由环境变量创建，关闭公网浏览器首次注册；已有账号及业务状态不会被重置。
- 部署入口为 docs/deployment/cloud-demo.md。运行仍须配置独立 PostgreSQL / Neon 演示库、管理员及稳定加密密钥；本次源码发布没有创建 Neon / Render 服务，也不迁移本机业务库。
- 语法检查、公网访问 3 项测试、版本一致性、模拟资料首次与重复构建通过。此前数据库测试因本机账号缺少 CREATEDB 权限未全部完成；云端登录、员工分派与反馈、重启持久化和手机访问仍待验收。
- 本次提交仅包含版本与公网适配相关文件，不包含本机 .env、日常数据、交付 ZIP、手册或其他阶段未提交材料。既有 v5 及历史分支保留。


## 2026-11-12 v5 源码发布

- 用户授权将当前成果作为 v5 上传 GitHub。项目版本统一为 `5.0.0`，标签采用 `v5`，目标仍为 `origin` 的 `kevinlvmercuria-bot/MoneyAI`，保留 v4.1 及既有专题分支。
- 发布范围包含 PostgreSQL 全量适配、企微发送与接入向导、独立微信客服、真实会员导入、话术页精简、前后端结构整理及本机密码重置工具。`CHANGELOG.md` 记录升级注意，SQL Server 用户不能直接按旧方式启动 v5。
- 干净 Git 工作树使用 `npm ci --omit=optional`，仅通过 Git 历史恢复模拟数据，分享构建、语法检查、PostgreSQL 17 隔离测试 60 项（无跳过）及 0 漏洞依赖审计均通过。受控验证摘要纳入 `codex-artifacts/reports/v5-release-validation.md`；机器日志和本机环境仍保留在本地。
- 上传前远端 main 与原本地基线一致。提交排除 `.env`、服务器加密密钥、真实会员数据、数据库备份和临时工作树；发布不更改日常数据库和服务，也不执行真实客户发送或云端部署。
- GitHub 版本入口为 https://github.com/kevinlvmercuria-bot/MoneyAI/releases/tag/v5 。最终发布 SHA 与远端复核结果保存在本机发布结果报告中，源码使用方式以 README 为准。

## 2026-11-12 话术入口、企微接入与真实会员导入（最新界面与服务）

- 根据用户截图，将员工话术页的企微发送、发送记录和客服入口移到顾客预览下方，删除该页的复制、图文卡片下载、带回任务按钮及对应无用处理函数。任务详情中的复制入口保留。发送主按钮为「通过企业微信发送」，未配置时显示「尚未配置，前往接入设置」。员工点击未配置入口只查看管理员接入指引，不能填写或读取密钥。
- 管理员从「员工账号管理 → 企微接入设置」填写企业 ID、客户联系应用密钥，可选微信客服和回调设置。保存后立即应用到客户端代理，不需要再次重启。数据库存储 AES-256-GCM 密文，GET 不回显密钥，平台错误提示会遮盖凭据；本机加密密钥位于 `%LOCALAPPDATA%/NailMate/private/wecom-settings.key`，实际验证其权限仅允许当前用户和 SYSTEM，并在隔离库验证默认文件密钥加密、重载解密。备份数据库时必须同时保全该密钥；云端使用稳定的 WECOM_SETTINGS_KEY。
- 检测会实际获取访问凭据、读取客户联系员工、查询群发记录，并在选定员工后检测其客户列表权限；显示逐项结果、错误码及失败原因。只读权限检查不冒充实际发送成功。真实测试向导按「检测 → 绑定员工和真实会员 → 预览 → 确认一次真实测试 → 员工企微确认 → 查询结果」操作，沿用授权、冷却、任务归属和模拟会员禁发规则；保留管理员发起人和负责员工。
- 「会员档案 → 导入真实会员」支持 Excel .xlsx 与 UTF-8/GB18030 CSV，提供实际可下载的两种模板。第一版只导入会员档案：姓名与手机号必填，可匹配等级、余额、消费、偏好、日期、授权及备注。每批最多 500 行、50 列、5 MB；先映射预览、修正错误、勾选核对后确认。整批事务写入，重复提交不重复新增，重复手机号不覆盖旧会员，未提供授权时默认未授权。导入记录标为真实，不虚构服务订单。
- 依赖增加 ExcelJS 4.4.0 和 csv-parse 7.0.3；ExcelJS 的 uuid 固定覆盖为兼容其 v4 调用的 11.1.1，已验证 XLSX 读写，npm audit 为 0 个已知漏洞。管理员接入和导入测试加入 test:integrations。
- 隔离 PostgreSQL 17 回归：账号 16 项、核心业务 32 项、旧入口 2 项、集成 8 项，共 58 项通过；语法与差异检查通过。Chrome 实测设置保存/不回显/权限检测、完整测试向导（受控接口）、模板下载和 Excel 导入保存；员工未配置提示、草稿编辑、按钮位置、发送草稿衔接、390px 布局无横向溢出、页面无脚本错误。分享版已重建。
- 正式更新前备份源码、数据、配置、数据库和服务器加密密钥，受控备份根目录为 `C:\Users\12505\AppData\Local\NailMate\backups\admin-import-20261112212317`。停止核实的旧 PID 18056 后进行增量迁移：原 22 张表的全部旧字段、行数和内容 SHA-256 保持一致，新增设置与导入表，目标共 24 张表；发送批次增加管理员发起人字段。迁移后的 PostgreSQL 备份已恢复至独立库，24 张表内容全部核对一致，没有重置或导入测试数据到日常库；独立验收集群已停止。
- 当前隐藏服务 PID 为 41796，监听 `127.0.0.1:3000`。首页依赖的新脚本返回 200，会话接口返回 200 且 setupRequired=false，未登录访问接入设置及模板接口返回 401，启动日志无错误。服务已重启，现有浏览器需重新登录。管理员尚需填入自己的真实企微凭据并完成真实联调；本轮没有替门店发送真实客户消息。
- 验收报告为 `codex-artifacts/reports/admin-import-rollout-20261112.json` 和 `admin-import-ui-20261112.json`，日志位于 `codex-artifacts/logs/admin-import-20261112/`，截图及辅助脚本在 `codex-artifacts/tmp/admin-import-ui/` 等。维护与操作入口为 `docs/postgresql-wecom.md`、`docs/member-import.md`。

## 2026-11-12 本机密码重置工具

- 根据用户请求新增根目录 `重置登录密码.bat`，调用 `scripts/reset-password.js`。使用现有 PostgreSQL 配置，显示实际目标和已有工作台账号；默认老板娘，也支持选择已有员工。密码在交互终端中输入两次、不回显、不作为命令行参数，输入 `RESET` 才提交；Ctrl+C 或其他确认输入取消。
- 复用现有 `saveCredentials()` 的校验及 scrypt，事务内复核账号是否仍存在及盐值是否改变，只更新所选账号的凭据，不创建账号或修改业务记录。旧会话按现有盐值校验机制失效，不需要重启网站。没有新增公开重置接口，没有修改现有认证模块或日常 `.env`。
- `scripts/reset-password.test.js` 的数据库部分必须显式设置独立 `RESET_TEST_DATABASE_URL`，不回退到日常库。本轮在单独的 PostgreSQL 17 集群运行新测试 2 项和原账号版 16 项，共 18 项全部通过；覆盖未知账号、取消、密码校验、并发凭据保护、新密码登录、旧密码拒绝、旧会话失效，以及其他账号和业务数据保留。
- 已在真实交互式终端运行 BAT，仅重置隔离库内 `bat-fixture` 测试账号；确认密码输入无回显、确认提交及 BAT 暂停退出正常。测试集群已停止。没有执行日常老板娘账号的密码重置，也没有停止或重启当前网站。
- 使用说明在 README「本机重置工作台密码」。验证报告为 `codex-artifacts/reports/password-reset-20261112.json`，日志为 `codex-artifacts/logs/password-reset-tests.log`；辅助验证脚本位于 `codex-artifacts/tmp/test-password-tool.js`。

## 2026-11-12 正式数据库切换（当前运行状态）

- 用户明确要求完成正式切换。本轮核实 `.env` 已配置正式 `DATABASE_URL`，目标为本机 PostgreSQL 17.12 的 `127.0.0.1:5432/nailmate`，运行角色 `nailmate_app`，不是前轮临时测试集群。目标原先为空；原 SQL Server 来源为 `SQLEXPRESS01/NailMate`。
- 在独立 PostgreSQL 17.12 集群上重新执行全部回归：新版 16 项、核心与旧业务 32 项、旧入口边界 2 项、企微/迁移 6 项，总计 56 项全部通过。正式库的建表权限及结构迁移也通过事务回滚验证，没有用日常库运行这些测试。
- 切换前备份当前源码、数据文件、受控配置和可运行的 SQL Server 回退源码，备份根目录为 `C:\Users\12505\AppData\Local\NailMate\backups\cutover-20261112-200656`，已限制访问权限。原 `.env` 保留，没有把凭据写入报告。
- 核实旧 PID `29220` 占用 3000 端口，且实际首页与工作区文件逐字节一致后停止该服务。执行 `node database/transfer-sqlserver.js --apply --source-stopped`，先创建 SQL Server COPY_ONLY / CHECKSUM 备份并执行 RESTORE VERIFYONLY，再正式搬迁。
- 15 张来源业务表逐表数量及规范化内容 SHA-256 与 PostgreSQL 一致，自增序列已校正，账号盐值和密码哈希保留。目标共 22 张表（含新增企微和客服表）；旧版 2,800 位会员、1 条审核任务、12 份话术草稿、新版 1 条状态、1 个已开通登录账号及 1,080 条回访记录均保留。新版状态中的六名员工档案保留，原先没有开通密码的员工没有擅自开通。
- 正式库生成 `postgres-before-open.dump`，使用 pg_restore 在独立 PostgreSQL 17.12 实例恢复为 `nailmate_formal_restore`，再次逐表核对全部 15 张业务表内容一致。正式开放前已完成此恢复验证，原 SQL Server 数据未清空或升级。验收用独立 PostgreSQL 集群已停止，正式 Windows 数据库服务保持运行。
- 新服务由隐藏 Node 进程 PID `18056` 从当前工作区运行 `server/main.js`，监听 `127.0.0.1:3000`；系统连接表确认该进程已建立到 `127.0.0.1:5432` 的连接。首页、脚本、会话接口返回 200，`setupRequired=false`；未登录读取新版、旧版、企微发送和客服接口均返回 401。启动日志无错误，SQL Server 已不再作为此服务的运行时数据库。
- 原账号密码的哈希和盐值已完成内容一致性核对；未要求用户提供密码，因此没有声称“已实际输入原密码登录成功”。原浏览器会话失效，需要使用原账号重新登录。没有在正式库创建测试账号、分派测试任务或发送真实企微消息。
- 报告为 `codex-artifacts/reports/formal-cutover-20261112.json`，包含脱敏目标信息、逐表数量/摘要和备份位置。执行与服务日志位于 `codex-artifacts/logs/cutover-20261112/`。SQL Server 备份完整路径见报告，PostgreSQL 备份及受控配置在上述独立备份根目录。
- 后续日常启动仍使用 `npm start` 或 `启动NailMate.cmd`，PostgreSQL 由既有 Windows 服务 `postgresql-x64-17` 提供。本轮没有配置开机启动 Node，也没有执行 Neon / Render 部署；企微正式联调仍需平台凭据与回调配置。
- 如需回退，先停写并保全 PostgreSQL 切换后新增记录，再使用受控回退源码与原 SQL Server，禁止直接切回造成新记录丢失。下文“正式切换未执行”的描述属于本轮以前的历史记录。

## 2026-11-12 PostgreSQL 与企业微信代码实施记录

- 本轮在 `E:\FJNU\计算机网络与安全学院软件工程专业\大二\黑客松 MoneyAI\NailMate-GitHub` 实施，保留开始时全部未提交修改；没有提交、推送或执行 Neon / Render 部署。修改前维护源码保存在 `codex-artifacts/tmp/postgres-wecom-before/`，没有复制或改写现用 `.env`。
- 新旧版运行时代码均改为 `pg` / PostgreSQL。完成参数化查询、jsonb / bytea / 日期类型、事务级 advisory lock、初始化、来源导入与旧版接口适配；`mssql` 与 Windows 驱动仅供一次性来源搬迁工具使用。`DATABASE_URL` 未配置时明确报错，不自动连接或修改旧 SQL Server。
- 只读核实当前 SQL Server 的 15 张业务表；将其完整搬迁到随机命名的隔离 PostgreSQL 库，逐表数量及规范化内容 SHA-256 一致。重复执行、冲突回滚、pg_dump 备份与 pg_restore 到另一独立库均通过，随后清理本轮随机库。没有对日常来源库执行结构迁移、清空或切换。
- 本机隔离 PostgreSQL 18.6 使用用户临时目录及 `127.0.0.1:55439`，不属于正式运行目标；因 PostgreSQL 原生程序在当前中文路径下初始化遇到编码错误，测试工具和测试集群放在 `%TEMP%/nailmate-pg-tools-20261112/`。验收后已通过 pg_ctl 停止测试数据库，不得将此临时地址当作部署配置。
- 企微好友回访新增员工/会员人工绑定、统一或逐人话术、实拍图、逐人预检、任务持久化、幂等防重、平台结果查询和重启恢复。仅真实会员且通过服务端权限与资格校验才能提交；创建平台任务不代表已发送。平台发送事实进入联系冷却，不伪造反馈。离职清理绑定，保留发送历史。
- 网页微信客服使用独立渠道，支持咨询入口、加密回调、游标同步、会话分配及会员人工关联、文字/图片查看与文字回复。处理 48 小时窗口、5 条回复额度、平台会话状态、失败事件和未知结果，员工只能访问分配给其账号的会话。其他消息类型暂显示类型提示，不支持网页语音/视频播放、文件下载或图片回复。原企微好友聊天没有迁入网页。
- 企业微信官方页面经浏览器搜索工具读取失败后，通过 HTTPS 直接读取成功，已核对创建群发、结果查询、客服消息及会话状态。平台规则入口见 `docs/postgresql-wecom.md`。
- 最终执行 `npm run check`，新版 `test:team` 16 项、`npm test` 32 项、`test:legacy` 2 项、`test:integrations` 6 项均通过。真实 `server/main.js` 在隔离库启动，通过会话接口和未登录访问保护检查；未调用真实 AI 或真实企微接口。
- Chrome 无头实测老板娘设置账号、员工登录、绑定候选读取、统一与逐人草稿预览、提交及持久化，1440px / 390px 页面无脚本错误，移动端弹窗无横向溢出。分享版已重建，并从 file:// 验证企微发送和客服入口不请求 API。
- 辅助证据：`codex-artifacts/reports/postgres-transfer-20261112.json` 与 `postgres-wecom-ui-20261112.json`；测试日志和截图在 `codex-artifacts/tmp/`。含完整搬迁数据的 PostgreSQL 备份放在用户临时目录中，未放入 Git；报告只保留数量和内容摘要。
- 验收结束时，自动审批拦截了停止临时助手并清理重复下载文件的组合命令，仅返回 `blocked by policy`，该组合命令没有执行；随后通过单独的 pg_ctl 命令成功停止本轮测试 PostgreSQL。临时下载材料和验证证据保留，没有尝试更改审批设置。
- **正式切换与真实联调未执行**：当前 `.env` 尚无已确认的正式 PostgreSQL 目标及门店企微凭据，未停止或重启日常 3000 服务。现用内存后端仍需按切换指南迁移数据后重启；不可直接把本轮临时测试集群用于日常业务。管理员需配置接口权限、可信 IP、测试员工/会员与 HTTPS 客服回调，再分别验收群发确认和网页客服收发。

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

### 2026-11-12 V4.1 整合与另一台开发机验收

- 本轮在 `NailMate-GitHub` 工作区从 `origin/deploy/neon-render` 的 `c02412c` 建立 `integrate/v4.1-local`，原 `main` 的 `3130646` 留在本地 `backup/main-before-v4.1-20261112`。原 `NailMate` 目录未修改。整合目标是将验证过的新版通过 PR 纳入 `main`；保留原部署分支与 `v4.1` 标签，最终合并状态以 GitHub PR 和分支为准。Neon、Render 仍未执行。
- 新增 `npm run data:prepare`，从已存在的历史分享版 `09ca7b6` 提取原账号版模拟快照，从 `3130646` 恢复旧版 SQLite 来源。两份模拟基线分别保留，已有文件不会覆盖；无效快照或缺少历史对象时明确报错。账号版快照包含 2,800 位会员及原有 1,537 条备注，SQLite 仍保留后来追加的性格备注。没有导入同学电脑的真实账号或业务状态。
- 新增 `npm run db:migrate`，复用首次初始化的结构迁移，在事务中执行，但不导入来源、不初始化演示任务。全新数据库继续使用 `db:init`。README 已分别说明全新启动与已有数据库升级；仅忽略辅助目录中的临时文件和日志，其他辅助文件按用途决定是否跟踪。
- 本机 `localhost\\SQLEXPRESS01/NailMate` 升级前完成 `COPY_ONLY, CHECKSUM` 备份及 `RESTORE VERIFYONLY`。备份在 SQL Server 默认 Backup 目录，文件名为 `NailMate-before-v41-integration-1794452730223.bak`。备份目录由 SQL Server 管理，未复制到源码目录。恢复到随机命名的独立库，`DBCC CHECKDB` 通过；连续两次结构迁移后，原有各表的记录数量及内容 SHA-256 一致。随后升级现用库，原各表同样通过数量及内容核对，原 `.env` 和 SQLite 字节保持一致。
- 本轮实际执行语法检查、新版 16 项、业务回归 32 项及旧版 2 项测试，全部通过。通过独立恢复库中的浏览器操作验证老板娘登录与分派、员工登录与待办、反馈保存、刷新后历史反馈可读取；测试库随后清理。未调用真实 AI，也没有发送真实客户消息。
- 在临时全新检出中，`npm ci --prefer-offline`、首次与重复 `data:prepare`、`build:share`、语法检查通过。生成的分享文件仅留在本地。现用新版通过隐藏 Node 进程运行于 `127.0.0.1:3000`；首页、脚本、会话接口返回 200，未登录的账号版请求返回 401。现用库尚无老板娘凭据，首次账号由使用者自行设置，测试凭据仅用于已清理的独立库。
- 本机辅助证据在 `codex-artifacts/reports/integration-20261112.json`；日志在 `codex-artifacts/logs/`，配置及 SQLite 备份、全新检出与临时验证脚本在 `codex-artifacts/tmp/integration-20261112/`。这些本机材料未提交，报告通过本地 Git exclude 单独排除。

### 2026-11-12 商业化前的结构整理

- 本轮维护目录为 `E:\FJNU\计算机网络与安全学院软件工程专业\大二\黑客松 MoneyAI\NailMate-GitHub`，修改前 Git 基线为 `9087736`。执行时外层 `NailMate` 旧副本已不在现场，本轮没有移动或删除它，不能声称完成该副本的差异核验。
- 早期原型的 `members.js`、`config.js`、浏览器 `app.js`、原型测试，以及旧 `wg_member` 初始化成组退役。原型 `server/app.js` 被正式 HTTP 应用装配模块替代。历史从上述 Git 基线恢复；本地源码快照在 `codex-artifacts/tmp/structure-20261112/before/`。
- 新版前端拆为 `public/app/pages/` 七个业务页面和 `app/` 内的状态、请求、身份、交互及任务操作模块。`public/team-workspace.js` 从约 1,850 行缩至 577 行，保留导航、刷新和模块协调。页面通过共享上下文访问当前状态，避免刷新后缓存旧对象。
- 纯业务规则移至 `public/shared/team-rules.js`，分享版存储适配在 `team-persistence.js`，`public/team-store.js` 保留业务操作和旧 `options.storage` 兼容。存储键、payload、权限、日期口径和业务规则保持。分享构建直接读取 `index.html` 的脚本顺序，已重建单文件并验证。
- `server/main.js` 仅保留启动及资源关闭，`server/app.js` 装配 HTTP；有效旧版 AI 后端集中到 `server/legacy/`。新版 SQL 读写在 `server/team-repository.js`，保留原有事务和防重行为。`npm start` 默认保持新旧兼容，`npm run start:team` 关闭旧页面与旧 API。
- `database/migrations.js` 区分完整迁移和 `migrateTeam`。`npm run db:init:team` 只创建/升级 `TeamCredentials`、`TeamDemoState`、`TeamCareReminders`，不导入 SQLite、演示会员或任务。已有列和状态格式不变。当前账号版仍需 `data/team-data.json`；独立数据包、业务表拆分、Neon 与多门店模型未在本轮实施。
- 实际执行 `npm run check`、`npm test` 32 项、`npm run test:team` 16 项、`npm run test:legacy` 2 项，全部通过。保留旧版的真实 AI/审核链路由原有 SQL 回归覆盖；新增边界测试验证独立账号版不挂载旧接口，以及只建新版三张表即可登录和读取工作台。
- Chrome 在随机独立 SQL 库验证老板娘首次设置账号、六页导航、档案编辑与刷新、新增员工与分派；390px 员工登录、话术、反馈与刷新；老板娘报表与应用重建后持久化。分享版从 `file://` 验证分派、身份切换、员工反馈、刷新恢复和退出，无 HTTP 资源请求、无浏览器脚本错误。独立库已清理。没有调用真实模型或发送客户消息。
- 页面证据与临时脚本在 `codex-artifacts/tmp/structure-20261112/`，机器可读浏览器结果在 `codex-artifacts/reports/structure-ui-20261112.json`，人工维护入口为 `docs/architecture.md`；README 和 AGENTS 已同步。
- **运行切换未完成**：自动审批检查拒绝了停止当前 Node 进程并隐藏启动新进程的操作，仅返回 `blocked by policy`。该命令未执行；本轮没有重启现用 3000 服务，也没有对现用库执行结构迁移。当前内存中的后端仍是整理前版本，需要使用者手动停止旧服务，再在当前目录执行 `npm start` 或双击 `启动NailMate.cmd`，重启后重新登录。GitHub、Neon 和 Render 均未在本轮更新。

## 下一轮从这里继续

本机正式 PostgreSQL 切换已完成。后续按 `docs/postgresql-wecom.md` 由管理员提供受控企微配置、测试员工和会员，验收群发确认与网页客服回调；云端部署仍需另行安排。早期阶段表保留作历史记录。
