const grpc = require('@grpc/grpc-js');
const { Server, ServerCredentials } = grpc;

const initServer = initService => ({ uri, grpcAPI, serviceName }) => {
  const server = new Server();
  const GrpcService = grpcAPI[serviceName];

  server.addService(GrpcService.service, initService());

  // Create a promise that resolves when the server is ready
  const ready = new Promise((resolve, reject) => {
    server.bindAsync(uri, ServerCredentials.createInsecure(), (err, _port) => {
      if (err) {
        console.error('Failed to bind server:', err);
        reject(err);
        return;
      }
      resolve();
    });
  });

  return {
    server,
    GrpcService,
    ready
  };
};

module.exports = { initServer };
