const grpc = require('@grpc/grpc-js');

const through2 = require('through2');
const debug = require('../../../debug').spawn('test:utils:helloServer');

function mockService() {
  return {
    sayHello(call, callback) {
      callback(null, { message: reply(call.request.name) });
    },
    streamSayHello(client, mainCb) {
      const dbg = debug.spawn('streamSayHello');
      let message;

      /*
        NOT USING LEGACY NODE STREAMS API 'data', and 'end'
        NOTE: https://github.com/substack/stream-handbook#classic-readable-streams
      */
      const transform = (m, _enc, cb) => {
        dbg({ m });
        message = m;
        cb();
      };

      const flush = cb => {
        if (!message) {
          return cb();
        }
        const { name } = message;
        mainCb(null, { message: reply(name) });
        cb();
      };

      client.pipe(through2.obj(transform, flush));
    },
    sayMultiHello(client) {
      // STREAMING RESPONSE
      const dbg = debug.spawn('sayMultiHello');
      /* eslint-disable camelcase, prefer-const */
      // SINGLE REQUEST
      let {
        request: { name, numGreetings, doComplete }
      } = client;
      dbg({ name, numGreetings });
      numGreetings = numGreetings || 1;
      while (--numGreetings >= 0) {
        dbg('wrote');
        client.write({ message: reply(name) });
      }
      dbg('end');
      client.once('cancelled', () => client.end());
      if (doComplete) {
        client.end();
      }

      /* eslint-enable camelcase */
    }
  };
}

const initServer = require('../../../src/utils/testHelpers/server').initServer(
  mockService
);

function reply(name) {
  return `Hello ${name}!`;
}

module.exports = {
  initServer,
  reply,
  grpc
};
