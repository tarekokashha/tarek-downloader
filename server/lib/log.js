const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `${code}${text}${RESET}` : text);

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function emit(stream, colour, tag, args) {
  stream.write(
    `${paint(DIM, stamp())} ${paint(colour, tag)} ${args
      .map((a) => (typeof a === 'string' ? a : inspect(a)))
      .join(' ')}\n`,
  );
}

function inspect(value) {
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  info: (...a) => emit(process.stdout, CYAN, 'info ', a),
  ok: (...a) => emit(process.stdout, GREEN, 'ok   ', a),
  warn: (...a) => emit(process.stdout, YELLOW, 'warn ', a),
  error: (...a) => emit(process.stderr, RED, 'error', a),
  plain: (...a) => process.stdout.write(`${a.join(' ')}\n`),
};

export default log;
