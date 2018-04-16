const bunyan = require('bunyan')

module.exports = function createLogger ({ level, name }) {
  const loggerOptions = {
    level,
    name,
    serializers: bunyan.stdSerializers,
    streams: [{
      level,
      stream: process.stdout
    }]
  }
  return bunyan.createLogger(loggerOptions)
}
