const fetch = require('node-fetch')

function sleep (sleepInSec) {
  return new Promise(resolve =>
    setTimeout(resolve, sleepInSec * 1000))
}

async function createInstanceAndImage (provider, { image: baseImageId, imageName, startupScript, keyName, machineType, diskSize, logger } = {}) {
  if (!startupScript) {
    throw new Error('Startup script is missing. The action will never return without HTTP signaling')
  }

  if (!imageName) {
    throw new Error('Target image name is missing.')
  }
  const instanceId = await provider.createInstance({ startupScript, imageId: baseImageId, keyName, machineType, diskSize })
  logger.info({instanceId}, `Created instance with id: ${instanceId}`)

  let publicUrl = null
  const publicUrlRetries = 10
  for (let i = 0; i < publicUrlRetries; ++i) {
    publicUrl = await provider.getPublicInstanceAddress(instanceId)
    if (publicUrl) {
      break
    }
    logger.info({ instanceId }, 'No public url available yet. retrying.')
    await sleep(5)
  }
  if (!publicUrl) {
    logger.error({ instanceId }, 'Unable to get public url for instance.')
    throw new Error('Unable to get public url for instance.')
  }
  const body = await waitForConnectivity(publicUrl, { logger })
  if (!body) {
    return null
  }

  await provider.stopInstance(instanceId, { awaitShutdown: true })

  const imageId = await provider.createImage(instanceId, imageName)
  logger.info({ imageId }, `Created image with id: ${imageId}`)

  await provider.deleteInstance(instanceId)

  return imageId
}

async function waitForConnectivity (publicUrl, { port = 80, timeoutInSec = 3000, pollFrequencyInSec = 10, logger } = {}) {
  return new Promise(async (resolve, reject) => {
    if (!publicUrl) {
      return reject(new Error('Wait for connectivity is missing public URL'))
    }
    logger.info({ publicUrl }, `Connecting to: ${publicUrl}`)
    const isConditionMet = async (timeout) => {
      try {
        const output = await fetch(
          `http://${publicUrl}`,
          { timeout: timeout * 1000 }
        )
        const body = await output.text()
        return body
      } catch (error) {
        if (error.type === 'request-timeout') {
          return null
        } else if (error.code === 'ECONNREFUSED') {
          await sleep(timeout) // function always consumes the reserved timeout
          return null
        }
        logger.error({ error }, 'Unkown error during fetch')
        return undefined
      }
    }

    let accumulatedTime = 0
    while (accumulatedTime < timeoutInSec) {
      const body = await isConditionMet(pollFrequencyInSec)
      if (body !== null && body !== undefined) {
        return resolve(body)
      }
      logger.debug(`Waiting for connectivity ... (${accumulatedTime}sec)`)
      accumulatedTime += pollFrequencyInSec
    }
    return resolve(null)
  })
}

module.exports = {
  createInstanceAndImage
}
