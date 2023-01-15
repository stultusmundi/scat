// eslint-disable-next-line @typescript-eslint/no-var-requires
const Eth = require("./logic/ethereum");

const ethHandler = new Eth();
ethHandler.initApp()