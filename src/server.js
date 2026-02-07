const { of, Observable } = require('rxjs');
const through2 = require('through2');

const debug = require('../debug').spawn('server');

class CanceledError extends Error {}

function create(Service, rxImpl, serviceName) {
  const service = {};
  const dbg = serviceName ? debug.spawn(serviceName) : debug;
  for (const name in Service.prototype) {
    if (typeof rxImpl[name] === 'function') {
      service[name] = createMethod(
        rxImpl,
        name,
        Service.prototype,
        dbg.spawn(name)
      );
    }
  }
  return service;
}

function createMethod(rxImpl, name, methods, dbg) {
  const serviceMethod = methods[name];
  return async function (call, callback) {
    dbg(() => 'called');
    // SET SYNC REQUEST OBSERVER
    // Create an observable that also has .value for backward compat
    let observable = of(call.request);
    observable.value = call.request;

    if (serviceMethod.requestStream) {
      observable = createRequestStream({ call, name, dbg });
    }
    /*
      Consider replacing the second arg with another observable
      where error is cancel and the root observable has meta
    */
    const response = rxImpl[name](observable, call);
    if (serviceMethod.responseStream) {
      dbg(() => 'responseStream');
      try {
        await response.forEach(data => call.write(data));
      } finally {
        call.end();
      }
    } else {
      response.subscribe(
        data => callback(null, data),
        error => callback(error)
      );
    }
  };
}

function createRequestStream({ call, name, dbg }) {
  dbg(() => 'requestStream');
  return new Observable(observer => {
    call.pipe(through2.obj(onData, onEnd));
    call.on('error', onError);

    function onError(err) {
      // Skip if observer is already closed (e.g., during server shutdown)
      if (!observer.closed) {
        observer.error(err);
      }
    }

    function onData(data, _, cb) {
      observer.next(data);
      cb();
    }

    function onEnd(cb) {
      // Capture cancelled state NOW, before setImmediate
      // (forceShutdown() may set call.cancelled between now and the callback)
      const wasCancelled = call.cancelled;

      setImmediate(() => {
        // Skip if observer is already closed (e.g., during server shutdown)
        // to avoid unhandled rejection errors
        if (observer.closed) {
          return;
        }
        if (wasCancelled) {
          /*
          TODO: DEBATING ON WHETHER THIS SHOULD BE AN ERROR OBJECT
          We're using error event here to signal cancellation.
          which is not is not really an error; its an additional state.
          It would be nice to have
          observer.cancelled(SomeObject|String);

          I would love to hear other ideas.

          NOTE: grpc-node emits cancel errors so I guess we should follow this.
          */
          observer.error(new CanceledError(`Call to "${name}" cancelled.`));
        } else {
          observer.complete();
        }
      });
      call.removeListener('error', onError);
      cb();
    }
  });
}

module.exports = {
  create,
  createMethod,
  errors: {
    CanceledError
  }
};
