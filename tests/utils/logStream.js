const { Transform } = require('stream');
const debug = require('../../debug').spawn('logStream');

function logHandle(chunk, _, cb) {
  const dbg = debug.spawn('logHandle');
  if (typeof chunk !== 'string' && !(chunk instanceof Buffer)) {
    dbg(() => JSON.stringify(chunk));
  } else {
    dbg(() => String(chunk));
  }

  this.push(chunk);
  cb();
}

module.exports = function logStream() {
  return new Transform({ objectMode: true, transform: logHandle });
};

module.exports.logHandle = logHandle;
