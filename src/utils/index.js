function getServiceNames(grpcApi) {
  const keys = Object.keys(grpcApi);
  const serviceNames = keys.filter(name => {
    try {
      return Boolean(grpcApi[name].service);
    } catch (_e) {
      return false;
    }
  });

  return serviceNames;
}

module.exports = {
  getServiceNames
};
