[![tests](https://github.com/brickhouse-tech/rxjs-grpc-minimal/actions/workflows/tests.yml/badge.svg)](https://github.com/brickhouse-tech/rxjs-grpc-minimal/actions/workflows/tests.yml)
[![npm version](https://badge.fury.io/js/rxjs-grpc-minimal.svg)](https://badge.fury.io/js/rxjs-grpc-minimal)

# rxjs-grpc-minimal

Based off the great work of [rxjs-grpc](https://github.com/kondi/rxjs-grpc). This library wraps gRPC server and client implementations with RxJS Observables, giving you a reactive interface without imposing opinions on your setup.

There is no CLI—this library stays out of the way and lets `@grpc/grpc-js` and `@grpc/proto-loader` do what they do best.

## Requirements

- Node.js >= 20
- RxJS 7.x
- @grpc/grpc-js (replaces deprecated `grpc` package)

## Install

```bash
npm install rxjs-grpc-minimal
# or
yarn add rxjs-grpc-minimal
```

You'll also need gRPC dependencies:

```bash
npm install @grpc/grpc-js @grpc/proto-loader
```

## Usage

### Loading Proto Files

Use `@grpc/proto-loader` with `@grpc/grpc-js` (the modern approach):

```js
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { toRxClient } from 'rxjs-grpc-minimal';

// Load proto file
const packageDefinition = protoLoader.loadSync('./helloworld.proto', {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const grpcAPI = grpc.loadPackageDefinition(packageDefinition);
const helloworldAPI = toRxClient(grpcAPI.helloworld);
```

### Client

```js
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { toRxClient } from 'rxjs-grpc-minimal';

// Load and wrap the API
const packageDefinition = protoLoader.loadSync('./helloworld.proto', {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const grpcAPI = toRxClient(
  grpc.loadPackageDefinition(packageDefinition).helloworld
);

// Create client connection
const greeter = new grpcAPI.Greeter(
  'localhost:50051',
  grpc.credentials.createInsecure()
);

// Unary call - returns Observable
await greeter.sayHelloRx({ name: 'Bob' }).forEach(resp => {
  console.log(resp); // { message: 'Hello Bob!' }
});

// Server streaming - Observable emits each response
await greeter
  .sayMultiHelloRx({ name: 'World', numGreetings: 3 })
  .forEach(resp => {
    console.log(resp.message);
  });

// Client streaming - pass a Subject/Observable as the request
import { Subject } from 'rxjs';

const writer = new Subject();
const response$ = greeter.streamSayHelloRx(writer);

response$.forEach(resp => {
  console.log(resp.message);
});

// Send messages
writer.next({ name: 'Alice' });
writer.next({ name: 'Bob' });
writer.complete(); // Signal end of stream
```

### Cancellation

RxJS methods return Observables with a `grpcCancel()` function for early termination:

```js
const stream$ = greeter.sayMultiHelloRx({ name: 'World', numGreetings: 100 });

stream$.forEach(resp => {
  console.log(resp.message);
  if (someCondition) {
    stream$.grpcCancel(); // Cancel the underlying gRPC call
  }
});

// Clean up all pending calls before closing connection
grpcAPI.cancelCache.forEach(cancel => cancel());
greeter.close();
```

### Server

```js
import { of, Observable } from 'rxjs';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { toRxServer } from 'rxjs-grpc-minimal';

// Load proto
const packageDefinition = protoLoader.loadSync('./helloworld.proto', {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});
const proto = grpc.loadPackageDefinition(packageDefinition).helloworld;

// Define RxJS implementation
const rxImpl = {
  // Unary: return an Observable
  sayHello({ value: { name } }) {
    return of({ message: `Hello ${name}!` });
  },

  // Server streaming: return Observable that emits multiple values
  sayMultiHello({ value: { name, numGreetings } }) {
    return new Observable(observer => {
      for (let i = 0; i < numGreetings; i++) {
        observer.next({ message: `Hello ${name}!` });
      }
      observer.complete();
    });
  },

  // Client streaming: receive Observable, return Observable
  streamSayHello(requestStream$) {
    return new Observable(observer => {
      requestStream$.forEach(val => {
        observer.next({ message: `Hello ${val.name}!` });
      }).then(
        () => observer.complete(),
        err => observer.error(err)
      );
    });
  }
};

// Create and start server
const server = new grpc.Server();
server.addService(proto.Greeter.service, toRxServer(proto.Greeter, rxImpl, 'Greeter'));
server.bindAsync('0.0.0.0:50051', grpc.ServerCredentials.createInsecure(), () => {
  console.log('Server running on port 50051');
});
```

See [examples/helloworld/impls/serverRx.js](./examples/helloworld/impls/serverRx.js) for a complete example.

## API

### `toRxClient(grpcObject, methodExt = 'Rx')`

Wraps all service prototype methods with RxJS implementations.

- **grpcObject** - Object created by `grpc.loadPackageDefinition()`
- **methodExt** - String appended to method names (default: `'Rx'`)

```js
const api = toRxClient(grpcAPI);
greeter.sayHelloRx();    // RxJS Observable
greeter.sayHello();      // Original callback-based method

// Override original methods instead of extending:
const api = toRxClient(grpcAPI, '');
greeter.sayHello();      // Now returns Observable
```

Returns the modified `grpcObject` with a `cancelCache` Set for tracking active calls.

### `toRxServer(service, rxImpl, serviceName?)`

Wraps RxJS server handlers to work with gRPC.

- **service** - gRPC service definition (e.g., `proto.Greeter`)
- **rxImpl** - Object with method handlers returning Observables
- **serviceName** - Optional string for debug logging

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Lint code
npm run lint

# Fix lint issues
npm run lint:fix
```

### Running Examples

```bash
# Terminal 1: Start server
npm run server

# Terminal 2: Run client
npm run client
```

## Sponsor

If you find this project useful, consider [sponsoring @nmccready](https://github.com/sponsors/nmccready) to support ongoing maintenance and development. ❤️

## License

MIT
