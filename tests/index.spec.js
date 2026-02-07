const { of, Subject, ReplaySubject } = require('rxjs');

const { loadProto, grpc } = require('./utils/loadProto');
const getProtoPath = require('./utils/getProtoPath');
const server = require('../examples/helloworld/impls/server');
const serverRx = require('../examples/helloworld/impls/serverRx');
const { toRxClient } = require('../src');

const protPath = getProtoPath(__dirname)(
  '../examples/helloworld/helloworld.proto'
);
let portCounter = 55000;

const servers = {
  server,
  serverRx
};

const debug = require('../debug').spawn('test:index');

for (const name in servers) {
  runSuite(servers[name], name);
}

function runSuite({ initServer, reply }, serverName) {
  describe(`Rx helloworld with ${serverName}`, () => {
    let grpcAPI, initServerPayload, conn, URI;

    describe('grpc client', () => {
      beforeEach(async () => {
        URI = `127.0.0.1:${portCounter++}`;
        grpcAPI = loadProto(protPath, 'helloworld');
        // run anyway to make sure it does not
        // kill original API
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

      // Note: $method_names no longer exists in @grpc/grpc-js
      // This test is kept for documentation but skipped
      it.skip('$method_names is not a function (legacy grpc only)', () => {
         
        const { $method_names } = initServerPayload.GrpcService.prototype;
        expect($method_names).toBeTruthy();
        expect(typeof $method_names).toBe('object');
         
      });

      describe('connection', () => {
        it('connect', () => {
          expect(conn).toBeTruthy();
        });

        describe('Greeter', () => {
          describe('non stream', () => {
            it('works', async () => {
              const name = 'Bob';
              const obs = conn.sayHelloRx({ name });
              await obs.forEach(resp => {
                expect(obs.grpcCancel).toBeFalsy();
                expect(grpcAPI.cancelCache.size).toBe(0);
                expect(resp).toEqual({ message: reply(name) });
              });
              expect(grpcAPI.cancelCache.size).toBe(0);
            });
          });

          describe('stream reply', () => {
            let name;
            let expectedCalls;

            function makeCall(doComplete = true) {
              expectedCalls = 2;
              name = 'Brody';

              return conn.sayMultiHelloRx({
                name,
                numGreetings: expectedCalls,
                doComplete
              });
            }

            it('works', async () => {
              const callObs = makeCall(true);
              await callObs.forEach(resp => {
                expect(callObs.grpcCancel).toBeTruthy();
                expect(grpcAPI.cancelCache.size).toBe(1);
                expect(resp).toEqual({
                  message: reply(name)
                });
                expectedCalls--;
              });
              expect(grpcAPI.cancelCache.size).toBe(0);
              expect(expectedCalls).toBe(0);
            });

            it('has .grpcCancel', async () => {
              const callObs = makeCall();
              await callObs.forEach(_resp => {});
              expect(callObs.grpcCancel).toBeTruthy();
            });

            it('cancelCache is empty upon completion', () => {
              return new Promise((resolve, reject) => {
                const callObs = makeCall(true); // complete!
                callObs.subscribe({
                  next() {
                    expect(callObs.grpcCancel).toBeTruthy();
                    expect(grpcAPI.cancelCache.size).toBe(1);
                    debug(() => 'called next');
                  },
                  error: reject,
                  complete() {
                    expect(grpcAPI.cancelCache.size).toBe(0);
                    resolve();
                  }
                });
              });
            });

            it('cancelCache is cleaned on cancel (when un-completed)', () => {
              return new Promise((resolve, reject) => {
                const callObs = makeCall(false);
                callObs.subscribe({
                  next() {
                    expect(callObs.grpcCancel).toBeTruthy();
                    expect(grpcAPI.cancelCache.size).toBe(1);
                    expectedCalls--;
                    debug(() => 'called next');
                    if (expectedCalls === 0) {
                      callObs.grpcCancel();
                    }
                  },
                  error: cancelError => {
                    // we full expect the cancel error
                    debug(() => cancelError.message);
                    expect(grpcAPI.cancelCache.size).toBe(0);
                    resolve();
                  },
                  complete() {
                    reject(new Error('should not complete'));
                  }
                });
              });
            });
          });

          describe('streamed request', () => {
            it('ReplaySubject - streamed | completed ahead of consumption', async () => {
              const name = 'ReplaySubject';
              const writer = new ReplaySubject();
              const observable = conn.streamSayHelloRx(writer);

              writer.next({ name }); // buffered for replay!
              writer.complete();

              // internal observable actually loads into memory now!
              await observable.forEach(resp => {
                expect(observable.grpcCancel).toBeFalsy();
                expect(grpcAPI.cancelCache.size).toBe(0);
                expect(resp).toEqual({ message: reply(name) });
              });
              expect(grpcAPI.cancelCache.size).toBe(0);
              writer.unsubscribe();
            });

            it('Subject - post streaming', async () => {
              const name = 'Subject';
              const writer = new Subject();
              const observable = conn.streamSayHelloRx(writer);

              const promise = observable
                .forEach(resp => {
                  expect(resp).toEqual({ message: reply(name) });
                })
                .then(() => {
                  writer.unsubscribe();
                  return undefined;
                });

              expect(observable.grpcCancel).toBeTruthy();
              expect(grpcAPI.cancelCache.size).toBe(1);
              // ok we're now subscribed
              writer.next({ name });
              writer.complete();

              expect(grpcAPI.cancelCache.size).toBe(0);

              return promise;
            });

            it('streamish - of', async () => {
              const name = 'of';
              await conn.streamSayHelloRx(of({ name })).forEach(resp => {
                expect(grpcAPI.cancelCache.size).toBe(0);
                expect(resp).toEqual({ message: reply(name) });
              });
            });
          });
        });
      });
    });
  });
}
