export interface TelestaiBlock {
  hash: string;
  confirmations: number;
  strippedsize: number;
  size: number;
  weight: number;
  height: number;
  version: number;
  versionHex: string;
  merkleroot: string;
  tx: string[];
  time: number;
  mediantime: number;
  nonce: number;
  bits: string;
  difficulty: number;
  chainwork: string;
  headerhash: string;
  mixhash: string;
  nonce64: number;
  previousblockhash?: string;
  nextblockhash?: string;
} 