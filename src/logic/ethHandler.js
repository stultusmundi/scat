import axios from "axios";

const API_KEY = "RYGJVX1G6WRPGQDJV5SQ25A59HGN4NMSAV";
const ENDPOINT = "https://api.etherscan.io/api";
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

export default {
  async post(params) {
    const headers = {
      'Content-Type': 'application/json',
    };
    const response = await axios.get(ENDPOINT, { params }, headers);
    if (!response.data.result) {
      console.log(response.data);
    }
    console.log(response.data);
    return response.data.result;
  },
  async getTxList() {
    const params = {
      module: "account",
      action: "txlist",
      address: ZERO_ADDR,
      startblock: 0,
      endblock: 999999,
      page: 1,
      offset: 10,
      sort: "asc",
      apikey: API_KEY,
    };
    const response = await this.post(params);
  },
}