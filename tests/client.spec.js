const { take, delay: rxjsDelay } = require('rxjs/operators');
const { once } = require('lodash');

const { loadProto, grpc } = require('./utils/loadProto');
const getProtoPath = require('./utils/getProtoPath');
const serverRx = require('../examples/helloworld/impls/serverRx');
const { toRxClient } = require('../src');

const protPath = getProtoPath(__dirname)(
  '../examples/helloworld/helloworld.proto'
);
let portCounter = 57000;
const debug = require('../debug').spawn('test:client');

describe('client', () => {
  let grpcAPI, initServerPayload, conn, URI;

  describe('grpc client', () => {
    beforeEach(async () => {
      URI = `127.0.0.1:${portCounter++}`;
      grpcAPI = loadProto(protPath, 'helloworld');
      toRxClient(grpcAPI);

      initServerPayload = serverRx.initServer({
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

      // Simple spy implementation
      const orig = conn.sayMultiHelloRx;
      conn.sayMultiHelloRx = function (...args) {
        conn.sayMultiHelloRx.calls = (conn.sayMultiHelloRx.calls || 0) + 1;
        return orig.apply(this, args);
      };
      conn.sayMultiHelloRx.calls = 0;
    });

    afterEach(() => {
      // Cleanup handled in individual tests that manage their own cleanup timing
    });

    describe('stream reply', () => {
      let name;

      function makeCall(doComplete = true, expectedCalls = 2, delayMs) {
        name = 'Brody';

        return conn.sayMultiHelloRx({
          name,
          numGreetings: expectedCalls,
          doComplete,
          delayMs
        });
      }

      it('rxWrapper is called once', () => {
        const { server } = initServerPayload;
        makeCall();
        expect(conn.sayMultiHelloRx.calls).toBe(1);
        conn.close();
        server.forceShutdown();
      });

      it('queueing many calls holds connection', () => {
        return new Promise((resolve, reject) => {
          const { impl, server } = initServerPayload;
          const callObs = makeCall(false);
          callObs.subscribe({
            next: once(() => {
              expect(impl.sayMultiHello.holdingObservers.size).toBe(1);
              for (const cancel of grpcAPI.cancelCache) {
                cancel();
              }
            }),
            error: maybeError => {
              setTimeout(() => {
                if (maybeError.details === 'Cancelled on client') {
                  expect(impl.sayMultiHello.holdingObservers.size).toBe(0);
                  expect(grpcAPI.cancelCache.size).toBe(0);
                  resolve();
                  return;
                }
                reject(maybeError);
              }, 50);
              conn.close();
              server.forceShutdown();
            }
          });
        });
      });

      describe('unsubscribe serverside', () => {
        it('queueing many calls and unsubscribe early', () => {
          return new Promise((resolve, reject) => {
            const { impl, server } = initServerPayload;
            let nextCalls = 0;
            const delayMs = 100;
            const expectedCalls = 2;

            const callObs = makeCall(false, 10, delayMs);

            const ret = callObs.subscribe({
              next: () => {
                debug(() => `called ${nextCalls}`);
                expect(impl.sayMultiHello.holdingObservers.size).toBe(1);
                nextCalls++;
              },
              error: maybeError => {
                reject(maybeError);
              },
              complete: () => {
                // we should unsub before getting a completion
                reject(new Error('should not complete'));
              }
            });

            // wait an amount of time to get some expected calls
            setTimeout(() => {
              ret.unsubscribe();
              debug(() => 'unsubscribed !!!!!!!!!!!!!!!!!');

              expect(nextCalls).not.toBe(10);
              expect(nextCalls).toBe(expectedCalls);
              setTimeout(() => {
                expect(impl.sayMultiHello.holdingObservers.size).toBe(0);
                expect(grpcAPI.cancelCache.size).toBe(0);
                resolve();
              }, 20);

              conn.close();
              server.forceShutdown();
            }, delayMs * expectedCalls + 20);
          });
        });
      });

      /**
       * A streaming response that is ended early using take(1), takeUntil(), etc.
       * Must also stop the incoming stream from GRPC or it will leak.
       * RXJS operators like take(), takeUntil, etc. call complete() then unsubscribe().
       * Users can also unsubscribe() directly in which case the complete() method
       * will never run.
       */
      describe('unsubscribe from responseStream', () => {
        it('via take operator', () => {
          return new Promise((resolve, reject) => {
            const { impl, server } = initServerPayload;
            const callObs = makeCall(false, 10);

            let nextCalls = 0;
            const expectedCalls = 2;

            callObs.pipe(take(expectedCalls)).subscribe({
              next: () => {
                expect(impl.sayMultiHello.holdingObservers.size).toBe(1);
                nextCalls++;
              },
              error: maybeError => {
                reject(maybeError);
              },
              complete: () => {
                setTimeout(() => {
                  expect(nextCalls).toBe(expectedCalls);
                  expect(impl.sayMultiHello.holdingObservers.size).toBe(0);
                  // This next line is key, if stream is still open cancelCache will have length.
                  // Checking its 0 ensures we've closed stream for good.
                  expect(grpcAPI.cancelCache.size).toBe(0);
                  resolve();
                }, 50);
                conn.close();
                server.forceShutdown();
              }
            });
          });
        });

        it('manually', () => {
          return new Promise((resolve, reject) => {
            const { impl, server } = initServerPayload;
            const callObs = makeCall(false, 10);

            let nextCalls = 0;
            const expectedCalls = 4;

            const ret = callObs.subscribe({
              next: () => {
                expect(impl.sayMultiHello.holdingObservers.size).toBe(1);
                nextCalls++;
                if (nextCalls === expectedCalls) {
                  ret.unsubscribe();
                }
                if (nextCalls > expectedCalls) {
                  throw new Error('Too many next calls');
                }
              },
              error: maybeError => {
                reject(maybeError);
              },
              complete: () => {
                reject(new Error('Unsubscribe should not run complete'));
              }
            });
            // add RXJS teardown logic called on unsubscribe
            ret.add(() => {
              conn.close();
              server.forceShutdown();
              setTimeout(() => {
                expect(nextCalls).toBe(expectedCalls);
                expect(impl.sayMultiHello.holdingObservers.size).toBe(0);
                expect(grpcAPI.cancelCache.size).toBe(0);
                resolve();
              }, 50); // give test connection time to shut down
            });
          });
        });

        it('manually after delay so all responseStreams have come in', () => {
          return new Promise((resolve, reject) => {
            const { impl, server } = initServerPayload;
            const callObs = makeCall(false, 10);

            let nextCalls = 0;
            const delay = 100;
            const expectedCalls = 4;

            const ret = callObs.pipe(rxjsDelay(delay)).subscribe({
              next: () => {
                expect(impl.sayMultiHello.holdingObservers.size).toBe(1);
                nextCalls++;
                if (nextCalls === expectedCalls) {
                  ret.unsubscribe();
                }
                if (nextCalls > expectedCalls) {
                  throw new Error('Too many next calls');
                }
              },
              error: maybeError => {
                reject(maybeError);
              },
              complete: () => {
                reject(new Error('Unsubscribe should not run complete'));
              }
            });
            // add RXJS teardown logic called on unsubscribe
            ret.add(() => {
              conn.close();
              server.forceShutdown();
              setTimeout(() => {
                expect(nextCalls).toBe(expectedCalls);
                expect(impl.sayMultiHello.holdingObservers.size).toBe(0);
                expect(grpcAPI.cancelCache.size).toBe(0);
                resolve();
              }, 50); // give test connection time to shut down
            });
          });
        });
      });
    });
  });
});
