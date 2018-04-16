const docker = require('./docker')
const aws = require('./aws')
const gcloud = require('./gcloud')

function create (cloudProviderId) {
  switch (cloudProviderId) {
    case 'aws':
      return aws
    case 'docker':
      return docker
    case 'gcloud':
      return gcloud
    default:
      console.error('Factory: unknown cloud provider', cloudProviderId)
      return null
  }
}

module.exports = (cloudProviderId, ...args) => {
  const provider = create(cloudProviderId)
  provider.init(args[0])
  return provider
}
