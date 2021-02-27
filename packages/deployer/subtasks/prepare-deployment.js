const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const prompter = require('../utils/prompter');
const rimraf = require('rimraf');
const { subtask } = require('hardhat/config');
const { SUBTASK_PREPARE_DEPLOYMENT } = require('../task-names');

const DEPLOYMENT_SCHEMA = {
  properties: {
    completed: false,
    totalGasUsed: 0,
  },
  transactions: {},
  contracts: {
    modules: {},
  },
};

/*
 * Prepares the deployment file associated with the active deployment.
 * */
subtask(SUBTASK_PREPARE_DEPLOYMENT).setAction(async (taskArguments, hre) => {
  if (!hre.deployer) {
    hre.deployer = {};
  }

  hre.deployer.file = _determineTargetDeploymentFile();

  const { clear } = taskArguments;
  if (clear) {
    await _clearPreviousDeploymentData();
  }

  _ensureFoldersExist();
  _createDeploymentFileIfNeeded();

  hre.deployer.data = _setupAutosaveProxy({ hre });
});

function _createDeploymentFileIfNeeded() {
  if (!fs.existsSync(hre.deployer.file)) {
    let data;

    if (path.basename(hre.deployer.file) === 'deployment.json') {
      data = DEPLOYMENT_SCHEMA;
    } else {
      hre.deployer.previousData = JSON.parse(fs.readFileSync(_getDeploymentFilePath()));
      data = hre.deployer.previousData;
    }

    fs.appendFileSync(hre.deployer.file, JSON.stringify(data, null, 2));

    logger.success(`New deployment file created: ${hre.deployer.file}`);
  }
}

function _getDeploymentFolderPath() {
  return path.join(hre.config.deployer.paths.deployments, hre.network.name);
}

function _getDeploymentFilePath() {
  return path.join(_getDeploymentFolderPath(), 'deployment.json');
}

function _getMigrationFilePath() {
  return path.join(_getDeploymentFolderPath(), 'migration.json');
}

function _determineTargetDeploymentFile() {
  hre.deployer.isMigration = fs.existsSync(_getDeploymentFilePath());

  if (hre.deployer.isMigration) {
    return _getMigrationFilePath();
  } else {
    return _getDeploymentFilePath();
  }
}

function _ensureFoldersExist() {
  const deploymentsFolder = hre.config.deployer.paths.deployments;
  if (!fs.existsSync(deploymentsFolder)) {
    fs.mkdirSync(deploymentsFolder);
  }

  const networkFolder = path.join(deploymentsFolder, hre.network.name);
  if (!fs.existsSync(networkFolder)) {
    fs.mkdirSync(networkFolder);
  }
}

async function _clearPreviousDeploymentData() {
  logger.warn('Received --clear parameter. This will delete all previous deployment data!');
  await prompter.confirmAction('Clear all data');

  const deploymentsFolder = hre.config.deployer.paths.deployments;
  const networkFolder = path.join(deploymentsFolder, hre.network.name);

  if (fs.existsSync(networkFolder)) {
    rimraf.sync(networkFolder);
  }
}

function _setupAutosaveProxy({ hre }) {
  const data = JSON.parse(fs.readFileSync(hre.deployer.file));

  const handler = {
    get: (target, key) => {
      if (typeof target[key] === 'object' && target[key] !== null) {
        return new Proxy(target[key], handler);
      } else {
        return target[key];
      }
    },

    set: (target, key, value) => {
      logger.debug('Setting property in deployer.data:');
      logger.debug(`  > key: ${key}`);
      logger.debug(`  > value: ${JSON.stringify(value)}`);

      if (target[key] === value) {
        logger.debug('No changes - skipping write to deployment file');
      } else {
        target[key] = value;

        fs.writeFileSync(hre.deployer.file, JSON.stringify(hre.deployer.data, null, 2));

        logger.debug(`Deployment file saved: ${hre.deployer.file}`);
      }
    },
  };

  return new Proxy(data, handler);
}
