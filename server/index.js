'use strict';
require('./config');
const { createApp } = require('./app');
const app = createApp();
const port = Number(process.env.APP_PORT || 3000);
const host = process.env.APP_HOST || '127.0.0.1';
const server = app.listen(port, host, () => {
    console.log(`NailMate: http://${host}:${port}`);
    console.log(`Member data: ${process.env.DB_MODE || 'mock'}; review/reports: mock (memory only)`);
});
server.on('error', (error) => { console.error(`Start failed: ${error.code}`); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(async () => {
        await app.locals.close();
        process.exitCode = 0;
    }));
}
