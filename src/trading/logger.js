import util from "node:util";

function emit(fn, args) {
  const message = util.format(...args);
  fn(`[trading] ${message}`);
}

export const logger = {
  info: (...args) => emit(console.log, args),
  warn: (...args) => emit(console.warn, args),
  error: (...args) => emit(console.error, args)
};

export function formatError(err) {
  if (!err) return "unknown";
  if (err instanceof Error) return err.stack || err.message;
  return String(err);
}
