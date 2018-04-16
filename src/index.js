require('babel-polyfill')

const cloudFactory = require('./factory')
const templates = require('./templates')

module.exports = {
  templates: Object.keys(templates),
  factory: function (cloudName, options) {
    const provider = cloudFactory(cloudName, options)
    provider.templates = {}
    for (const key of Object.keys(templates)) {
      if (typeof templates[key] === 'function') {
        provider.templates[key] = templates[key].bind(null, provider)
      }
    }
    return provider
  }
}
