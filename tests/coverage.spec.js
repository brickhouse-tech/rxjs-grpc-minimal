/**
 * Additional tests to improve code coverage for edge cases and error paths
 */
const { Subject, throwError } = require('rxjs');

const { loadProto, grpc } = require('./utils/loadProto');
const getProtoPath = require('./utils/getProtoPath');
const { toRxClient, toRxServer } = require('../src');
const { getServiceNames } = require('../src/utils');

const protPath = getProtoPath(__dirname)(
  '../examples/helloworld/helloworld.proto'
);
let portCounter = 58000;

describe('coverage: edge cases', () => {
  describe('utils/getServiceNames', () => {
    it('handles objects that throw when accessing .service', () => {
      const grpcAPI = {
        ValidService: { service: {} },
        get ThrowingProp() {
          throw new Error('Cannot access');
        }
      };
      
      const names = getServiceNames(grpcAPI);
      expect(names).toContain('ValidService');
      expect(names).not.toContain('ThrowingProp');
    });
  });

  describe('server error handling', () => {
    let grpcAPI, server, conn, URI;

    beforeEach(async () => {
      URI = `127.0.0.1:${portCounter++}`;
      grpcAPI = loadProto(protPath, 'helloworld');
      toRxClient(grpcAPI);

      // Create a mock service that returns errors
      const errorService = {
        sayHello() {
          return throwError(() => new Error('Server error'));
        },
        streamSayHello() {
          return throwError(() => new Error('Stream error'));
        },
        sayMultiHello() {
          return throwError(() => new Error('Multi hello error'));
        }
      };

      server = new grpc.Server();
      server.addService(
        grpcAPI.Greeter.service,
        toRxServer(grpcAPI.Greeter, errorService, 'Greeter')
      );

      await new Promise((resolve, reject) => {
        server.bindAsync(URI, grpc.ServerCredentials.createInsecure(), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      conn = new grpcAPI.Greeter(URI, grpc.credentials.createInsecure());
    });

    afterEach(() => {
      if (conn) conn.close();
      if (server) server.forceShutdown();
    });

    it('handles server error in non-stream response via callback', () => {
      return new Promise((resolve, reject) => {
        conn.sayHelloRx({ name: 'Test' }).subscribe({
          next: () => reject(new Error('Should not have next')),
          error: (err) => {
            expect(err).toBeTruthy();
            resolve();
          },
          complete: () => reject(new Error('Should not complete'))
        });
      });
    });

    it('handles server error in streamed request to non-stream response', () => {
      return new Promise((resolve, reject) => {
        // streamSayHello is request-stream, reply-unary
        // Server throws, which should propagate to client
        const writer = new Subject();
        conn.streamSayHelloRx(writer).subscribe({
          next: () => reject(new Error('Should not have next')),
          error: (err) => {
            expect(err).toBeTruthy();
            resolve();
          },
          complete: () => reject(new Error('Should not complete'))
        });
        writer.next({ name: 'Test' });
        writer.complete();
      });
    });
  });

  describe('client request stream error handling', () => {
    let grpcAPI, server, conn, URI;

    beforeEach(async () => {
      URI = `127.0.0.1:${portCounter++}`;
      grpcAPI = loadProto(protPath, 'helloworld');
      toRxClient(grpcAPI);

      // Create a normal working service for request stream tests
      const { of, Observable } = require('rxjs');
      const workingService = {
        sayHello({ value: { name } }) {
          return of({ message: `Hello ${name}!` });
        },
        streamSayHello(observable) {
          return new Observable(observer => {
            observable.forEach(val => {
              observer.next({ message: `Hello ${val.name}!` });
            }).then(
              () => observer.complete(),
              err => observer.error(err)
            );
          });
        },
        sayMultiHello() {
          return of({ message: 'Hello!' });
        }
      };

      server = new grpc.Server();
      server.addService(
        grpcAPI.Greeter.service,
        toRxServer(grpcAPI.Greeter, workingService, 'Greeter')
      );

      await new Promise((resolve, reject) => {
        server.bindAsync(URI, grpc.ServerCredentials.createInsecure(), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      conn = new grpcAPI.Greeter(URI, grpc.credentials.createInsecure());
    });

    afterEach(() => {
      if (conn) conn.close();
      if (server) server.forceShutdown();
    });

    it('handles error from client request stream observable', () => {
      return new Promise((resolve, reject) => {
        const writer = new Subject();
        const observable = conn.streamSayHelloRx(writer);

        observable.subscribe({
          next: () => {},
          error: (err) => {
            expect(err).toBeTruthy();
            resolve();
          },
          complete: () => reject(new Error('Should not complete normally'))
        });

        // Emit an error from the request stream
        writer.error(new Error('Client stream error'));
      });
    });

    it('handles non-observable argument to request stream method', () => {
      return new Promise((resolve, reject) => {
        // Pass a non-observable (invalid argument)
        const observable = conn.streamSayHelloRx('not an observable');

        observable.subscribe({
          next: () => reject(new Error('Should not have next')),
          error: (err) => {
            expect(err.message).toContain('Observable required');
            resolve();
          },
          complete: () => reject(new Error('Should not complete'))
        });
      });
    });
  });

  describe('client non-function properties', () => {
    it('skips non-function prototype properties', () => {
      const grpcAPI = loadProto(protPath, 'helloworld');
      
      // Add a non-function property to the prototype
      grpcAPI.Greeter.prototype.someProperty = 'not a function';
      
      // This should not throw and should skip the property
      toRxClient(grpcAPI);
      
      // The property should still exist but no Rx version created
      expect(grpcAPI.Greeter.prototype.someProperty).toBe('not a function');
      expect(grpcAPI.Greeter.prototype.somePropertyRx).toBeUndefined();
    });
  });

  describe('server requestStream cancellation', () => {
    let grpcAPI, server, conn, URI;

    beforeEach(async () => {
      URI = `127.0.0.1:${portCounter++}`;
      grpcAPI = loadProto(protPath, 'helloworld');
      toRxClient(grpcAPI);

      // Create service that waits for cancellation
      const { of, Observable } = require('rxjs');
      const slowService = {
        sayHello({ value: { name } }) {
          return of({ message: `Hello ${name}!` });
        },
        streamSayHello(observable) {
          return new Observable(observer => {
            let completed = false;
            observable.subscribe({
              next: val => {
                if (!completed) {
                  observer.next({ message: `Hello ${val.name}!` });
                }
              },
              error: err => {
                if (!completed) {
                  observer.error(err);
                }
              },
              complete: () => {
                completed = true;
                observer.complete();
              }
            });
          });
        },
        sayMultiHello() {
          return of({ message: 'Hello!' });
        }
      };

      server = new grpc.Server();
      server.addService(
        grpcAPI.Greeter.service,
        toRxServer(grpcAPI.Greeter, slowService, 'Greeter')
      );

      await new Promise((resolve, reject) => {
        server.bindAsync(URI, grpc.ServerCredentials.createInsecure(), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      conn = new grpcAPI.Greeter(URI, grpc.credentials.createInsecure());
    });

    afterEach(() => {
      if (conn) conn.close();
      if (server) server.forceShutdown();
    });

    it('handles server shutdown during request stream (cancelled state)', () => {
      return new Promise((resolve) => {
        const writer = new Subject();
        const observable = conn.streamSayHelloRx(writer);

        observable.subscribe({
          next: () => {},
          error: () => {
            // Error is expected when server shuts down
            resolve();
          },
          complete: () => {
            resolve();
          }
        });

        // Send a message then force shutdown
        writer.next({ name: 'Test' });
        
        // Force shutdown triggers cancelled state
        setTimeout(() => {
          server.forceShutdown();
          writer.complete();
        }, 50);
      });
    });
  });

  describe('server onError in requestStream', () => {
    let grpcAPI, server, conn, URI;

    beforeEach(async () => {
      URI = `127.0.0.1:${portCounter++}`;
      grpcAPI = loadProto(protPath, 'helloworld');
      toRxClient(grpcAPI);

      // Service that doesn't handle errors specially
      const { of, Observable } = require('rxjs');
      const basicService = {
        sayHello({ value: { name } }) {
          return of({ message: `Hello ${name}!` });
        },
        streamSayHello(observable) {
          return new Observable(observer => {
            observable.subscribe({
              next: val => observer.next({ message: `Hello ${val.name}!` }),
              error: err => observer.error(err),
              complete: () => observer.complete()
            });
          });
        },
        sayMultiHello() {
          return of({ message: 'Hello!' });
        }
      };

      server = new grpc.Server();
      server.addService(
        grpcAPI.Greeter.service,
        toRxServer(grpcAPI.Greeter, basicService, 'Greeter')
      );

      await new Promise((resolve, reject) => {
        server.bindAsync(URI, grpc.ServerCredentials.createInsecure(), (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      conn = new grpcAPI.Greeter(URI, grpc.credentials.createInsecure());
    });

    afterEach(() => {
      if (conn) conn.close();
      if (server) server.forceShutdown();
    });

    it('handles successful stream completion', () => {
      return new Promise((resolve, reject) => {
        const writer = new Subject();
        const observable = conn.streamSayHelloRx(writer);
        let gotResponse = false;

        observable.subscribe({
          next: (resp) => {
            expect(resp.message).toBe('Hello Test!');
            gotResponse = true;
          },
          error: (err) => {
            reject(err);
          },
          complete: () => {
            expect(gotResponse).toBe(true);
            resolve();
          }
        });

        // Send message and complete
        writer.next({ name: 'Test' });
        writer.complete();
      });
    });
  });
});
