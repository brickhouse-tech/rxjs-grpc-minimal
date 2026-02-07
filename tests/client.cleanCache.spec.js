const { once } = require('lodash');

const { loadProto, grpc } = require('./utils/loadProto');
const getProtoPath = require('./utils/getProtoPath');
const serverRx = require('../examples/helloworld/impls/serverRx');
const { toRxClient } = require('../src');

const protPath = getProtoPath(__dirname)(
  '../examples/helloworld/helloworld.proto'
);
let portCounter = 58000;

describe('client.cancelCache', () => {
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
    });

    afterEach(() => {
      if (conn) {
        try { conn.close(); } catch (_e) { /* ignore */ }
      }
      if (initServerPayload && initServerPayload.server) {
        initServerPayload.server.forceShutdown();
      }
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

      it('queueing many calls holds connection', () => {
        return new Promise((resolve, reject) => {
          const { impl } = initServerPayload;
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
            }
          });
        });
      });
    });
  });
});
