const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

/**
 * Load a proto file and return grpc API compatible with rxjs-grpc-minimal
 * @param {string} protoPath - Path to the .proto file
 * @param {string} packageName - Name of the package in the proto file
 * @returns {Object} grpc API object
 */
function loadProto(protoPath, packageName) {
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });
  const grpcAPI = grpc.loadPackageDefinition(packageDefinition);
  return grpcAPI[packageName];
}

module.exports = { loadProto, grpc };
