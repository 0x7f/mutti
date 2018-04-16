const AWS = require('aws-sdk')

function sleep (sleepInSec) {
  return new Promise(resolve =>
    setTimeout(resolve, sleepInSec * 1000))
}

function toBase64 (str) {
  return Buffer.from(str).toString('base64')
}

function fromBase64 (buffer) {
  return Buffer.from(buffer, 'base64').toString()
}

let ec2, logger
function init ({ region, accessKey, secretKey, credentials, logger: log } = {}) {
  if (credentials) {
    AWS.config.loadFromPath(credentials)
  } else {
    AWS.config.update({
      region: region || 'us-west-2',
      credentials: accessKey && secretKey && {
        accessKeyId: accessKey,
        secretAccessKey: secretKey
      }
    })
  }
  logger = log
  ec2 = new AWS.EC2({
    apiVersion: '2016-11-15'
  })
}

function createInstance ({ startupScript, keyName, imageId, machineType, diskSize } = {}) {
  return new Promise((resolve, reject) => {
    const params = {
      ImageId: imageId,
      InstanceType: machineType,
      MinCount: 1,
      MaxCount: 1,
      UserData: startupScript && toBase64(startupScript),
      KeyName: keyName
    }
    if (diskSize) {
      params.BlockDeviceMappings = [{
        DeviceName: '/dev/sdb',
        Ebs: {
          DeleteOnTermination: true,
          Encrypted: false,
          VolumeSize: diskSize,
          VolumeType: 'gp2'
        }
      }]
    }
    ec2.runInstances(params, (error, data) => {
      if (error) {
        logger.error({error}, 'Could not create instance')
        return reject(error)
      }
      const instanceId = data.Instances[0].InstanceId
      return resolve(instanceId)
    })
  })
}

function startInstance (instanceId) {
  return new Promise((resolve, reject) => {
    const params = {
      InstanceIds: [instanceId]
    }
    ec2.startInstances(params, (error, data) => {
      if (error) {
        logger.error({error}, 'Error while starting the instance')
        return reject(error)
      } else if (!data) {
        const error = new Error(`No data for instance: ${instanceId}`)
        logger.error({error}, `No data returned for instance: ${instanceId}`)
        return reject(error)
      } else {
        return resolve(data.StartingInstances)
      }
    })
  })
}

function waitForInstanceState (instanceId, state, { timeoutInSec = 10000 } = {}) {
  return new Promise(async (resolve, reject) => {
    const sleepTimeInSec = 5
    for (let t = 0; t < timeoutInSec; t += sleepTimeInSec) {
      const description = await describeInstance(instanceId)
      const instance = description &&
        description.Reservations &&
        description.Reservations.length > 0 &&
        description.Reservations[0].Instances &&
        description.Reservations[0].Instances[0]
      if (instance && instance.State && instance.State.Name === state) {
        return resolve(description)
      } else {
        logger.debug({}, `Waiting for instance state: ${instance.State.Name}`)
      }
      await sleep(sleepTimeInSec)
    }
    return reject(new Error(`Timeout awaiting state: ${state} of instance: ${instanceId}`))
  })
}

function waitForImageState (imageId, state, { timeoutInSec = 10000 } = {}) {
  return new Promise(async (resolve, reject) => {
    const sleepTimeInSec = 5
    for (let t = 0; t < timeoutInSec; t += sleepTimeInSec) {
      const description = await describeImage(imageId)
      const image = description && description.Images && description.Images[0]
      if (image && image.ImageId === imageId && image.State === state) {
        return resolve(image)
      } else {
        logger.debug({}, `Waiting for image state: ${image && image.State}`)
      }
      await sleep(sleepTimeInSec)
    }
    return reject(new Error(`Timeout awaiting state: ${state} of image: ${imageId}`))
  })
}

function stopInstance (instanceId, { awaitShutdown = false } = {}) {
  return new Promise((resolve, reject) => {
    const params = {
      InstanceIds: [instanceId]
    }
    ec2.stopInstances(params, async (error, data) => {
      if (error) {
        logger.error({ error }, `Error while stopping instance ${instanceId}`)
        return reject(error)
      } else if (!data) {
        const error = new Error(`No data for given for instance: ${instanceId}`)
        logger.error({ error })
        return reject(error)
      } else {
        if (awaitShutdown) {
          await waitForInstanceState(instanceId, 'stopped')
        }
        return resolve(data)
      }
    })
  })
}

function tagInstance (instanceId, key, value) {
  return new Promise((resolve, reject) => {
    const tagParams = {
      Resources: [instanceId],
      Tags: [
        {
          Key: key,
          Value: value
        }
      ]
    }
    ec2.createTags(tagParams, error => {
      if (error) {
        return reject(error)
      }
      resolve()
    })
  })
}

function describeImage (imageId) {
  return new Promise((resolve, reject) => {
    const params = {
      ImageIds: [imageId]
    }
    ec2.describeImages(params, (error, imageList) => {
      if (error) {
        logger.error({ error }, `Error describing image with id: ${imageId}`)
        return reject(error)
      }
      return resolve(imageList)
    })
  })
}

function describeInstance (instanceId) {
  return new Promise((resolve, reject) => {
    const params = {
      InstanceIds: [instanceId]
    }

    ec2.describeInstances(params, function (error, data) {
      if (error) {
        logger.error({ error }, `Error describing instance with id: ${instanceId}`)
        return reject(error)
      }
      resolve(data)
    })
  })
}

function resetUserData (instanceId) {
  return new Promise((resolve, reject) => {
    const params = {
      InstanceId: instanceId,
      UserData: {
        Value: ''
      }
    }
    ec2.modifyInstanceAttribute(params, (error, data) => {
      if (error) {
        logger.error({ error }, 'Error resetting the user data')
        return reject(error)
      }
      resolve(data)
    })
  })
}

function rebootInstance (instanceId) {
  return new Promise((resolve, reject) => {
    const params = {
      InstanceIds: [instanceId]
    }
    ec2.rebootInstances(params, (error, data) => {
      if (error) {
        logger.error({ error }, `Error during reboot: ${error.stack}`)
        return reject(error)
      } else if (!data) {
        const error = new Error(`No data returned while rebooting instance: ${instanceId}`)
        logger.error(error, `No data returned while rebooting instance: ${instanceId}`)
        return reject(error)
      } else {
        logger.debug({instanceId}, `Rebooted successfully instance: ${instanceId}`)
        return resolve(data)
      }
    })
  })
}

function getConsoleOutput (instanceId) {
  return new Promise((resolve, reject) => {
    const params = {
      InstanceId: instanceId
    }
    ec2.getConsoleOutput(params, (error, data) => {
      if (error) {
        logger.error({ error }, `Error while retrieving console output for instance: ${instanceId}`)
        return reject(error)
      }
      if (!data.Output) {
        logger.info(`No output yet for instance: ${instanceId}`)
        return resolve()
      }
      return resolve(fromBase64(data.Output))
    })
  })
}

function importKeyPairRequest (keyName, publicKey) {
  return new Promise((resolve, reject) => {
    const params = {
      KeyName: keyName,
      PublicKeyMaterial: publicKey
    }
    ec2.importKeyPair(params, (error, result) => {
      if (error) {
        logger.error({ error }, `Could not import the key pair: ${keyName}`)
        return reject(error)
      }
      return resolve(result)
    })
  })
}

async function getPublicDNSForInstance (instanceId) {
  const description = await describeInstance(instanceId)
  return description &&
    description.Reservations[0] &&
    description.Reservations[0].Instances[0] &&
    description.Reservations[0].Instances[0].PublicDnsName
}

function createImage (instanceId, imageName, { description, bootBeforeCreation = false } = {}) {
  return new Promise(async (resolve, reject) => {
    const params = {
      InstanceId: instanceId,
      Name: imageName,
      Description: description,
      NoReboot: !bootBeforeCreation
    }
    ec2.createImage(params, (error, data) => {
      if (error) {
        logger.error({ error }, `Error creating image: ${imageName} from instance ${instanceId}: ${error.stack}`)
        return reject(error)
      }
      return resolve(data)
    })
  })
}

function deleteInstance (instanceId) {
  return new Promise((resolve, reject) => {
    const params = {
      InstanceIds: [instanceId]
    }
    ec2.terminateInstances(params, (error, data) => {
      if (error) {
        logger.error({ error }, `Error during termination of instance: ${instanceId}`)
      }
      logger.info({ instanceId }, `Successfully terminated instance: ${instanceId}`)
      return resolve(data)
    })
  })
}

async function createAndWaitForImage (instanceId, imageName, { awaitSignal = true, startupScript } = {}) {
  const image = await createImage(instanceId, imageName, { startupScript })
  if (awaitSignal) {
    await waitForImageState(image.ImageId, 'available')
  }
  return image.ImageId
}

module.exports = {
  init,
  createInstance,
  startInstance,
  stopInstance,
  rebootInstance,
  tagInstance,
  deleteInstance,
  createImage: createAndWaitForImage,
  describeInstance,
  describeImage,
  resetUserData,
  importKeyPairRequest,
  getPublicInstanceAddress: getPublicDNSForInstance,
  getConsoleOutput
}
