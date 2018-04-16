const Docker = require('dockerode')

function toBase64 (str) {
  return Buffer.from(str).toString('base64')
}

function exec (container, cmd, { verbose = false } = {}) {
  return new Promise(async (resolve, reject) => {
    const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStdErr: true })
    exec.start((error, stream) => {
      if (error) {
        return reject(error)
      }
      const output = []
      stream.on('data', data => {
        const msg = data.toString().substr(8) // TODO: why the offset?
        verbose && console.log(msg)
        output.push(msg)
      })
      stream.once('error', () => reject(error))
      stream.once('end', () => resolve(output.join('')))
    })
  })
}

async function createFile (container, content, absoluteFile) {
  const createCmd = `echo "${toBase64(content)}" >> ${absoluteFile}.tmp`
  await exec(container, ['/bin/bash', '-c', createCmd])
  const decodeCmd = `cat ${absoluteFile}.tmp | base64 --decode > ${absoluteFile}`
  await exec(container, ['/bin/bash', '-c', decodeCmd])
  const removeCmd = `rm ${absoluteFile}.tmp`
  return exec(container, ['/bin/bash', '-c', removeCmd])
}

async function getContainer (docker, instanceId) {
  const container = docker.getContainer(instanceId)
  const result = await container.inspect()
  if (result && result.Id === instanceId) {
    return container
  }
}

module.exports = {
  init: function () {
    this.docker = new Docker()
  },
  createInstance: async function ({ startupScript, imageId }) {
    const containerParams = {
      Image: imageId,
      Tty: true,
      ExposedPorts: {'80/tcp': {}},
      HostConfig: {
        Privileged: true, // needed for docker in docker scenario
        PublishAllPorts: true,
        PortBindings: {
          '80/tcp': [{ 'HostPort': '80' }]
        }
      }
    }
    const container = await this.docker.createContainer(containerParams)
    await container.start({ })
    await exec(container, ['mkdir', '-p', 'app'])
    await exec(container, ['touch', 'app/script.sh'])
    if (startupScript) {
      const targetFn = '/app/script.sh'
      await createFile(container, startupScript, targetFn)
      await exec(container, ['chmod', '+x', targetFn])
      await exec(container, [targetFn], { verbose: true })
    }
    return container.id
  },
  createImage: async function (instanceId) {
    const container = await getContainer(this.docker, instanceId)
    if (container) {
      const commited = await container.commit()
      return commited.Id.substr(7) // remove 'sha256:' in front
    } else {
      console.error('Could not find instance with ID: ', instanceId)
    }
  },
  deleteInstance: async function (instanceId) {
    const container = await getContainer(this.docker, instanceId)
    if (container) {
      container.kill()
    } else {
      console.error('Could not find instance with ID: ', instanceId)
    }
  },
  getPublicInstanceAddress: function () {
    return '127.0.0.1'
  },
  describeInstance: async function (instanceId) {
    const container = await getContainer(this.docker, instanceId)
    const description = await container.inspect()
    return description
  }
}
