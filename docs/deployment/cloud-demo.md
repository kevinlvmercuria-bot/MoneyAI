# Neon + Render 演示部署

此部署只使用固定历史版本的 2,800 位模拟会员，与本机业务库分离。所有访问者共用同一演示门店和业务状态，尚无多门店隔离。当前会话保存在服务内存中，重启后需要重新登录。

## 1. 注册与数据库

1. 在 https://console.neon.tech 注册，建立独立项目 `nailmate-demo`。优先与应用服务选择相近区域。
2. 保留默认数据库，获取带 TLS 参数的 PostgreSQL 连接串，保存在 Render 的环境变量 `DATABASE_URL`，不要放入仓库、前端代码或聊天。
3. 本次使用独立空库，不导入本机业务备份，不修改本机 `.env`。

## 2. Render Web Service

注册 https://dashboard.render.com，授权访问实际源码仓库 `kevinlvmercuria-bot/MoneyAI`，选择包含 v5.1 的 `main` 分支；旧的 v5 发布不含公网适配。

| 字段 | 值 |
| --- | --- |
| 类型 | Web Service |
| Runtime | Node |
| Root Directory | 留空（package.json 位于仓库根目录） |
| Build Command | `npm ci --omit=optional && node scripts/prepare-cloud-demo.js` |
| Start Command | `node scripts/start-cloud-demo.js` |
| Health Check Path | `/api/team/auth/session` |
| 实例数量 | 1（当前登录会话在内存中） |

使用平台当时可选的免费实例进行试用；免费实例休眠会影响首次打开速度。正式演示前提前打开检查。

## 3. 环境变量

| 名称 | 值或用途 |
| --- | --- |
| NODE_VERSION | `24.18.0`（本轮本地验证版本） |
| NODE_ENV | `production` |
| DATABASE_URL | Neon 控制台取得的连接串，保留 TLS 参数；首轮使用 Direct connection |
| WECOM_SETTINGS_KEY | 32 字节随机数的 Base64；生成一次，作为长期密钥妥善保存 |
| DEMO_OWNER_USERNAME | 自定，例如 `demo-owner`；3–32 位小写字母、数字、点、下划线或连字符 |
| DEMO_OWNER_PASSWORD | 自定的强密码，10–128 位；不要与日常账号共用 |

Render 自动提供 `PORT` 和 `RENDER_EXTERNAL_URL`，无需手填。自定义域名时设置 `APP_PUBLIC_URL=https://你的域名`，并同步更新 Render 域名配置。仅允许配置的公网 Host 与同源写请求，Cookie 使用 Secure。

PowerShell 中可生成企微配置加密密钥：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

不要设置真实企微或 AI 密钥。本次只验收账号版模拟业务。`WECOM_SETTINGS_KEY` 用于服务配置加密，不会自行启用真实消息发送。

启动脚本在事务中升级演示库并仅在没有老板娘时创建管理员。后续部署不会重设密码、删除任务或清空反馈；修改环境变量中的初始密码不会修改已有账号。

构建时解压随源码版本管理的 `database/fixtures/team-demo.json.gz` 并核验模拟标记与会员数，不依赖 Git 历史、remote 或构建阶段联网。来源见同目录 README；不上传本机 data 作为替代。已有不同的数据文件时停止，不覆盖。

## 4. 验收后分享

1. 等待构建与启动成功，打开平台提供的 HTTPS 地址。
2. 用环境变量设定的管理员登录；公开站点不提供首次管理员注册。
3. 创建演示员工账号，分派模拟任务，员工登录并填写反馈。
4. 管理员查看反馈；重启服务后重新登录，确认任务和反馈仍在。
5. 用手机移动网络打开同一网址，核对实际访问速度与布局。未实测前不承诺国内不同网络的可达性。
6. 分享网址和专用演示员工账号。需要展示管理员功能时另行提供演示管理员账号，并明确所有体验者会共同修改演示数据。

不需要上传原始 demo ZIP、本机 .env、node_modules、SQL 备份、真实账号及企微密钥。依赖由 Render 构建阶段安装。
