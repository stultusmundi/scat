# scat
Smart Contract Assessment Toolkit
The code in this repository is responsible for the "Main Handler process.”
The main functionality of this process is:
- fetch all blocks in the Ethereum blockchain
- find Transactions to null address (contract generation)
- fetch transaction receipts
- find verified contracts and fetch ABI files
- submit contract bytecode in the vulnerability assessment API
- collect vulnerability assessment results
- calculate statistics and results
