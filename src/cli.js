#!/usr/bin/env node

require('babel-polyfill')

const CmdlineParser = require('argparse').ArgumentParser
const fs = require('fs')

const createLogger = require('./createLogger')
const mutti = require('./index')
const packageJson = require('../package.json')

const level = process.env.LOG_LEVEL || 'info'
const logger = createLogger({ name: 'Mutticloud', level })

process.on('unhandledRejection', error => {
  console.error('Unhandled Rejection', error)
  process.exit(1)
})

function report (promise) {
  promise.then(result =>
    console.log('Result: ', JSON.stringify(result, null, 2))
  )
}

const cmd = new CmdlineParser({
  version: packageJson.version,
  addHelp: true,
  description: packageJson.description
})

cmd.addArgument(
  [ '-c', '--cloud' ],
  {
    help: 'Choose the name of the cloud provider',
    choices: ['aws', 'gcloud', 'docker'],
    required: true
  }
)

cmd.addArgument(
  [ '-a', '--action' ],
  {
    help: 'Choose the action you want to perform in the cloud',
    choices: ['create', 'launch', 'describe', 'delete', 'createImage', ...mutti.templates],
    required: true
  }
)

cmd.addArgument(
  [ '-i', '--image' ],
  {
    help: 'Choose the image the action relates to',
    required: false
  }
)

cmd.addArgument(
  [ '-n', '--imageName' ],
  {
    help: 'Choose the name of the output image',
    required: false
  }
)

cmd.addArgument(
  [ '-x', '--instance' ],
  {
    help: 'Choose the image the action relates to',
    required: false
  }
)

cmd.addArgument(
  [ '--machineType' ],
  {
    help: 'Choose the machine type the action relates to',
    required: false
  }
)

cmd.addArgument(
  [ '--diskSize' ],
  {
    help: 'Choose the disk size in gb the action relates to',
    required: false
  }
)

cmd.addArgument(
  [ '-s', '--script' ],
  {
    help: 'The filename of the startup script',
    required: false
  }
)

cmd.addArgument(
  [ '--accessKey' ],
  {
    help: 'The access key for the cloud provider',
    required: false
  }
)

cmd.addArgument(
  [ '--secretKey' ],
  {
    help: 'The secret key for the cloud provider',
    required: false
  }
)

cmd.addArgument(
  [ '--keyName' ],
  {
    help: 'AWS key pair name',
    required: false
  }
)

cmd.addArgument(
  [ '--credentials' ],
  {
    help: 'The filename of the credentials file (gcloud: service account filename)',
    required: false
  }
)

cmd.addArgument(
  ['-r', '--region'],
  {
    help: 'The region of the cloud',
    required: false
  }
)

cmd.addArgument(
  ['-z', '--zone'],
  {
    help: 'The zone of the cloud',
    required: false
  }
)

const args = cmd.parseArgs()
const provider = mutti.factory(args.cloud, {
  logger,
  accessKey: args.accessKey,
  secretKey: args.secretKey,
  credentials: args.credentials,
  region: args.region,
  zone: args.zone
})

const startupScript = args.script && fs.readFileSync(args.script).toString()

switch (args.action) {
  case 'create': {
    report(provider.createInstance(args.image, { startupScript, keyName: args.keyName }))
    break
  }

  case 'launch': {
    report(provider.createInstance({ startupScript, imageId: args.image }))
    break
  }
  case 'describe':
    if (args.instance) {
      report(provider.describeInstance(args.instance))
    } else if (args.image) {
      report(provider.describeImage(args.image))
    } else {
      console.error('Nothing to describe, please specify: image or instance')
    }
    break
  case 'delete':
    report(provider.deleteInstance(args.instance))
    break
  case 'createImage':
    report(provider.createImage(args.instance, args.imageName))
    break
  default:
    const handler = provider.templates[args.action]
    if (handler) {
      report(handler({ startupScript, logger, ...args }))
    }
    break
}
