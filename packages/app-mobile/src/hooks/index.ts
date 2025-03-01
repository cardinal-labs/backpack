import { Blockchain } from "@coral-xyz/common";

export { useIsONELive } from "./useIsONELive";
export { useTheme } from "./useTheme";
import Images from "../Images";

// TODO(peter) consolidate between extension/mobile-app or just live on S3
export function useBlockchainLogo(blockchain: Blockchain): string {
  switch (blockchain) {
    case Blockchain.ETHEREUM:
      return Images.ethereumLogo;
    case Blockchain.SOLANA:
      return Images.solanaLogo;
    default:
      throw new Error(`invalid blockchain ${blockchain}`);
  }
}
