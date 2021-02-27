const fs = require('fs');
const path = require('path');
const figlet = require('figlet');
const chalk = require('chalk');
const logger = require('../utils/logger');
const prompter = require('../utils/prompter');
const rimraf = require('rimraf');
const { subtask } = require('hardhat/config');
const { readPackageJson } = require('../utils/package');
const { getCommit, getBranch } = require('../utils/git');
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
  await _printTitle();

  if (!hre.deployer) {
    hre.deployer = {};
  }

  hre.deployer.file = _determineTargetDeploymentFile();

  await _printInfo(taskArguments);

  const { clear } = taskArguments;
  if (clear) {
    await _clearPreviousDeploymentData();
  }

  await prompter.confirmAction('Proceed with deployment');

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
  if (fs.existsSync(_getDeploymentFilePath())) {
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

async function _printInfo(taskArguments) {
  logger.log(chalk.yellow('\nPlease confirm these deployment parameters:'));
  logger.boxStart();

  logger.log(chalk.gray(`commit: ${getCommit()}`));

  const branch = getBranch();
  logger.log(chalk[branch !== 'master' ? 'red' : 'gray'](`branch: ${branch}`));

  const network = hre.network.name;
  logger.log(chalk[network.includes('mainnet') ? 'red' : 'gray'](`network: ${network}`));

  logger.log(chalk.gray(`debug: ${taskArguments.debug}`));

  if (fs.existsSync(hre.deployer.file)) {
    logger.log(chalk.gray(`deployment file: ${hre.deployer.file}`));
  } else {
    logger.log(chalk.green(`new deployment file: ${hre.deployer.file}`));
  }

  const signer = (await hre.ethers.getSigners())[0];
  const balance = hre.ethers.utils.formatEther(
    await hre.ethers.provider.getBalance(signer.address)
  );
  logger.log(chalk.gray(`signer: ${signer.address}`));
  logger.log(chalk.gray(`signer balance: ${balance} ETH`));

  if (taskArguments.clear) {
    logger.log(chalk.red('clear: true'));
  }

  logger.boxEnd();

  logger.debug('Deployer configuration:');
  logger.debug(JSON.stringify(hre.config.deployer, null, 2));
}

async function _printTitle() {
  async function figPring(msg, font = 'Slant') {
    return new Promise((resolve) => {
      figlet.text(msg, { font }, function (err, formattedMsg) {
        if (err) {
          throw new Error(err);
        }

        console.log(chalk.red(formattedMsg));
        resolve();
      });
    });
  }

  await figPring(readPackageJson().name);
  await figPring('           deployer');
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
