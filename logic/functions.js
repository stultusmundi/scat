/* eslint-disable @typescript-eslint/no-var-requires */
const axios = require("axios");
const pako = require('pako');
const fs = require('fs');
const zlib = require('zlib');
const cliProgress = require('cli-progress');
const  qs = require('qs');

const API_KEY = [ "ETHERSCAN_API_KEY" ];
const ENDPOINT = "https://api.etherscan.io/api";
const VM_API = [
    "http://{VULNERAABILITY_ASSESMENT_VM_IP}/sceval.php",
  ];

module.exports = {
  delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
  },
  async post(params) {
    const headers = {
      'Content-Type': 'application/json',
    };
    let response = undefined;
    while (response === undefined) {
      response = await axios.get(ENDPOINT, { params }, headers).catch((err) => {
        console.log("axios error! Some server on network error");
        return undefined;
      });
      if (response === undefined) {
        await this.delay(2000);
      }
    }
    return response.data;
  },

  async postAPI(params, api = 0) {
    let response = undefined;
    while (response === undefined) {
      response = await axios.post(VM_API[api], qs.stringify(params)).catch((err) => {
        console.log("axios error! Some server on network error", VM_API[api]);
        return undefined;
      });
      if (response === undefined) {
        await this.delay(2000);
      }
    }
    return response.data;
  },

  async clearApi() {
    let res = "";
    for (let i = 0; i < VM_API_CLEAR.length; i += 1) {
      res = await axios.get(VM_API_CLEAR[i]).catch((err) => {
        console.log("axios error! Some server on network error", VM_API_CLEAR[i]);
        return undefined;
      });
      console.log(res);
    }
    return true;
  },

  async loadFromStorage(file) {
    try {
      const data = fs.readFileSync(file, 'utf-8');
      return JSON.parse(data.toString());
    } catch (error) {
      // console.log(error);
      return false;
    }
  },

  async saveToStorage(file, array) {
    const data = JSON.stringify(array);
    try {
        fs.writeFileSync(file, data);
        // console.log("JSON data is saved.");
    } catch (error) {
        console.error(error);
    }
  },

  async loadCompressedFromStorage(file) {
    try {
      return JSON.parse(zlib.unzipSync(fs.readFileSync(file), { to: 'string' }));
    } catch (error) {
      console.log("file not loaded");
      return [];
    }
  },

  async loadCompressedFromStorage2(file) {
    try {
      return JSON.parse(zlib.unzipSync(fs.readFileSync(file), { to: 'string' }));
    } catch (error) {
      return false;
    }
  },

  async saveCompressedToStorage(file, array) {
    try {
        fs.writeFileSync(file, pako.deflate(JSON.stringify(array)));
        // console.log("JSON data is saved.");
    } catch (error) {
        console.error(error);
    }
  },

  async deleteFile(file) {
    try {
      fs.unlinkSync(file)
      //file removed
    } catch(err) {
      console.error(err)
    }
  },
  async getFileList(path) {
    const fs = require('fs');
    let files = []
    try {
      files = fs.readdirSync(path);
    } catch (err) {
      console.log(err)
    }
    return files;
  },
  async getFileRanges(path) {
    const files = await this.getFileList(path)
    let fileRanges = []
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const start = Number(file.split("-")[1])
      const end = Number(file.split("-")[2])
      fileRanges.push({
        start,
        end,
        file,
        loaded: false,
      });
    }
    return fileRanges;
  },
  async getBlockFromStorage(block) {
    const blockRanges = await this.getFileRanges("./storage/blocks/");
    const foundFile = blockRanges.find((el) => el.start <= block && el.end >= block);
    const blocks = await this.loadCompressedFromStorage(`./storage/blocks/${foundFile.file}`)
    const foundBlock = blocks.find((el) => el.number === block);
    return foundBlock;
  },
  async getBlockFileFromStorage(block) {
    const blockRanges = await this.getFileRanges("./storage/blocks/");
    const foundFile = blockRanges.find((el) => el.start <= block && el.end >= block);
    const blocks = await this.loadCompressedFromStorage(`./storage/blocks/${foundFile.file}`)
    return blocks;
  },

  async getImportedContracts(pathToContracts) {
    let filesList = await this.getFileList(pathToContracts);
    const contracts = {};
    const bar1 = new cliProgress.SingleBar({
      format: 'Fetch Imported Contracts [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
    }, cliProgress.Presets.shades_classic);
    bar1.start(filesList.length - 1, 0);
    for (let i=0; i<filesList.length; i+=1) {
      const array = await this.loadCompressedFromStorage(pathToContracts + filesList[i]);
      for (let j=0; j<array.length; j+=1) {
        if (array[j].contractAddress && contracts[array[j].contractAddress] === undefined) {
          contracts[array[j].contractAddress] = array[j].txHash;
        }
      }
      bar1.update(i);
    }
    bar1.stop();
    console.log(" ")
    console.log("Imported contracts:", Object.keys(contracts).length)
    return contracts;
  },

  async getAbiByContract(contractAddress) {
    const params = {
      module: "contract",
      action: "getabi",
      address: contractAddress,
      apikey: API_KEY[Math.floor(Math.random() * API_KEY.length)],
    };
    try {
      const response = await this.post(params);
      return response;
    } catch (error) {
      return undefined;
    }
  },
  async getAbiByContractList(contractAddresses) {
    try {
      const response = [];
      contractAddresses.forEach((contract, index) => {
        const res = {};
        res.contractAddress = contract;
        const params = {
          module: "contract",
          action: "getabi",
          address: contract,
          apikey: API_KEY[index % API_KEY.length],
        };
        res.req = this.post(params);
        response.push(res);
      });
      for (let i = 0; i < response.length; i += 1) {
        response[i].res = await response[i].req;
      }
      return response;
    } catch (error) {
      return [];
    }
  },

  async getAbiByContractList2(contractAddresses) {
    try {
      const result = {};
      const response = [];
      contractAddresses.forEach((contract, index) => {
        const res = {};
        res.contractAddress = contract;
        const params = {
          module: "contract",
          action: "getabi",
          address: contract,
          apikey: API_KEY[index % API_KEY.length],
        };
        res.req = this.post(params);
        response.push(res);
      });
      for (let i = 0; i < response.length; i += 1) {
        result[response[i].contractAddress] = await response[i].req;
      }
      return result;
    } catch (error) {
      return {};
    }
  },

  async getContractsWithResults(pathToResults) {
    let filesList = await this.getFileList(pathToResults);
    const contracts = {};
    const bar1 = new cliProgress.SingleBar({
      format: 'Fetch Imported Contracts [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
    }, cliProgress.Presets.shades_classic);
    bar1.start(filesList.length - 1, 0);
    for (let i=0; i<filesList.length; i+=1) {
      const array = await this.loadCompressedFromStorage(pathToResults + filesList[i]);
      Object.keys(array).forEach((key) => {
        contracts[key] = true;
      });
      bar1.update(i);
    }
    bar1.stop();
    console.log(" ")
    console.log("Contracts With Results:", Object.keys(contracts).length)
    return contracts;
  },
};
