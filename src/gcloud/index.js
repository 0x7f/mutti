const googleCompute = require('@google-cloud/compute')
const uuid = require('uuid')
const fs = require('fs')

let compute, logger, project, zoneName, regionName
function init ({ logger: log, project: projectId, credentials: credentialsPath, region, zone } = {}) {
  let credentials
  if (typeof credentialsPath === 'string' && fs.existsSync(credentialsPath)) {
    credentials = JSON.parse(fs.readFileSync(credentialsPath))
    compute = googleCompute({ credentials, projectId })
  } else {
    compute = googleCompute()
  }
  project = projectId
  if (credentials && !project) {
    project = credentials.project_id
  }
  zoneName = zone || 'us-central1-f'
  regionName = region || 'us-central1'
  logger = log
}

function startWorker ({
  zone: zoneName,
  region,
  project,
  machineType,
  diskImage: sourceImage,
  diskSize: diskSizeGb,
  gpuCount,
  gpuType,
  startupScript
} = {}) {
  return new Promise((resolve, reject) => {
    const zone = compute.zone(zoneName)
    const machineId = uuid.v4().substr(0, 8)
    const name = `encoding-machine-${machineId}`
    const diskName = `encoding-disk-${machineId}`
    const options = {
      cpuPlatform: 'Intel Sandy Bridge',
      machineType: `zones/${zoneName}/machineTypes/${machineType}`,
      name,
      disks: [{
        autoDelete: true,
        boot: true,
        initializeParams: {
          diskName,
          diskSizeGb,
          sourceImage
        }
      }],
      http: true,
      https: true,
      networkInterfaces: [{
        network: `projects/${project}/global/networks/default`,
        subnetwork: `projects/${project}/regions/${region}/subnetworks/default`,
        accessConfigs: [{
          name: 'External NAT',
          type: 'ONE_TO_ONE_NAT'
        }]
      }],
      metadata: {
        items: [{
          key: 'startup-script',
          value: startupScript
        }]
      }
    }

    if (gpuCount > 0) {
      // TODO: check whether startup script installs the gpu drivers!
      options.guestAccelerators = [{
        acceleratorType: `https://www.googleapis.com/compute/beta/projects/${project}/zones/${zoneName}/acceleratorTypes/${gpuType}`,
        acceleratorCount: gpuCount
      }]
      // these settings must be set when attaching gpus to a machine
      options.scheduling = {
        preemptible: false,
        onHostMaintenance: 'TERMINATE',
        automaticRestart: true
      }
    }

    logger.debug({
      name,
      options,
      zone: zoneName
    }, 'Creating VM')
    zone.createVM(name, options, (err, vm, operation) => {
      if (err) {
        logger.error({err}, 'Error while creating VM')
        reject(err)
        return
      }

      operation.on('error', (operationErr) => {
        logger.error({err: operationErr}, 'Error while setting up the VM')
        return reject(operationErr)
      })

      operation.on('running', (metadata) => {
        logger.debug({
          name,
          metadata
        }, 'New VM running')
      })

      operation.on('complete', () => {
        logger.info({name}, 'VM created successfully')
        return resolve(name)
      })
    })
  })
}

function stopWorker ({
  zone: zoneName,
  instanceId: vmName
}) {
  return new Promise((resolve, reject) => {
    const zone = compute.zone(zoneName)
    const vm = zone.vm(vmName)

    vm.stop((err, operation, apiResponse) => {
      if (err) {
        return reject(err)
      }

      operation.on('error', (operationErr) => {
        logger.error({err: operationErr, vmName}, 'Error while stopping the VM')
        return reject(operationErr)
      })

      operation.on('complete', () => {
        logger.info({vmName}, 'Successfully stopped the VM')
        return resolve()
      })
    })
  })
}

function deleteWorker ({
  zone: zoneName,
  instanceId: vmName
}) {
  return new Promise((resolve, reject) => {
    const zone = compute.zone(zoneName)
    const vm = zone.vm(vmName)

    vm.delete((err, operation, apiResponse) => {
      if (err) return reject(err)

      operation.on('error', (operationErr) => {
        logger.error({err: operationErr, vmName}, 'Error while deleting the VM')
        return reject(operationErr)
      })

      operation.on('complete', () => {
        logger.info({vmName}, 'Successfully delete the VM')
        return resolve()
      })
    })
  })
}

function describeWorker ({ zone: zoneName, instanceId }) {
  const zone = compute.zone(zoneName)
  const vm = zone.vm(instanceId)
  return vm.getMetadata()
}

async function createImageFromWorker ({ zone: zoneName, instanceId, imageName }) {
  return new Promise((resolve, reject) => {
    const zone = compute.zone(zoneName)
    const vm = zone.vm(instanceId)
    vm.getMetadata((err, meta) => {
      if (err) return reject(err)

      logger.debug({meta}, 'Instance metadata')
      if (!meta) {
        return reject(new Error(`The instance: ${instanceId} was not found`))
      }
      if (!meta.disks || meta.disks.length === 0) {
        return reject(new Error(`The instance: ${instanceId} does not have any disk attached`))
      }

      if (meta.disks.length > 1) {
        return reject(new Error(`The instance: ${instanceId} has multiple disks: ${JSON.stringify(meta.disks)}`))
      }

      const firstDisk = meta.disks[0]
      const diskName = firstDisk.source.substr(firstDisk.source.lastIndexOf('/') + 1)
      const disk = zone.disk(diskName)
      compute.createImage(imageName, disk, (err, image, operation) => {
        if (err) return reject(err)

        operation.on('error', (operationErr) => {
          logger.error({err: operationErr, imageName}, 'Error while creating the Image')
          return reject(operationErr)
        })

        operation.on('complete', () => {
          logger.info({imageName}, 'Successfully stopped the Image')
          const targetLink = operation &&
            operation.metadata &&
            operation.metadata.targetLink
          return resolve(targetLink)
        })
      })
    })
  })
}

async function getPublicDNSForInstance ({ zone: zoneName, instanceId }) {
  const description = await describeWorker({
    zone: zoneName,
    instanceId
  })
  return description[0] &&
    description[0].networkInterfaces[0] &&
    description[0].networkInterfaces[0].accessConfigs[0].natIP
}

module.exports = {
  init,
  createInstance: ({ startupScript, imageId, machineType, diskSize } = {}) =>
    startWorker({
      startupScript,
      diskImage: imageId,
      zone: zoneName,
      region: regionName,
      project,
      machineType,
      diskSize
    }),
  stopInstance: instanceId =>
    stopWorker({
      zone: zoneName,
      instanceId
    }),
  deleteInstance: instanceId =>
    deleteWorker({
      zone: zoneName,
      instanceId
    }),
  createImage: (instanceId, imageName) =>
    createImageFromWorker({
      zone: zoneName,
      instanceId,
      imageName
    }),
  describeInstance: instanceId =>
    describeWorker({
      zone: zoneName,
      instanceId
    }),
  getPublicInstanceAddress: (instanceId) =>
    getPublicDNSForInstance({
      zone: zoneName,
      instanceId
    }),
  describeImage: () => {}
}
