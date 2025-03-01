import React, { useEffect } from "react";
import type { Blockchain, Notification } from "@coral-xyz/common";
import {
  BackgroundSolanaConnection,
  CHANNEL_POPUP_NOTIFICATIONS,
  ChannelAppUi,
  getLogger,
  NOTIFICATION_APPROVED_ORIGINS_UPDATE,
  NOTIFICATION_AUTO_LOCK_SECS_UPDATED,
  NOTIFICATION_BLOCKCHAIN_DISABLED,
  NOTIFICATION_BLOCKCHAIN_ENABLED,
  NOTIFICATION_DARK_MODE_UPDATED,
  NOTIFICATION_DEVELOPER_MODE_UPDATED,
  NOTIFICATION_ETHEREUM_ACTIVE_WALLET_UPDATED,
  NOTIFICATION_ETHEREUM_CHAIN_ID_UPDATED,
  NOTIFICATION_ETHEREUM_CONNECTION_URL_UPDATED,
  NOTIFICATION_ETHEREUM_FEE_DATA_DID_UPDATE,
  NOTIFICATION_ETHEREUM_TOKENS_DID_UPDATE,
  NOTIFICATION_KEYNAME_UPDATE,
  NOTIFICATION_KEYRING_DERIVED_WALLET,
  NOTIFICATION_KEYRING_IMPORTED_SECRET_KEY,
  NOTIFICATION_KEYRING_KEY_DELETE,
  NOTIFICATION_KEYRING_STORE_ACTIVE_USER_UPDATED,
  NOTIFICATION_KEYRING_STORE_CREATED,
  NOTIFICATION_KEYRING_STORE_LOCKED,
  NOTIFICATION_KEYRING_STORE_RESET,
  NOTIFICATION_KEYRING_STORE_UNLOCKED,
  NOTIFICATION_KEYRING_STORE_USERNAME_ACCOUNT_CREATED,
  NOTIFICATION_NAVIGATION_URL_DID_CHANGE,
  NOTIFICATION_SOLANA_ACTIVE_WALLET_UPDATED,
  NOTIFICATION_SOLANA_COMMITMENT_UPDATED,
  NOTIFICATION_SOLANA_CONNECTION_URL_UPDATED,
  NOTIFICATION_SOLANA_EXPLORER_UPDATED,
  NOTIFICATION_SOLANA_SPL_TOKENS_DID_UPDATE,
  NOTIFICATION_XNFT_PREFERENCE_UPDATED,
} from "@coral-xyz/common";
import type { Commitment } from "@solana/web3.js";
import { useSetRecoilState } from "recoil";

import * as atoms from "../atoms";
import { allPlugins } from "../hooks";
import type { WalletPublicKeys } from "../types";
import {
  KeyringStoreStateEnum,
  useUpdateAllSplTokenAccounts,
  useUpdateEthereumBalances,
} from "../";

import { useNavigate } from "./useNavigatePolyfill";

const logger = getLogger("notifications-provider");

//
// The Notifications provider is used to subscribe and handle notifications
// from the background script. Among other things, this is useful to enforce
// a unidirectional data flow: app -> background script -> notifications.
//
export function NotificationsProvider(props: any) {
  const setWalletData = useSetRecoilState(atoms.walletPublicKeyData);
  const setWalletPublicKeys = (publicKeys) => {
    setWalletData((current) => {
      return {
        ...current,
        publicKeys,
      };
    });
  };
  const setActiveWallets = (activePublicKeys) => {
    setWalletData((current) => {
      return {
        ...current,
        activePublicKeys,
      };
    });
  };
  const setKeyringStoreState = useSetRecoilState(atoms.keyringStoreState);
  const setActiveUser = useSetRecoilState(atoms.user);
  // Preferences.
  const setPreferences = useSetRecoilState(atoms.preferences);
  const setAutoLockSecs = (autoLockSecs: number) => {
    setPreferences((current) => {
      return {
        ...current,
        autoLockSecs,
      };
    });
  };
  const setIsDarkMode = (darkMode: boolean) => {
    setPreferences((current) => {
      return {
        ...current,
        darkMode,
      };
    });
  };
  const setIsDeveloperMode = (developerMode: boolean) => {
    setPreferences((current) => {
      return {
        ...current,
        developerMode,
      };
    });
  };
  const setEnabledBlockchains = (enabledBlockchains: Blockchain) => {
    setPreferences((current) => {
      return {
        ...current,
        enabledBlockchains,
      };
    });
  };
  const setApprovedOrigins = (approvedOrigins: Array<string>) => {
    setPreferences((current) => {
      return {
        ...current,
        approvedOrigins,
      };
    });
  };
  const setXnftPreferences = useSetRecoilState(atoms.xnftPreferences);
  // Solana
  const setSolanaConnectionUrl = (cluster) => {
    setPreferences((current) => {
      return {
        ...current,
        solana: {
          ...current.solana,
          cluster,
        },
      };
    });
  };
  const setSolanaExplorer = (explorer: string) => {
    setPreferences((current) => {
      return {
        ...current,
        solana: {
          ...current.solana,
          explorer,
        },
      };
    });
  };
  const setSolanaCommitment = (commitment: Commitment) => {
    setPreferences((current) => {
      return {
        ...current,
        solana: {
          ...current.solana,
          commitment,
        },
      };
    });
  };
  // Ethereum
  const setEthereumConnectionUrl = (connectionUrl: string) => {
    setPreferences((current) => {
      return {
        ...current,
        ethereum: {
          ...current.ethereum,
          connectionUrl,
        },
      };
    });
  };
  const setEthereumChainId = (chainId: string) => {
    setPreferences((current) => {
      return {
        ...current,
        ethereum: {
          ...current.ethereum,
          chainId,
        },
      };
    });
  };
  const setEthereumFeeData = useSetRecoilState(atoms.ethereumFeeData);
  // Balance update.
  const updateAllSplTokenAccounts = useUpdateAllSplTokenAccounts();
  const updateEthereumBalances = useUpdateEthereumBalances();
  // URL navigation.
  const navigate = useNavigate();

  useEffect(() => {
    ////////////////////////////////////////////////////////////////////////////
    // Notifications from background script.
    ////////////////////////////////////////////////////////////////////////////

    //
    // Notification dispatch.
    //
    const notificationsHandler = (notif: Notification) => {
      logger.debug(`received notification ${notif.name}`, notif);

      switch (notif.name) {
        case NOTIFICATION_KEYRING_STORE_CREATED:
          handleKeyringStoreCreated(notif);
          break;
        case NOTIFICATION_KEYRING_STORE_LOCKED:
          handleKeyringStoreLocked(notif);
          break;
        case NOTIFICATION_KEYRING_STORE_UNLOCKED:
          handleKeyringStoreUnlocked(notif);
          break;
        case NOTIFICATION_KEYRING_STORE_RESET:
          handleReset(notif);
          break;
        case NOTIFICATION_KEYRING_KEY_DELETE:
          handleKeyringKeyDelete(notif);
          break;
        case NOTIFICATION_KEYNAME_UPDATE:
          handleKeynameUpdate(notif);
          break;
        case NOTIFICATION_KEYRING_DERIVED_WALLET:
          handleKeyringDerivedWallet(notif);
          break;
        case NOTIFICATION_KEYRING_IMPORTED_SECRET_KEY:
          handleKeyringImportedSecretKey(notif);
          break;
        case NOTIFICATION_APPROVED_ORIGINS_UPDATE:
          handleApprovedOriginsUpdate(notif);
          break;
        case NOTIFICATION_NAVIGATION_URL_DID_CHANGE:
          handleNavigationUrlDidChange(notif);
          break;
        case NOTIFICATION_AUTO_LOCK_SECS_UPDATED:
          handleAutoLockSecsUpdated(notif);
          break;
        case NOTIFICATION_XNFT_PREFERENCE_UPDATED:
          handleXnftPreferenceUpdated(notif);
          break;
        case NOTIFICATION_DARK_MODE_UPDATED:
          handleIsDarkModeUpdated(notif);
          break;
        case NOTIFICATION_DEVELOPER_MODE_UPDATED:
          handleIsDeveloperModeUpdated(notif);
          break;
        case NOTIFICATION_SOLANA_EXPLORER_UPDATED:
          handleSolanaExplorerUpdated(notif);
          break;
        case NOTIFICATION_SOLANA_COMMITMENT_UPDATED:
          handleSolanaCommitmentUpdated(notif);
          break;
        case NOTIFICATION_SOLANA_SPL_TOKENS_DID_UPDATE:
          handleSolanaSplTokensDidUpdate(notif);
          break;
        case NOTIFICATION_SOLANA_CONNECTION_URL_UPDATED:
          handleSolanaConnectionUrlUpdated(notif);
          break;
        case NOTIFICATION_SOLANA_ACTIVE_WALLET_UPDATED:
          handleSolanaActiveWalletUpdated(notif);
          break;
        case NOTIFICATION_ETHEREUM_ACTIVE_WALLET_UPDATED:
          handleEthereumActiveWalletUpdated(notif);
          break;
        case NOTIFICATION_ETHEREUM_CONNECTION_URL_UPDATED:
          handleEthereumConnectionUrlUpdated(notif);
          break;
        case NOTIFICATION_ETHEREUM_CHAIN_ID_UPDATED:
          handleEthereumChainIdUpdated(notif);
          break;
        case NOTIFICATION_ETHEREUM_TOKENS_DID_UPDATE:
          handleEthereumTokensDidUpdate(notif);
          break;
        case NOTIFICATION_ETHEREUM_FEE_DATA_DID_UPDATE:
          handleEthereumFeeDataDidUpdate(notif);
          break;
        case NOTIFICATION_BLOCKCHAIN_ENABLED:
          handleBlockchainEnabled(notif);
          break;
        case NOTIFICATION_BLOCKCHAIN_DISABLED:
          handleBlockchainDisabled(notif);
          break;
        case NOTIFICATION_KEYRING_STORE_USERNAME_ACCOUNT_CREATED:
          handleUsernameAccountCreated(notif);
          break;
        case NOTIFICATION_KEYRING_STORE_ACTIVE_USER_UPDATED:
          handleActiveUserUpdated(notif);
          break;
        default:
          break;
      }
    };

    //
    // Notification handlers.
    //
    const handleKeyringStoreCreated = (notif: Notification) => {
      setPreferences(notif.data.preferences);
      setKeyringStoreState(KeyringStoreStateEnum.Unlocked);
    };

    const handleKeyringStoreLocked = (_notif: Notification) => {
      setKeyringStoreState(KeyringStoreStateEnum.Locked);
    };

    const handleKeyringStoreUnlocked = (_notif: Notification) => {
      setKeyringStoreState(KeyringStoreStateEnum.Unlocked);
    };

    const handleKeyringKeyDelete = (notif: Notification) => {
      const { blockchain, deletedPublicKey } = notif.data;
      // Remove the deleted key from the key list.
      setWalletData((current) => {
        const publicKeys = current.publicKeys;
        publicKeys[blockchain] = {
          hdPublicKeys: [
            ...publicKeys[blockchain].hdPublicKeys.filter(
              (key) => key.publicKey !== deletedPublicKey
            ),
          ],
          importedPublicKeys: [
            ...publicKeys[blockchain].importedPublicKeys.filter(
              (key) => key.publicKey !== deletedPublicKey
            ),
          ],
          ledgerPublicKeys: [
            ...publicKeys[blockchain].ledgerPublicKeys.filter(
              (key) => key.publicKey !== deletedPublicKey
            ),
          ],
        };
        const activePublicKeys = current.activePublicKeys.filter(
          (key) => key !== deletedPublicKey
        );
        return {
          activePublicKeys,
          publicKeys,
        };
      });
    };

    const handleKeynameUpdate = (notif: Notification) => {
      setWalletPublicKeys((current: any) => {
        // Using JSON for a deep copy
        const next: WalletPublicKeys = JSON.parse(JSON.stringify(current));
        for (const keyring of Object.values(next)) {
          for (const namedPublicKeys of Object.values(keyring)) {
            for (const namedPublicKey of namedPublicKeys) {
              if (namedPublicKey.publicKey === notif.data.publicKey) {
                namedPublicKey.name = notif.data.name;
              }
            }
          }
        }
        return next;
      });
    };

    const handleKeyringDerivedWallet = (notif: Notification) => {
      const { blockchain, publicKey, name } = notif.data;
      setWalletData((current: any) => {
        const publicKeys = current.publicKeys;

        // Deriving a new wallet can result in the initialisation of this
        // keyring so no guarantee the keyrings exist
        publicKeys[blockchain] = {
          hdPublicKeys: [
            ...(publicKeys[blockchain]
              ? publicKeys[blockchain].hdPublicKeys
              : []),
            // Add newly derived key
            {
              publicKey,
              name,
            },
          ],
          importedPublicKeys: [
            ...(publicKeys[blockchain]
              ? publicKeys[blockchain].importedPublicKeys
              : []),
          ],
          ledgerPublicKeys: [
            ...(publicKeys[blockchain]
              ? publicKeys[blockchain].ledgerPublicKeys
              : []),
          ],
        };
        const activePublicKeys = current.activePublicKeys.concat([publicKey]);
        return {
          activePublicKeys,
          publicKeys,
        };
      });
    };

    const handleKeyringImportedSecretKey = (notif: Notification) => {
      const { blockchain, publicKey, name } = notif.data;
      setWalletData((current: any) => {
        const publicKeys = current.publicKeys;

        // Although not possible to initialise a new keyring by importing
        // a secret key, it may be possible in the future so this is handled
        // the same way as deriving
        publicKeys[blockchain] = {
          hdPublicKeys: [
            ...(publicKeys[blockchain]
              ? publicKeys[blockchain].hdPublicKeys
              : []),
          ],
          importedPublicKeys: [
            ...(publicKeys[blockchain]
              ? publicKeys[blockchain].importedPublicKeys
              : []),
            // Add newly imported key
            {
              publicKey,
              name,
            },
          ],
          ledgerPublicKeys: [
            ...(publicKeys[blockchain]
              ? publicKeys[blockchain].ledgerPublicKeys
              : []),
          ],
        };
        const activePublicKeys = current.activePublicKeys.concat([publicKey]);
        return {
          activePublicKeys,
          publicKeys,
        };
      });
    };

    const handleSolanaActiveWalletUpdated = (notif: Notification) => {
      allPlugins().forEach((p) => {
        p.pushSolanaPublicKeyChangedNotification(notif.data.activeWallet);
      });
      setActiveWallets(notif.data.activeWallets);
    };

    const handleReset = (_notif: Notification) => {
      setKeyringStoreState(KeyringStoreStateEnum.NeedsOnboarding);
    };

    const handleApprovedOriginsUpdate = (notif: Notification) => {
      setApprovedOrigins(notif.data.approvedOrigins);
    };

    const handleNavigationUrlDidChange = (notif: Notification) => {
      navigate(notif.data.url);
    };

    const handleAutoLockSecsUpdated = (notif: Notification) => {
      setAutoLockSecs(notif.data.autoLockSecs);
    };

    const handleXnftPreferenceUpdated = (notif: Notification) => {
      setXnftPreferences(notif.data.updatedPreferences);
    };

    const handleIsDarkModeUpdated = (notif: Notification) => {
      setIsDarkMode(notif.data.darkMode);
    };

    const handleIsDeveloperModeUpdated = (notif: Notification) => {
      setIsDeveloperMode(notif.data.developerMode);
    };

    const handleSolanaExplorerUpdated = (notif: Notification) => {
      setSolanaExplorer(notif.data.explorer);
    };

    const handleSolanaCommitmentUpdated = (notif: Notification) => {
      setSolanaCommitment(notif.data.commitment);
    };

    const handleSolanaConnectionUrlUpdated = (notif: Notification) => {
      setSolanaConnectionUrl(notif.data.url);
      allPlugins().forEach((p) => {
        p.pushSolanaConnectionChangedNotification(notif.data.url);
      });
    };

    const handleSolanaSplTokensDidUpdate = (notif: Notification) => {
      const publicKey = notif.data.publicKey;
      const connectionUrl = notif.data.connectionUrl;
      const result = BackgroundSolanaConnection.customSplTokenAccountsFromJson(
        notif.data.customSplTokenAccounts
      );
      const customSplTokenAccounts = {
        ...result,
        tokenAccounts: new Map(
          result.tokenAccountsMap.map((t: any) => [t[0], t[1]])
        ),
      };
      updateAllSplTokenAccounts({
        publicKey,
        connectionUrl,
        customSplTokenAccounts,
      });
    };

    const handleEthereumActiveWalletUpdated = (notif: Notification) => {
      allPlugins().forEach((p) => {
        p.pushEthereumPublicKeyChangedNotification(notif.data.activeWallet);
      });
      setActiveWallets(notif.data.activeWallets);
    };

    const handleEthereumTokensDidUpdate = (notif: Notification) => {
      const { connectionUrl, activeWallet, balances } = notif.data;
      updateEthereumBalances({
        connectionUrl,
        publicKey: activeWallet,
        balances,
      });
    };

    const handleEthereumFeeDataDidUpdate = (notif: Notification) => {
      setEthereumFeeData(notif.data.feeData);
    };

    const handleEthereumConnectionUrlUpdated = (notif: Notification) => {
      setEthereumConnectionUrl(notif.data.connectionUrl);
      allPlugins().forEach((p) => {
        p.pushEthereumConnectionChangedNotification(notif.data.connectionUrl);
      });
    };

    const handleEthereumChainIdUpdated = (notif: Notification) => {
      setEthereumChainId(notif.data.chainId);
    };

    const handleBlockchainEnabled = (notif: Notification) => {
      setEnabledBlockchains(notif.data.enabledBlockchains);
      setWalletData(notif.data.publicKeyData);
    };

    const handleBlockchainDisabled = (notif: Notification) => {
      setEnabledBlockchains(notif.data.enabledBlockchains);
      setWalletData(notif.data.publicKeyData);
    };

    const handleUsernameAccountCreated = (notif: Notification) => {
      // Order of each setter matters here.
      setPreferences(notif.data.preferences);
      setXnftPreferences(notif.data.xnftPreferences);
      setWalletData(notif.data.walletData);
      setActiveUser(notif.data.user);
    };

    const handleActiveUserUpdated = (notif: Notification) => {
      // Order of each setter matters here.
      setPreferences(notif.data.preferences);
      setXnftPreferences(notif.data.xnftPreferences);
      setWalletData(notif.data.walletData);
      setActiveUser(notif.data.user);
    };

    //
    // Initiate subscription.
    //
    ChannelAppUi.notifications(CHANNEL_POPUP_NOTIFICATIONS).onNotification(
      notificationsHandler
    );
  }, []);

  return (
    <_NotificationsContext.Provider value={{}}>
      {props.children}
    </_NotificationsContext.Provider>
  );
}

type NotificationsContext = {};
const _NotificationsContext = React.createContext<NotificationsContext | null>(
  null
);
