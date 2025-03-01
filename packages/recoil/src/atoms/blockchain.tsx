import {
  Blockchain,
  UI_RPC_METHOD_BLOCKCHAIN_KEYRINGS_READ,
} from "@coral-xyz/common";
import { atom, selector } from "recoil";

import { backgroundClient } from "./client";

export const availableBlockchains = atom({
  key: "blockchains",
  default: [Blockchain.SOLANA, Blockchain.ETHEREUM],
});

export const blockchainKeyrings = atom({
  key: "blockchainKeyrings",
  default: selector({
    key: "blockchainKeyringsDefault",
    get: ({ get }) => {
      const background = get(backgroundClient);
      return background.request({
        method: UI_RPC_METHOD_BLOCKCHAIN_KEYRINGS_READ,
        params: [],
      });
    },
  }),
});
