const util = require("node:util");

if (!global.__TIMESTAMP_CONSOLE_PATCHED__) {
  global.__TIMESTAMP_CONSOLE_PATCHED__ = true;

  const wrap = (method) => {
    const original = console[method].bind(console);
    return (...args) => {
      const message = util.format(...args);
      original(`[${new Date().toISOString()}] ${message}`);
    };
  };

  console.log = wrap("log");
  console.info = wrap("info");
  console.warn = wrap("warn");
  console.error = wrap("error");
}
