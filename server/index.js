'use strict';

// 兼容旧的启动命令，实际服务统一由 main.js 启动。
const { start } = require('./main');

if (require.main === module) {
    start().catch((error) => {
        console.error('启动失败：', error.message);
        process.exitCode = 1;
    });
}

module.exports = { start };
