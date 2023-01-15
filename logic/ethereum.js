/* eslint-disable @typescript-eslint/no-var-requires */
const fsExtra = require("fs-extra");
const Web3 = require("web3");
const cliProgress = require('cli-progress');

const Functions = require("./functions");
// const decoder = new InputDataDecoder(`${__dirname}/abi.json`);

const BLOCKS_PATH = "./storage/blocks_full/";
const TXS_PATH = "./storage/txs_found/";
const CONTRACTS_PATH = "./storage/contracts_full/"

module.exports = class Eth {
  constructor() {
    this.blockFileRoot = "./storage/blocks/b"
    this.nodeApiConsumers = Array(6).fill(1).map((x, i) => {
      return {
        id: i,
        api: new Web3(new Web3.providers.HttpProvider("https://eth-mainnet.g.alchemy.com/v2/{YOUR_ALCHEMY_API_KEY}/")),
        isWorking: false,
      };
    });
    this.evalApiConsumers = Array(6).fill(1).map((x, i) => {
      return {
        id: i,
        url: "",
        isWorking: false,
      };
    });
    this.blocks = {}; // Used when fetching blocks from api
    this.bar_fetch_blocks = new cliProgress.SingleBar({
      format: 'Progress [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
    }, cliProgress.Presets.shades_classic);

    this.txs2Contracts = {} // used in fetching receipts
    this.contractsRcps = {} // used in fetching receipts
    this.savingFile = false // used in fetching receipts
    this.tempFetching = {};
    this.loadedContracts = {} // used when fetching results
  }

  /**
   * Method to verify if an object contains all blocks from startBlock to endBlock
   * @param {Object} object 
   * @param {Number} startBlock 
   * @param {Number} endBlock 
   * @returns {Boolean} True/False
   */
  verifyBlockObj(startBlock, endBlock) {
    for(let i = startBlock; i <=  endBlock; i += 1) {
      if (!(this.blocks[i] && (this.blocks[i].number === i))) {
        return false;
      }
    }
    return true;
  }

  async fetchBlock(consumer, number) {
    try {
      const response = await this.nodeApiConsumers[consumer].api.eth.getBlock(number, true).catch((error) => console.log(error));
      if (response && response.hash) {
        this.blocks[number] = response;
      } else {
        console.log("Request failed on provider ", number);
      }
    } catch (err) {
      console.log("Request failed on provider ", number, err);
    }
    this.tempFetching[number] = false;
    this.nodeApiConsumers[consumer].isWorking = false;
  }

  async fetchBlockRange(startBlock, endBlock) {
    this.tempFetching = {};
    const storedBlocks = await Functions.loadCompressedFromStorage2(BLOCKS_PATH + `b-${startBlock}`);
    this.blocks = storedBlocks ? storedBlocks : {};
    this.bar_fetch_blocks.update(startBlock + Object.keys(this.blocks).length);
    if (this.verifyBlockObj(startBlock, endBlock)) {
      return;
    }
    while (!this.verifyBlockObj(startBlock, endBlock)) {
      for(let i = 0; i < this.nodeApiConsumers.length; i += 1) {
        if (!this.nodeApiConsumers[i].isWorking) {
          for(let j = startBlock; j <=  endBlock; j += 1) {
            if (!(this.blocks[j] && (this.blocks[j].number === j)) && !this.tempFetching[j]) {
              this.tempFetching[j] = true;
              this.nodeApiConsumers[i].isWorking = true;
              this.fetchBlock(i, j);
              break;
            }
          }
        }
      }
      this.bar_fetch_blocks.update(startBlock + Object.keys(this.blocks).length);
      await Functions.delay(20);
    }
    await Functions.saveCompressedToStorage(BLOCKS_PATH + `b-${startBlock}`, this.blocks);
  }
 
  async fetchBlocks(startBlock, endBlock) {
    const start = (Math.floor(startBlock / 1000) * 1000) + 1;
    this.bar_fetch_blocks.start(endBlock, start);
    for (let i = start; i <=  endBlock; i += 1000) {
      await this.fetchBlockRange(i, i + 999 < endBlock ? (i + 999) : endBlock);
    }
    this.bar_fetch_blocks.stop();
  }

  async findPosibleContractTxs() {
    fsExtra.emptyDirSync(TXS_PATH);
    const txHases = {};
    let txArray = [];
    const blockFiles = await Functions.getFileList(BLOCKS_PATH);
    const bar1 = new cliProgress.SingleBar({
      format: 'progress [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} | Found txs: {txs}'
    }, cliProgress.Presets.shades_classic);
    bar1.start(blockFiles.length, {
      txs: Object.keys(txHases).length,
    });
    for (const file of blockFiles) {
      const blocks = await Functions.loadCompressedFromStorage2(BLOCKS_PATH + file);
      bar1.update(blockFiles.indexOf(file), { txs: Object.keys(txHases).length });
      for (const block of Object.values(blocks)) {
        for (const tx of block.transactions) {
          if (tx.to === null) {
            txHases[tx.hash] = tx.blockNumber;
            txArray.push({...tx, blockTimestamp: block.timestamp, });
            if (txArray.length >= 1000) {
              await Functions.saveToStorage(TXS_PATH + `t-${(await Functions.getFileList(TXS_PATH)).length}`, txArray);
              txArray = [];
            }
          }
        }
      }
    }
    await Functions.saveToStorage(TXS_PATH + `t-${(await Functions.getFileList(TXS_PATH)).length}`, txArray);
    txArray = [];
    bar1.stop();
  }

  async getImportedContractTxHashes() {
    const contractFiles = await Functions.getFileList(CONTRACTS_PATH);
    const txs2Contracts = new Map();
    const bar1 = new cliProgress.SingleBar({
      format: 'Loading Imported Contracts [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
    }, cliProgress.Presets.shades_classic);
    bar1.start(contractFiles.length, 0);
    for (const file of contractFiles) {
      const contracts = await Functions.loadFromStorage(CONTRACTS_PATH + file);
      for (const contract of Object.values(contracts)) {
        txs2Contracts.set(contract.transactionHash, contract.contractAddress);
      }
      bar1.update(contractFiles.indexOf(file));
    }
    bar1.stop();
    return txs2Contracts;
  }

  processReceipt(receipt) {
    return {
      blockNumber: receipt.blockNumber,
      contractAddress: receipt.contractAddress,
      cumulativeGasUsed: receipt.cumulativeGasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      from: receipt.from,
      gasUsed: receipt.gasUsed,
      to: receipt.to,
      transactionHash: receipt.transactionHash,
      transactionIndex: receipt.transactionIndex,
      type: receipt.type,
      status: receipt.status,
    };
  }
  processTx(tx) {
    return {
      gas: tx.gas,
      gasPrice: tx.gasPrice,
      input: tx.input,
      nonce: tx.nonce,
      value: tx.value,
      v: tx.v,
      r: tx.r,
      s: tx.s,
      blockTimestamp: tx.blockTimestamp,
    };
  }

  async fetchTxReceipt(consumer, tx) {
    try {
      let receipt = {};
      const response = await this.nodeApiConsumers[consumer].api.eth.getTransactionReceipt(tx.hash).catch((error) => console.log(error));
      if (response && response.transactionHash && response.contractAddress) {
        receipt = this.processReceipt(response);
      } else {
        await Functions.delay(2000);
        console.log("Error fetching receipt", tx.hash, response);
        this.nodeApiConsumers[consumer].isWorking = false;
        this.tempFetching[tx.hash] = false;
        return false;
      }
      this.contractsRcps[receipt.contractAddress] = {...receipt, ...this.processTx(tx)};
      this.txs2Contracts.set(tx.hash, receipt.contractAddress);
    } catch (err) {
      await Functions.delay(2000);
      console.log("Request failed on provider ", consumer, err);
    }
    this.tempFetching[tx.hash] = false;
    this.nodeApiConsumers[consumer].isWorking = false;
  }

  verifyReiceptsFetched(txs) {
    for (const tx of txs) {
      if (!this.txs2Contracts.get(tx.hash)) {
        return false;
      }
    }
    return true;
  }

  async fetchReceiptsAndBuildInitialContracts() {
    this.txs2Contracts = await this.getImportedContractTxHashes();
    console.log(`Already imported ${this.txs2Contracts.size} contracts`);

    const txsFiles = await Functions.getFileList(TXS_PATH);
    this.contractsRcps = {};

    const bar1 = new cliProgress.SingleBar({
      format: 'Getting Receipts [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} | Fetched {receipt}'
    }, cliProgress.Presets.shades_classic);
    bar1.start(txsFiles.length, 0, {
      receipt: this.txs2Contracts.size,
    });
    for (const file of txsFiles) {
      const txs = await Functions.loadFromStorage(TXS_PATH + file);
      while (!this.verifyReiceptsFetched(txs)) {
        for(let i = 0; i < this.nodeApiConsumers.length; i += 1) {
          if (!this.nodeApiConsumers[i].isWorking) {
            for (const tx of Object.values(txs)) {
              if (!this.txs2Contracts.get(tx.hash) && !this.tempFetching[tx.hash]) {
                this.tempFetching[tx.hash] = true;
                this.nodeApiConsumers[i].isWorking = true;
                this.fetchTxReceipt(i, tx);
                break;
              }
            }
          }
        }
        bar1.update(txsFiles.indexOf(file) + 1, {
          receipt: this.txs2Contracts.size,
        });
        await Functions.delay(20);
      }
      bar1.update(txsFiles.indexOf(file) + 1, {
        receipt: this.txs2Contracts.size,
      });
      this.tempFetching = {};
      if (Object.keys(this.contractsRcps).length >= 1000) {
        await Functions.saveToStorage(CONTRACTS_PATH + `t-${(await Functions.getFileList(CONTRACTS_PATH)).length}`, this.contractsRcps);
        this.contractsRcps = {};
      }
    }
    await Functions.saveToStorage(CONTRACTS_PATH + `t-${(await Functions.getFileList(CONTRACTS_PATH)).length}`, this.contractsRcps);
    bar1.stop();
  }

  async fetchAbiForContracts() {
    const bar1 = new cliProgress.SingleBar({format: 'Getting Verified [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} | Fetched: {fetched}'}, cliProgress.Presets.shades_classic);
    const contractFiles = await Functions.getFileList(CONTRACTS_PATH);
    let fetched = 0;
    bar1.start(contractFiles.length, 0, {fetched});
    for (const file of contractFiles) {
      const contracts = await Functions.loadFromStorage(CONTRACTS_PATH + file);
      const tofetch = [];
      for (const contract of Object.keys(contracts)) {
        if (contracts[contract].verified === undefined) {
          tofetch.push(contracts[contract].contractAddress);
        }
      }
      let fetchedRes = {};
      while (tofetch.length > 0) {
        const spliceLen = tofetch.length > 10 ? 10 : tofetch.length;
        const response = await Functions.getAbiByContractList2(tofetch.splice(0, spliceLen))
        fetchedRes = {...fetchedRes, ...response};
      }
      for (const contract of Object.keys(contracts)) {
        if (contracts[contract].verified === undefined) {
          let res = {};
          if (fetchedRes[contracts[contract].contractAddress]) {
            res = fetchedRes[contracts[contract].contractAddress];
          } else {
            res = await Functions.getAbiByContract(contracts[contract].contractAddress);
          }
          if (res.status === '0' && res.result !== 'Contract source code not verified') {
            console.log(`Encountered unexpected error: ${res.result}. Contract: ${contracts[contract].contractAddress}. The case is unhandled.`)
          } else if (res.status === '0' && res.result === 'Contract source code not verified') {
            contracts[contract].verified = false;
          } else if (res.status === '1' && res.message === 'OK') {
            contracts[contract].verified = true;
            contracts[contract].abi = res.result;
          } else {
            console.log(`Sould not have gone here. Uncharted response: ${res}. Contract: ${contracts[contract].contractAddress}. The case is unhandled.`)
          }
        }
        if (contracts[contract].verified !== undefined) {
          contracts[contract].isSmartContract = true;
          fetched += 1;
          bar1.update(contractFiles.indexOf(file) + 1, {fetched});
        }
      }
      await Functions.saveToStorage(CONTRACTS_PATH + file, contracts);
      bar1.update(contractFiles.indexOf(file) + 1, {fetched});
    }
    bar1.stop();
  }
  async contractStatistics() {
    const contractFiles = await Functions.getFileList(CONTRACTS_PATH);
    const results = {};
    const bar1 = new cliProgress.SingleBar({
      format: 'Getting Receipts [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
    }, cliProgress.Presets.shades_classic);
    const count = {
      two: 0,
      three: 0,
      more: 0,
      success: 0,
      other: 0,
      '0x6060604052': 0,
      '0x6080604052': 0,
      verified: {
        total: 0,
        other: 0,
        '0x6060604052': 0,
        '0x6080604052': 0,
      }
    }
    bar1.start(contractFiles.length, 0);
    for (const file of contractFiles) {
      const contracts = await Functions.loadFromStorage(CONTRACTS_PATH + file);
      for (const contract of Object.values(contracts)) {
        if (!results[contract.contractAddress]) {
          results[contract.contractAddress] = {
            count: 0,
            txs: [contract.transactionHash]
          }
        } else {
          results[contract.contractAddress].count += 1;
          results[contract.contractAddress].txs.push(contract.transactionHash);
        }
        if (results[contract.contractAddress].count > 3) {
          count.more += 1;
        } else if(results[contract.contractAddress].count > 2) {
          count.three += 1;
        } else if(results[contract.contractAddress].count > 1) {
          count.two += 1;
        }
        const startString = contract.input.substring(0, 12);
        if (startString === '0x6060604052') {
          count[startString] +=1;
          if (contract.verified) {
            count.verified[startString] += 1;
          }
        } else if (startString === '0x6080604052') {
            count[startString] +=1;
            if (contract.verified) {
              count.verified[startString] += 1;
            }
        } else {
          count.other += 1;
          if (contract.verified) {
            count.verified.other += 1;
          }
        }
        if (contract.status) {
          count.success += 1;
        }
        if (contract.verified) {
          count.verified.total += 1;
        }
      }
      bar1.update(contractFiles.indexOf(file));
    }
    bar1.stop();
    console.log(`Found ${Object.keys(results).length} unique contracts`);
    console.log(`Found ${count.two} contracts with atleast 2 references`);
    console.log(`Found ${count.three} contracts with atleast 3 references`);
    console.log(`Found ${count.more} contracts with atleast 4 references`);
    const temp = [];
    for (const key of Object.keys(count)) {
      temp.push ( { key, ammount: count[key] });
    }
    temp.sort((el, el2) => el2.ammount - el.ammount)
    console.log(temp);
    

  }
  processEvalResult(result) {
    // Clean mithril results
    if (result.mythril && result.mythril.issues) {
      for (let i = 0; i < result.mythril.issues.length; i+=1) {
        delete result.mythril.issues[i].tx_sequence;
      }
    }
    if (result.osiris && result.osiris.dead_code) {
      delete result.osiris.dead_code;
    }
    return result;
  }
  async fetchEvalApiResult(contract, consumerId) {
    let res = undefined;
    try {
      const tempContract = this.loadedContracts[contract];
      res = await Functions.postAPI({
        code: '' + tempContract.input.replace("0x", ""),
        verified: 'false',
        all: tempContract.results === undefined ? 'true' : 'false',
        oyente: tempContract.results === undefined || tempContract.results.oyente === undefined ? 'true' : 'false',
        osiris: tempContract.results === undefined || tempContract.results.osiris === undefined ? 'true' : 'false',
        mythril: (tempContract.results === undefined || tempContract.results.mythril === undefined) && tempContract.input.length < 10000 ? 'true' : 'false',
        maian: tempContract.results === undefined || tempContract.results.maian === undefined ? 'true' : 'false',
      }, consumerId);
    } catch (error) {
      console.log("This should not happen.");
    }
    this.evalApiConsumers[consumerId].isWorking = false;
    if (res) {
      res = this.processEvalResult(res);
      if (this.loadedContracts[contract].results === undefined) {
        this.loadedContracts[contract].results = {};
      }
      for (const resKey of Object.keys(res)) {   
        this.loadedContracts[contract].results[resKey] = {...res[resKey]};
      }
      this.count += 1;
      await Functions.delay(52);
    }
    this.tempFetching[contract] = false;
  }

  getContractFetchList() {
    const toFetch = {};
    for (const contract of Object.values(this.loadedContracts)) {
      if (contract.input.startsWith('0x6080604052') && 
        (contract.results === undefined
        || contract.results.oyente === undefined
        || contract.results.osiris === undefined
        || (contract.results.mythril === undefined && contract.input.length < 10000 )
        || contract.results.maian === undefined
        )) {
          toFetch[contract.contractAddress] = true;
      }
    }
    return toFetch;
  }
  getTotalFetchedInFile() {
    let count = 0;
    for (const contract of Object.values(this.loadedContracts)) {
      if (contract.input.startsWith('0x6080604052') && 
        (contract.results !== undefined
        && contract.results.oyente !== undefined
        && contract.results.osiris !== undefined
        && contract.results.mythril !== undefined
        && contract.results.maian !== undefined
        )) {
          count += 1;
      }
    }
    return count;
  }
  numberOfConcurentFetching() {
    let count = 0;
    for (const contractKey of Object.keys(this.tempFetching)) {
      if (this.tempFetching[contractKey] === true) {
        count += 1;
      }
    }
    return count;
  }

  getAvailableConsumer() {
    for (let i = 0; i < this.evalApiConsumers.length; i += 1) {
      if (this.evalApiConsumers[i].isWorking !== true) {
        this.evalApiConsumers[i].isWorking = true;
        return i;
      }
    }
    return false;
  }

  getAvailableConsumers() {
    let count = 0;
    for (let i = 0; i < this.evalApiConsumers.length; i += 1) {
      if (this.evalApiConsumers[i].isWorking !== true) {
        count += 1;
      }
    }
    return count;
  }

  async fetchContractEvalResults() {
    const bar1 = new cliProgress.SingleBar({format: 'Getting Verified [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} | Ramaining in file: {remain} | Fetched in session: {count} | Total fetched: {totalFetched} | Fetching: {fetching} | Consumers free: {consumers} | File: {file} '}, cliProgress.Presets.shades_classic);
    const contractFiles = await Functions.getFileList(CONTRACTS_PATH);
    let remain = 0;
    this.count = 0;
    let totalFetched = 0;
    bar1.start(contractFiles.length, 0, {remain, count:this.count, totalFetched, fetching:0, file: "", consumers: 0 });
    for (const file of contractFiles) {
      delete this.loadedContracts;
      this.loadedContracts = await Functions.loadFromStorage(CONTRACTS_PATH + file);
      const toSave = Object.keys(this.getContractFetchList()).length > 0 ? true : false;
      while (Object.keys(this.getContractFetchList()).length) {
        for (const contractKey of Object.keys(this.getContractFetchList())) {
          if ((this.tempFetching[contractKey] === undefined || this.tempFetching[contractKey] === false)) {
            const consumerId = this.getAvailableConsumer();
            if (consumerId !== false) {
              this.tempFetching[contractKey] = true;
              this.fetchEvalApiResult(contractKey, consumerId);
            }
          }
        }
        remain = Object.keys(this.getContractFetchList()).length;
        bar1.update(contractFiles.indexOf(file), {remain, count:this.count, fetching: this.numberOfConcurentFetching(), file, consumers: this.getAvailableConsumers() });
        await Functions.delay(50);
      }
      if (toSave) {
        await Functions.saveToStorage(CONTRACTS_PATH + file, this.loadedContracts);
        // await Functions.clearApi();
      }
      totalFetched += this.getTotalFetchedInFile();
      bar1.update(contractFiles.indexOf(file), {remain, count:this.count, totalFetched, fetching: this.numberOfConcurentFetching(), file, consumers: this.getAvailableConsumers() });
    }
    bar1.stop();
  }
  async printResults() {
    const contractFiles = await Functions.getFileList(CONTRACTS_PATH);
    const bar1 = new cliProgress.SingleBar({
      format: 'Getting Receipts [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
    }, cliProgress.Presets.shades_classic);

    bar1.start(contractFiles.length, 0);
    const count = {
      total: 0,
      oyente: 0,
      osiris: 0,
    };
    await Functions.clearApi();
    bar1.stop();
    console.log(count);
  }
  async printTesting() {
    const contractFiles = await Functions.getFileList(CONTRACTS_PATH);
    // const results = {};
    const bar1 = new cliProgress.SingleBar({
      format: 'Getting Receipts [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
    }, cliProgress.Presets.shades_classic);
    bar1.start(contractFiles.length, 0);
    for (const file of contractFiles) {
      const contracts = await Functions.loadFromStorage(CONTRACTS_PATH + file);
      for (const contract of Object.values(contracts)) {
        if ((contract.results !== undefined
          && contract.results.oyente !== undefined
          && contract.results.osiris !== undefined
          && contract.results.mythril !== undefined
          && contract.results.maian !== undefined
          && contract.results.oyente.vulnerabilities
          && (
            contract.results.oyente.vulnerabilities.callstack === true
            || contract.results.oyente.vulnerabilities.reentrancy === true
            || contract.results.oyente.vulnerabilities.time_dependency === true
            || contract.results.oyente.vulnerabilities.money_concurrency === true
          )
          && (
            !(contract.results.maian.suicidal.includes("No suicidal vulnerability found") || contract.results.maian.suicidal.includes("The code does not contain SUICIDE instructions"))
            || !(contract.results.maian.prodigal.includes("No prodigal vulnerability found") || contract.results.maian.prodigal.includes("Leak vulnerability found!"))
            || !(contract.results.maian.greedy.includes("No lock vulnerability found") || contract.results.maian.greedy.includes("No locking vulnerability found") || contract.results.maian.greedy.includes("Locking vulnerability found"))
          )
          )) {
            console.log(JSON.stringify(contract, null, 2));
            console.log(contract.results.maian);
            bar1.stop()
            return;
        }
      }
      bar1.update(contractFiles.indexOf(file));
    }
    bar1.stop();
    
  }

  async processResults() {
    let count = 0;
    const vulnerableContracts = new Map();
    const vulnerabilities = {
      oyente: {
        callstack: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        reentrancy: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        time_dependency: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        money_concurrency: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        integer_overflow: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        integer_underflow: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
      },
      osiris: {
        callstack: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        reentrancy: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        modulo: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        division: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        signedness: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        underflow: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        time_dependency: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        assertion_failure: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        timeout: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        overflow: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        money_concurrency: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        truncation: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
      },
      maian: {
        suicidal: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        prodigal: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
        greedy: {
          total: 0,
          verified: 0,
          success: 0,
          contracts: [],
          contractsVer: [],
        },
      },
      mythril: {
        total: 0,
        verified: 0,
        success: 0,
        contracts: [],
        vulns: [],
        sums: {
          reentrancy: {
            swc_id: '107',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
          dos: {
            swc_id: '113',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
          time_dependency: {
            swc_id: '116',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
          assertion_failure: {
            swc_id: '110',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
          integer_overflow: {
            swc_id: '101',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
          unchecked_return: {
            swc_id: '104',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
          suicidal: {
            swc_id: '106',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
          prodigal: {
            swc_id: '105',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
          tx_origin: {
            swc_id: '115',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
          untrusted_delegatecall: {
            swc_id: '112',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
          arbitrary_storage: {
            swc_id: '124',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
          insufficient_randomness: {
            swc_id: '120',
            total: 0,
            verified: 0,
            success: 0,
            contracts: [],
            contractsVer: [],
          },
        },
      },
      years: [
        {
          year: "2023",
          start: 1672531200,
          end: 2672531199,
          total: 0,
          vuln: 0,
          verified: 0,
        },
        {
          year: "2022",
          start: 1640995200,
          end: 1672531199,
          total: 0,
          vuln: 0,
          verified: 0,
        },
        {
          year: "2021",
          start: 1609459200,
          end: 1640995199,
          total: 0,
          vuln: 0,
          verified: 0,
        },
        {
          year: "2020",
          start: 1577836800,
          end: 1609459199,
          total: 0,
          vuln: 0,
          verified: 0,
        },
        {
          year: "2019",
          start: 1546300800,
          end: 1577836799,
          total: 0,
          vuln: 0,
          verified: 0,
        },
        {
          year: "2018",
          start: 1514764800,
          end: 1546300799,
          total: 0,
          vuln: 0,
          verified: 0,
        },
        {
          year: "2017",
          start: 1483228800,
          end: 1514764799,
          total: 0,
          vuln: 0,
          verified: 0,
        },
        {
          year: "2016",
          start: 0,
          end: 1483228799,
          total: 0,
          vuln: 0,
          verified: 0,
        },
      ],
      total:{
        sum: 0,
        verified: 0,
        success: 0,
        successVerified:0,
        noStatus: 0,
      },
    };

    const contractFiles = await Functions.getFileList(CONTRACTS_PATH);
    const bar1 = new cliProgress.SingleBar({
      format: 'Getting Receipts [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} | {max}'
    }, cliProgress.Presets.shades_classic);
    bar1.start(contractFiles.length, 0, { max: 0 });
    let max = 0;
    for (const file of contractFiles) {
      const contracts = await Functions.loadFromStorage(CONTRACTS_PATH + file);
      for (const contract of Object.values(contracts)) {
        if (contract.input.startsWith('0x6080604052') && contract.results) {
          max = contract.input.length > max ? contract.input.length : max;
          vulnerabilities.total.sum += 1;
          if (contract.verified) {
            vulnerabilities.total.verified +=1;
            if (contract.status) {
              vulnerabilities.total.successVerified += 1;
            }
          }
          if (contract.status) {
            vulnerabilities.total.success += 1;
            count += 1;
          }
          if (contract.status === undefined) {
            vulnerabilities.total.noStatus += 1;
          }
          const oyente = contract.results.oyente?.vulnerabilities ?? false;
          if (oyente && contract.status) {
            Object.keys(vulnerabilities.oyente).forEach((vuln) => {
              if ((oyente[vuln] && !['integer_overflow','integer_underflow'].includes(vuln)) || (['integer_overflow','integer_underflow'].includes(vuln) && oyente[vuln].length > 0)) {
                vulnerabilities.oyente[vuln].total += 1;
                if (contract.verified) {
                  vulnerabilities.oyente[vuln].verified += 1;
                  vulnerabilities.oyente[vuln].contractsVer.push(contract.contractAddress);
                }
                if (contract.status) {
                  vulnerabilities.oyente[vuln].success += 1;
                }
                vulnerabilities.oyente[vuln].contracts.push(contract.contractAddress);
                vulnerableContracts.set(contract.contractAddress, 1);
              }
              if (oyente.integer_overflow.length || oyente.integer_underflow.length) {
                console.log(oyente);
                return;
              }
            });
          }
          const osiris = contract.results.osiris ?? false;
          if (osiris && contract.status) {
            Object.keys(vulnerabilities.osiris).forEach((vuln) => {
              if (osiris[vuln]) {
                vulnerabilities.osiris[vuln].total += 1;
                if (contract.verified) {
                  vulnerabilities.osiris[vuln].verified += 1;
                  vulnerabilities.osiris[vuln].contractsVer.push(contract.contractAddress);
                }
                if (contract.status) {
                  vulnerabilities.osiris[vuln].success += 1;
                }
                vulnerabilities.osiris[vuln].contracts.push(contract.contractAddress);
                vulnerableContracts.set(contract.contractAddress, 1);
              }
            });
          }
          const maian = contract.results.maian ?? false;
          if (maian && contract.status) {
            if (!(maian.suicidal?.includes("No suicidal vulnerability found") || maian.suicidal?.includes("The code does not contain SUICIDE instructions"))) {
              vulnerabilities.maian.suicidal.total += 1;
              if (contract.verified) {
                vulnerabilities.maian.suicidal.verified += 1;
                vulnerabilities.maian.suicidal.contractsVer.push(contract.contractAddress);
              }
              if (contract.status) {
                vulnerabilities.maian.suicidal.success += 1;
              }
              vulnerabilities.maian.suicidal.contracts.push(contract.contractAddress);
              vulnerableContracts.set(contract.contractAddress, 1);
            }
            if (!maian.prodigal?.includes("No prodigal vulnerability found")) {
              vulnerabilities.maian.prodigal.total += 1;
              if (contract.verified) {
                vulnerabilities.maian.prodigal.verified += 1;
                vulnerabilities.maian.prodigal.contractsVer.push(contract.contractAddress);
              }
              if (contract.status) {
                vulnerabilities.maian.prodigal.success += 1;
              }
              vulnerabilities.maian.prodigal.contracts.push(contract.contractAddress);
              vulnerableContracts.set(contract.contractAddress, 1);
            }
            if (!(maian.greedy?.includes("No lock vulnerability found") || maian.greedy?.includes("No locking vulnerability found"))) {
              vulnerabilities.maian.greedy.total += 1;
              if (contract.verified) {
                vulnerabilities.maian.greedy.verified += 1;
                vulnerabilities.maian.greedy.contractsVer.push(contract.contractAddress);
              }
              if (contract.status) {
                vulnerabilities.maian.greedy.success += 1;
              }
              vulnerabilities.maian.greedy.contracts.push(contract.contractAddress);
              vulnerableContracts.set(contract.contractAddress, 1);
            }
          }

          const mythril = contract.results.mythril ?? false;
          if (mythril && mythril.issues && contract.status) {
            if (mythril.issues.length > 0) {
              vulnerabilities.mythril.total += 1;
              if (contract.verified) {
                vulnerabilities.mythril.verified += 1;
              }
              if (contract.status) {
                vulnerabilities.mythril.success += 1;
              }
              vulnerableContracts.set(contract.contractAddress, 1);
              vulnerabilities.mythril.contracts.push(contract.contractAddress);
              for (const issue of mythril.issues) {
                const found  = Object.values(vulnerabilities.mythril.sums).find((el) => el.swc_id === issue['swc-id']);
                if (found) {
                  found.total += 1;
                  found.contracts.push(contract.contractAddress);
                  if (contract.verified) {
                    found.verified += 1;
                    found.contractsVer.push(contract.contractAddress);
                  }
                } else {
                  if (!vulnerabilities.mythril.vulns.find((el) => el.title === issue.title)) {
                    vulnerabilities.mythril.vulns.push({ title: issue.title, swc_id: issue['swc-id']});
                  }
                }  
              }
            }
          }
          for (const year of vulnerabilities.years) {
            if (contract.blockTimestamp >= year.start && contract.blockTimestamp <= year.end) {
              year.total += 1;
              if (contract.verified) {
                year.verified += 1;
              }
              if (vulnerableContracts.get(contract.contractAddress)) {
                year.vuln += 1;
              }
            }
          }
        }
      }

      bar1.update(contractFiles.indexOf(file), { max });
    }

    bar1.stop();
    console.log(" ")
    console.log(`Vulnerable Contracts: ${vulnerableContracts.size} Total contracts: ${count} Vulnerable %: ${(vulnerableContracts.size / count) * 100}`)
    console.log(vulnerabilities);
    console.log(vulnerabilities.mythril.vulns);
    vulnerabilities.vulnerableContracts = vulnerableContracts.size;
    vulnerabilities.totalCount = count;
    await Functions.saveToStorage("./storage/resutls.json", vulnerabilities)
  }

  async printSavedResults() {
    const valnerabilities = await Functions.loadFromStorage("./storage/resutls.json");
    console.log(valnerabilities)
    const vulns = [
      {
        name: "callstack",
        vuln: (new Set([...valnerabilities.oyente.callstack.contracts, ...valnerabilities.osiris.callstack.contracts])).size,
        vulnVer: (new Set([...valnerabilities.oyente.callstack.contractsVer, ...valnerabilities.osiris.callstack.contractsVer])).size,
      },
      {
        name: "reentrancy",
        vuln: (new Set([...valnerabilities.oyente.reentrancy.contracts, ...valnerabilities.osiris.reentrancy.contracts, ...valnerabilities.mythril.sums.reentrancy.contracts])).size,
        vulnVer: (new Set([...valnerabilities.oyente.reentrancy.contractsVer, ...valnerabilities.osiris.reentrancy.contractsVer, ...valnerabilities.mythril.sums.reentrancy.contractsVer])).size,
      },
      {
        name: "time_dependency",
        vuln: (new Set([...valnerabilities.oyente.time_dependency.contracts, ...valnerabilities.osiris.time_dependency.contracts, ...valnerabilities.mythril.sums.time_dependency.contracts])).size,
        vulnVer: (new Set([...valnerabilities.oyente.time_dependency.contractsVer, ...valnerabilities.osiris.time_dependency.contractsVer, ...valnerabilities.mythril.sums.time_dependency.contractsVer])).size,
      },
      {
        name: "money_concurrency",
        vuln: (new Set([...valnerabilities.oyente.money_concurrency.contracts, ...valnerabilities.osiris.money_concurrency.contracts])).size,
        vulnVer: (new Set([...valnerabilities.oyente.money_concurrency.contractsVer, ...valnerabilities.osiris.money_concurrency.contractsVer])).size,
      },
      {
        name: "integer_overflow",
        vuln: (new Set([...valnerabilities.oyente.integer_overflow.contracts, ...valnerabilities.osiris.overflow.contracts, ...valnerabilities.mythril.sums.integer_overflow.contracts])).size,
        vulnVer: (new Set([...valnerabilities.oyente.integer_overflow.contractsVer, ...valnerabilities.osiris.overflow.contractsVer, ...valnerabilities.mythril.sums.integer_overflow.contractsVer])).size,
      },
      {
        name: "integer_underflow",
        vuln: (new Set([...valnerabilities.oyente.integer_underflow.contracts, ...valnerabilities.osiris.underflow.contracts])).size,
        vulnVer: (new Set([...valnerabilities.oyente.integer_underflow.contractsVer, ...valnerabilities.osiris.underflow.contractsVer])).size,
      },
      {
        name: "modulo",
        vuln: (new Set([...valnerabilities.osiris.modulo.contracts])).size,
        vulnVer: (new Set([...valnerabilities.osiris.modulo.contractsVer])).size,
      },
      {
        name: "division",
        vuln: (new Set([...valnerabilities.osiris.division.contracts])).size,
        vulnVer: (new Set([...valnerabilities.osiris.division.contractsVer])).size,
      },
      {
        name: "signedness",
        vuln: (new Set([...valnerabilities.osiris.signedness.contracts])).size,
        vulnVer: (new Set([...valnerabilities.osiris.signedness.contractsVer])).size,
      },
      {
        name: "truncation",
        vuln: (new Set([...valnerabilities.osiris.truncation.contracts])).size,
        vulnVer: (new Set([...valnerabilities.osiris.truncation.contractsVer])).size,
      },
      {
        name: "assertion_failure",
        vuln: (new Set([...valnerabilities.osiris.assertion_failure.contracts, ...valnerabilities.mythril.sums.assertion_failure.contracts])).size,
        vulnVer: (new Set([...valnerabilities.osiris.assertion_failure.contractsVer, ...valnerabilities.mythril.sums.assertion_failure.contractsVer])).size,
      },
      {
        name: "suicidal",
        vuln: (new Set([...valnerabilities.maian.suicidal.contracts, ...valnerabilities.mythril.sums.suicidal.contracts])).size,
        vulnVer: (new Set([...valnerabilities.maian.suicidal.contractsVer, ...valnerabilities.mythril.sums.suicidal.contractsVer])).size,
      },
      {
        name: "prodigal",
        vuln: (new Set([...valnerabilities.maian.prodigal.contracts, ...valnerabilities.mythril.sums.prodigal.contracts])).size,
        vulnVer: (new Set([...valnerabilities.maian.prodigal.contractsVer, ...valnerabilities.mythril.sums.prodigal.contractsVer])).size,
      },
      {
        name: "greedy",
        vuln: (new Set([...valnerabilities.maian.greedy.contracts])).size,
        vulnVer: (new Set([...valnerabilities.maian.greedy.contractsVer])).size,
      },
      {
        name: "dos",
        vuln: (new Set([...valnerabilities.mythril.sums.dos.contracts])).size,
        vulnVer: (new Set([...valnerabilities.mythril.sums.dos.contractsVer])).size,
      },
      {
        name: "unchecked_return",
        vuln: (new Set([...valnerabilities.mythril.sums.unchecked_return.contracts])).size,
        vulnVer: (new Set([...valnerabilities.mythril.sums.unchecked_return.contractsVer])).size,
      },
      {
        name: "tx_origin",
        vuln: (new Set([...valnerabilities.mythril.sums.tx_origin.contracts])).size,
        vulnVer: (new Set([...valnerabilities.mythril.sums.tx_origin.contractsVer])).size,
      },
      {
        name: "untrusted_delegatecall",
        vuln: (new Set([...valnerabilities.mythril.sums.untrusted_delegatecall.contracts])).size,
        vulnVer: (new Set([...valnerabilities.mythril.sums.untrusted_delegatecall.contractsVer])).size,
      },
      {
        name: "arbitrary_storage",
        vuln: (new Set([...valnerabilities.mythril.sums.arbitrary_storage.contracts])).size,
        vulnVer: (new Set([...valnerabilities.mythril.sums.arbitrary_storage.contractsVer])).size,
      },
      {
        name: "insufficient_randomness",
        vuln: (new Set([...valnerabilities.mythril.sums.insufficient_randomness.contracts])).size,
        vulnVer: (new Set([...valnerabilities.mythril.sums.insufficient_randomness.contractsVer])).size,
      },
    ];
    for (const sum of Object.values(valnerabilities.mythril.sums))
      console.log({
        swc_id: sum.swc_id,
        total: sum.total,
        verified: sum.verified,
      });
    console.log(valnerabilities.mythril.vulns);
    console.log(vulns.sort((a, b) => b.vulnVer - a.vulnVer ));
    const sums = {
      total: 0,
      ver: 0,
    }
    vulns.forEach((el) => {
      sums.total += el.vuln;
      sums.ver += el.vulnVer;
    });
    console.log(sums);

    const contractsPerValn = [
      {
        name: "callstack",
        vuln: [...new Set([...valnerabilities.oyente.callstack.contracts, ...valnerabilities.osiris.callstack.contracts])],
        vulnVer: [...new Set([...valnerabilities.oyente.callstack.contractsVer, ...valnerabilities.osiris.callstack.contractsVer])],
      },
      {
        name: "reentrancy",
        vuln: [...new Set([...valnerabilities.oyente.reentrancy.contracts, ...valnerabilities.osiris.reentrancy.contracts, ...valnerabilities.mythril.sums.reentrancy.contracts])],
        vulnVer: [...new Set([...valnerabilities.oyente.reentrancy.contractsVer, ...valnerabilities.osiris.reentrancy.contractsVer, ...valnerabilities.mythril.sums.reentrancy.contractsVer])],
      },
      {
        name: "time_dependency",
        vuln: [...new Set([...valnerabilities.oyente.time_dependency.contracts, ...valnerabilities.osiris.time_dependency.contracts, ...valnerabilities.mythril.sums.time_dependency.contracts])],
        vulnVer: [...new Set([...valnerabilities.oyente.time_dependency.contractsVer, ...valnerabilities.osiris.time_dependency.contractsVer, ...valnerabilities.mythril.sums.time_dependency.contractsVer])],
      },
      {
        name: "money_concurrency",
        vuln: [...new Set([...valnerabilities.oyente.money_concurrency.contracts, ...valnerabilities.osiris.money_concurrency.contracts])],
        vulnVer: [...new Set([...valnerabilities.oyente.money_concurrency.contractsVer, ...valnerabilities.osiris.money_concurrency.contractsVer])],
      },
      {
        name: "integer_overflow",
        vuln: [...new Set([...valnerabilities.oyente.integer_overflow.contracts, ...valnerabilities.osiris.overflow.contracts, ...valnerabilities.mythril.sums.integer_overflow.contracts])],
        vulnVer: [...new Set([...valnerabilities.oyente.integer_overflow.contractsVer, ...valnerabilities.osiris.overflow.contractsVer, ...valnerabilities.mythril.sums.integer_overflow.contractsVer])],
      },
      {
        name: "integer_underflow",
        vuln: [...new Set([...valnerabilities.oyente.integer_underflow.contracts, ...valnerabilities.osiris.underflow.contracts])],
        vulnVer: [...new Set([...valnerabilities.oyente.integer_underflow.contractsVer, ...valnerabilities.osiris.underflow.contractsVer])],
      },
      {
        name: "modulo",
        vuln: [...new Set([...valnerabilities.osiris.modulo.contracts])],
        vulnVer: [...new Set([...valnerabilities.osiris.modulo.contractsVer])],
      },
      {
        name: "division",
        vuln: [...new Set([...valnerabilities.osiris.division.contracts])],
        vulnVer: [...new Set([...valnerabilities.osiris.division.contractsVer])],
      },
      {
        name: "signedness",
        vuln: [...new Set([...valnerabilities.osiris.signedness.contracts])],
        vulnVer: [...new Set([...valnerabilities.osiris.signedness.contractsVer])],
      },
      {
        name: "truncation",
        vuln: [...new Set([...valnerabilities.osiris.truncation.contracts])],
        vulnVer: [...new Set([...valnerabilities.osiris.truncation.contractsVer])],
      },
      {
        name: "assertion_failure",
        vuln: [...new Set([...valnerabilities.osiris.assertion_failure.contracts, ...valnerabilities.mythril.sums.assertion_failure.contracts])],
        vulnVer: [...new Set([...valnerabilities.osiris.assertion_failure.contractsVer, ...valnerabilities.mythril.sums.assertion_failure.contractsVer])],
      },
      {
        name: "suicidal",
        vuln: [...new Set([...valnerabilities.maian.suicidal.contracts, ...valnerabilities.mythril.sums.suicidal.contracts])],
        vulnVer: [...new Set([...valnerabilities.maian.suicidal.contractsVer, ...valnerabilities.mythril.sums.suicidal.contractsVer])],
      },
      {
        name: "prodigal",
        vuln: [...new Set([...valnerabilities.maian.prodigal.contracts, ...valnerabilities.mythril.sums.prodigal.contracts])],
        vulnVer: [...new Set([...valnerabilities.maian.prodigal.contractsVer, ...valnerabilities.mythril.sums.prodigal.contractsVer])],
      },
      {
        name: "greedy",
        vuln: [...new Set([...valnerabilities.maian.greedy.contracts])],
        vulnVer: [...new Set([...valnerabilities.maian.greedy.contractsVer])],
      },
      {
        name: "dos",
        vuln: [...new Set([...valnerabilities.mythril.sums.dos.contracts])],
        vulnVer: [...new Set([...valnerabilities.mythril.sums.dos.contractsVer])],
      },
      {
        name: "unchecked_return",
        vuln: [...new Set([...valnerabilities.mythril.sums.unchecked_return.contracts])],
        vulnVer: [...new Set([...valnerabilities.mythril.sums.unchecked_return.contractsVer])],
      },
      {
        name: "tx_origin",
        vuln: [...new Set([...valnerabilities.mythril.sums.tx_origin.contracts])],
        vulnVer: [...new Set([...valnerabilities.mythril.sums.tx_origin.contractsVer])],
      },
      {
        name: "untrusted_delegatecall",
        vuln: [...new Set([...valnerabilities.mythril.sums.untrusted_delegatecall.contracts])],
        vulnVer: [...new Set([...valnerabilities.mythril.sums.untrusted_delegatecall.contractsVer])],
      },
      {
        name: "arbitrary_storage",
        vuln: [...new Set([...valnerabilities.mythril.sums.arbitrary_storage.contracts])],
        vulnVer: [...new Set([...valnerabilities.mythril.sums.arbitrary_storage.contractsVer])],
      },
      {
        name: "insufficient_randomness",
        vuln: [...new Set([...valnerabilities.mythril.sums.insufficient_randomness.contracts])],
        vulnVer: [...new Set([...valnerabilities.mythril.sums.insufficient_randomness.contractsVer])],
      },
    ];

    const unique = {};
    contractsPerValn.forEach((vuln) => {
      vuln.vuln.forEach((contract) => {
        unique[contract] = unique[contract] ? unique[contract] + 1 : 1;
      });
    });
    const count = {};
    Object.keys(unique).forEach((key) => {
      count[unique[key]] = count[unique[key]] ? count[unique[key]] + 1 : 1
    });
    console.log(count);

    const uniqueVer = {};
    contractsPerValn.forEach((vuln) => {
      vuln.vulnVer.forEach((contract) => {
        uniqueVer[contract] = uniqueVer[contract] ? uniqueVer[contract] + 1 : 1;
      });
    });
    const countVer = {};
    Object.keys(uniqueVer).forEach((key) => {
      countVer[uniqueVer[key]] = countVer[uniqueVer[key]] ? countVer[uniqueVer[key]] + 1 : 1
    });
    console.log(countVer);
  }

  async initApp() {
    const readline = require('readline').createInterface({
      // eslint-disable-next-line no-undef
      input: process.stdin,
      // eslint-disable-next-line no-undef
      output: process.stdout
    });
    const optionsText = "\
    Ethereum Smart Contract Valnerability Assesment Platform\n\
    Choose one of the following actions:\n\
    1) Fetch Blocks up to current one.\n\
    2) Find Posible Contract Creation Txs in Fetched Blocks.\n\
    3) Fetch receipts and build contracts.\n\
    4) Get verfied contracts and fetch abi.\n\
    5) Evaluate Smart Contracts.\n\
    9) Contract Statistics.\n\
    10) TestFunction.\n\
    12) Contract Result statistics.\n\
    13) Print last computed results \n\
    ";
    readline.question(optionsText, option => {
      if (option === "1") {
        this.fetchBlocks(1, 15537393); // 15537393 
      }
      if (option === "2") {
        this.findPosibleContractTxs();
      }
      if (option === "3") {
        this.fetchReceiptsAndBuildInitialContracts();
      }
      if (option === "4") {
        this.fetchAbiForContracts();
      }
      if (option === "5") {
        this.fetchContractEvalResults();
      }
      if (option === "9") {
        this.contractStatistics();
      }
      if (option === "10") {
        this.printResults()
      }
      if (option === "11") {
        this.printTesting()
      }
      if (option === "12") {
        this.processResults();
      }
      if (option === "13") {
        this.printSavedResults();
      }
      readline.close();
    });
    // await this.addBytecodeToResults("./storage/contracts/", "./storage/results/");
   }
}