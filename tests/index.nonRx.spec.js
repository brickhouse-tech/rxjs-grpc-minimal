const through2 = require('through2');

const debug = require('../debug').spawn('test:helloworld');
const { loadProto, grpc } = require('./utils/loadProto');
const getProtoPath = require('./utils/getProtoPath');
const { initServer, reply } = require('../examples/helloworld/impls/server');
const { toRxClient } = require('../src');

const protPath = getProtoPath(__dirname)(
  '../examples/helloworld/helloworld.proto'
);
let portCounter = 59000;

describe('helloworld', () => {
  let grpcAPI, initServerPayload, conn, URI;

  describe('grpc client', () => {
    beforeEach(async () => {
      URI = `127.0.0.1:${portCounter++}`;
      grpcAPI = loadProto(protPath, 'helloworld');
      toRxClient(grpcAPI);

      initServerPayload = initServer({
        uri: URI,
        grpcAPI,
        serviceName: 'Greeter'
      });

      // Wait for server to bind
      await initServerPayload.ready;

      conn = new initServerPayload.GrpcService(
        URI,
        grpc.credentials.createInsecure()
      );
    });

    afterEach(() => {
      if (conn) {
        try { conn.close(); } catch (_e) { /* ignore */ }
      }
      if (initServerPayload && initServerPayload.server) {
        initServerPayload.server.forceShutdown();
      }
      initServerPayload = undefined;
    });

    it('created', () => {
      expect(initServerPayload.GrpcService).toBeTruthy();
    });

    describe('connection', () => {
      it('connect', () => {
        expect(conn).toBeTruthy();
      });

      describe('Greeter', () => {
        it('non stream', () => {
          return new Promise((resolve, reject) => {
            const name = 'Bob';
            conn.sayHello({ name }, (err, resp) => {
              if (err) return reject(err);
              expect(resp).toEqual({ message: reply(name) });
              resolve();
            });
          });
        });

        describe('stream reply', () => {
          it('completes', () => {
            return new Promise((resolve, reject) => {
              const name = 'Brody';
              let expectedCalls = 2;
              conn
                .sayMultiHello({
                  name,
                  numGreetings: String(expectedCalls),
                  doComplete: true
                })
                .once('error', error => reject(error))
                .once('status', stat => {
                  debug(() => ({ stat }));
                })
                .pipe(through2.obj(onData));

              function onData(resp, _enc, cb) {
                debug({ resp });
                expect(resp).toEqual({
                  message: reply(name)
                });
                expectedCalls--;
                cb();
                if (!expectedCalls) {
                  resolve();
                }
              }
            });
          });

          it('does not complete', () => {
            return new Promise((resolve, reject) => {
              const name = 'Brody';
              let completed = false;
              let call;  

              setTimeout(() => {
                call.cancel();
              }, 200);

              call = conn.sayMultiHello({
                name,
                numGreetings: 1,
                doComplete: false
              });

              call
                .once('error', _canceledObj => {
                  if (completed) {
                    reject(new Error('SHOULD NOT COMPLETE'));
                  } else {
                    resolve();
                  }
                })
                .once('status', stat => {
                  debug(() => ({ stat }));
                })
                .pipe(
                  through2.obj(onData, cb => {
                    completed = true;
                    reject(new Error('SHOULD NOT COMPLETE'));
                    cb();
                  })
                );

              function onData(resp, _enc, cb) {
                debug({ resp });
                expect(resp).toEqual({
                  message: reply(name)
                });
                cb();
              }
            });
          });
        });

        it('streamish (entire req message is buffered) request, non-stream reply', () => {
          return new Promise((resolve, reject) => {
            const name = 'STREAM';
            const stream = conn
              .streamSayHello((err, resp) => {
                if (err) return reject(err);
                expect(resp).toEqual({ message: reply(name) });
                resolve();
              })
              .once('error', reject)
              .once('status', stat => {
                debug(() => ({ stat }));
              });

            stream.write({ name });
            stream.end();
          });
        });
      });
    });
  });
});
