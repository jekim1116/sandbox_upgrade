module.exports = {
    info: (msg) => console.log(`[INF] ${new Date().toISOString()} | ${msg}`),
    warn: (msg) => console.warn(`[WRN] ${new Date().toISOString()} | ${msg}`),
    error: (msg) => console.error(`[ERR] ${new Date().toISOString()} | ${msg}`)
};
