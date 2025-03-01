import {
  hdFactoryForBlockchain,
  keyringForBlockchain,
} from "@coral-xyz/blockchain-common";
import type { BlockchainKeyring } from "@coral-xyz/blockchain-keyring";
import type {
  Blockchain,
  DerivationPath,
  EventEmitter,
  KeyringInit,
} from "@coral-xyz/common";
import {
  BACKEND_API_URL,
  BACKEND_EVENT,
  EthereumConnectionUrl,
  EthereumExplorer,
  NOTIFICATION_KEYRING_STORE_LOCKED,
  SolanaCluster,
  SolanaExplorer,
} from "@coral-xyz/common";
import type { KeyringStoreState } from "@coral-xyz/recoil";
import { KeyringStoreStateEnum } from "@coral-xyz/recoil";
import { generateMnemonic } from "bip39";

import type { User } from "../store";
import * as store from "../store";
import {
  DEFAULT_DARK_MODE,
  DEFAULT_DEVELOPER_MODE,
  DefaultKeyname,
} from "../store";

import * as crypto from "./crypto";

/**
 * KeyringStore API for managing all wallet keys .
 */
export class KeyringStore {
  private lastUsedTs: number;
  private password?: string;
  private autoLockInterval?: ReturnType<typeof setInterval>;
  private events: EventEmitter;
  private usernames: Map<string, UsernameKeyring>;
  // Must be undefined when the keyring-store is locked or uninitialized.
  private activeUserUuid?: string;

  ///////////////////////////////////////////////////////////////////////////////
  // Getters.
  ///////////////////////////////////////////////////////////////////////////////

  public get activeUsernameKeyring(): UsernameKeyring {
    if (!this.activeUserUuid) {
      throw new Error("invariant violation: activeUserUuid is undefined");
    }
    const kr = this.usernames.get(this.activeUserUuid)!;
    if (!kr) {
      throw new Error("invariant violation: activeUsernameKeyring not found");
    }
    return kr;
  }

  ///////////////////////////////////////////////////////////////////////////////
  // Initialization.
  ///////////////////////////////////////////////////////////////////////////////

  constructor(events: EventEmitter) {
    this.usernames = new Map();
    this.lastUsedTs = 0;
    this.events = events;
  }

  // Initializes the keystore for the first time.
  public async init(
    username: string,
    password: string,
    keyringInit: KeyringInit,
    uuid: string
  ) {
    this.password = password;

    // Setup the user.
    await this.usernameKeyringCreate(username, keyringInit, uuid);

    // Persist the encrypted data to then store.
    await this.persist(true);

    // Automatically lock the store when idle.
    await this.tryUnlock(password);
  }

  public async usernameKeyringCreate(
    username: string,
    keyringInit: KeyringInit,
    uuid: string
  ) {
    this.usernames.set(
      uuid,
      await UsernameKeyring.init(username, keyringInit, uuid)
    );
    this.activeUserUuid = uuid;

    await store.setWalletDataForUser(
      uuid,
      defaultPreferences(
        keyringInit.blockchainKeyrings.map((k) => k.blockchain)
      )
    );
    await store.setActiveUser({
      username,
      uuid,
    });
  }

  ///////////////////////////////////////////////////////////////////////////////
  // Internal state machine queries.
  ///////////////////////////////////////////////////////////////////////////////

  public async state(): Promise<KeyringStoreState> {
    if (this.isUnlocked()) {
      return KeyringStoreStateEnum.Unlocked;
    }
    if (await this.isLocked()) {
      return KeyringStoreStateEnum.Locked;
    }
    return KeyringStoreStateEnum.NeedsOnboarding;
  }

  private async isLocked(): Promise<boolean> {
    if (this.isUnlocked()) {
      return false;
    }
    const ciphertext = await store.getEncryptedKeyring();
    return ciphertext !== undefined && ciphertext !== null;
  }

  private isUnlocked(): boolean {
    return (
      this.activeUserUuid !== undefined &&
      this.activeUsernameKeyring.blockchains.size > 0 &&
      this.lastUsedTs !== 0
    );
  }

  ///////////////////////////////////////////////////////////////////////////////
  // Actions.
  ///////////////////////////////////////////////////////////////////////////////

  public async tryUnlock(password: string) {
    return this.withLock(async () => {
      const plaintext = await this.decryptKeyringFromStorage(password);
      await this.fromJson(JSON.parse(plaintext));
      this.password = password;
      // Automatically lock the store when idle.
      this.autoLockStart();
    });
  }

  /**
   * Check if a password is valid by attempting to decrypt the stored keyring.
   */
  public async checkPassword(password: string) {
    try {
      await this.decryptKeyringFromStorage(password);
      return true;
    } catch (err) {
      return false;
    }
  }

  private async decryptKeyringFromStorage(password: string) {
    const ciphertextPayload = await store.getEncryptedKeyring();
    if (ciphertextPayload === undefined || ciphertextPayload === null) {
      throw new Error("keyring store not found on disk");
    }
    const plaintext = await crypto.decrypt(ciphertextPayload, password);
    return plaintext;
  }

  public lock() {
    this.activeUserUuid = undefined; // Must be set to undefined here.
    this.usernames = new Map();
    this.lastUsedTs = 0;
  }

  // Preview public keys for a given mnemonic and derivation path without
  // importing the mnemonic.
  public previewPubkeys(
    blockchain: Blockchain,
    mnemonic: string,
    derivationPath: DerivationPath,
    numberOfAccounts: number
  ): string[] {
    const factory = hdFactoryForBlockchain(blockchain);
    const hdKeyring = factory.fromMnemonic(mnemonic, derivationPath, [
      ...Array(numberOfAccounts).keys(),
    ]);
    return [...Array(numberOfAccounts).keys()].map((i) =>
      hdKeyring.getPublicKey(i)
    );
  }

  public reset() {
    // First lock to clear the keyring memory.
    this.lock();
    // Clear the jwt cookie if it exists.
    fetch(`${BACKEND_API_URL}/authenticate`, {
      method: "DELETE",
    });
    // Then reset persistent disk storage.
    return store.reset();
  }

  public async passwordUpdate(currentPassword: string, newPassword: string) {
    return this.withPasswordAndPersist(currentPassword, () => {
      this.password = newPassword;
    });
  }

  public async autoLockUpdate(autoLockSecs: number) {
    return await this.withUnlock(async () => {
      const data = await store.getWalletDataForUser(this.activeUserUuid!);
      await store.setWalletDataForUser(this.activeUserUuid!, {
        ...data,
        autoLockSecs,
      });

      if (this.autoLockInterval) {
        clearInterval(this.autoLockInterval);
      }
      this.autoLockStart();
    });
  }

  public keepAlive() {
    return this.withUnlock(() => {});
  }

  public createMnemonic(strength: number): string {
    const mnemonic = generateMnemonic(strength);
    return mnemonic;
  }

  public async activeUserUpdate(uuid: string): Promise<User> {
    const userData = await store.getUserData();
    const user = userData.users.filter((u) => u.uuid === uuid)[0];
    this.activeUserUuid = uuid;
    await store.setActiveUser({
      username: user.username,
      uuid,
    });
    return user;
  }

  private autoLockStart() {
    // Check the last time the keystore was used at a regular interval.
    // If it hasn't been used recently, lock the keystore.
    store
      .getWalletDataForUser(this.activeUserUuid!)
      .then(({ autoLockSecs }) => {
        const _autoLockSecs = autoLockSecs ?? store.DEFAULT_LOCK_INTERVAL_SECS;
        this.autoLockInterval = setInterval(() => {
          const currentTs = Date.now() / 1000;
          if (currentTs - this.lastUsedTs >= _autoLockSecs) {
            this.lock();
            this.events.emit(BACKEND_EVENT, {
              name: NOTIFICATION_KEYRING_STORE_LOCKED,
            });
            if (this.autoLockInterval) {
              clearInterval(this.autoLockInterval);
            }
          }
        }, _autoLockSecs * 1000);
      });
  }

  ///////////////////////////////////////////////////////////////////////////////
  // Passes through to the active username keyring.
  ///////////////////////////////////////////////////////////////////////////////

  /**
   * Initialise a blockchain keyring.
   */
  public async blockchainKeyringAdd(
    blockchain: Blockchain,
    derivationPath: DerivationPath,
    accountIndex: number,
    publicKey?: string,
    persist = true
  ): Promise<void> {
    this.activeUsernameKeyring.blockchainKeyringAdd(
      blockchain,
      derivationPath,
      accountIndex,
      publicKey,
      persist
    );
    if (persist) {
      await this.persist();
    }
  }

  // Import a secret key for the given blockchain.
  // TODO handle initialisation, allow init blockchain without mnemonic?
  public async importSecretKey(
    blockchain: Blockchain,
    secretKey: string,
    name: string
  ): Promise<[string, string]> {
    return this.withUnlockAndPersist(async () => {
      return await this.activeUsernameKeyring.importSecretKey(
        blockchain,
        secretKey,
        name
      );
    });
  }

  // Derive the next key for the given blockchain.
  public async deriveNextKey(
    blockchain: Blockchain
  ): Promise<[string, string]> {
    return this.withUnlockAndPersist(async () => {
      return await this.activeUsernameKeyring.deriveNextKey(blockchain);
    });
  }

  public async keyDelete(blockchain: Blockchain, pubkey: string) {
    return this.withUnlockAndPersist(async () => {
      return await this.activeUsernameKeyring.keyDelete(blockchain, pubkey);
    });
  }

  public async ledgerImport(
    blockchain: Blockchain,
    dPath: string,
    account: number,
    pubkey: string
  ) {
    return this.withUnlockAndPersist(async () => {
      return await this.activeUsernameKeyring.ledgerImport(
        blockchain,
        dPath,
        account,
        pubkey
      );
    });
  }

  /**
   * Update the active public key for the given blockchain.
   */
  public async activeWalletUpdate(
    newActivePublicKey: string,
    blockchain: Blockchain
  ) {
    return this.withUnlockAndPersist(async () => {
      return await this.activeUsernameKeyring.activeWalletUpdate(
        newActivePublicKey,
        blockchain
      );
    });
  }

  /**
   * Return the public keys of all blockchain keyrings in the keyring.
   */
  public async publicKeys(): Promise<{
    [key: string]: {
      hdPublicKeys: Array<string>;
      importedPublicKeys: Array<string>;
      ledgerPublicKeys: Array<string>;
    };
  }> {
    return await this.withUnlock(async () => {
      return await this.activeUsernameKeyring.publicKeys();
    });
  }

  /**
   * Return all the active public keys for all enabled blockchains.
   */
  public async activeWallets(): Promise<string[]> {
    return this.withUnlock(async () => {
      return await this.activeUsernameKeyring.activeWallets();
    });
  }

  public exportSecretKey(password: string, publicKey: string): string {
    return this.withPassword(password, () => {
      return this.activeUsernameKeyring.exportSecretKey(password, publicKey);
    });
  }

  public exportMnemonic(password: string): string {
    return this.withPassword(password, () => {
      return this.activeUsernameKeyring.exportMnemonic(password);
    });
  }

  ///////////////////////////////////////////////////////////////////////////////
  // Utilities.
  ///////////////////////////////////////////////////////////////////////////////

  private withUnlockAndPersist<T>(fn: () => T) {
    return this.withUnlock(() => {
      const resp = fn();
      this.persist();
      return resp;
    });
  }

  // Utility for asserting the wallet is currently unlocked.
  private withUnlock<T>(fn: () => T) {
    if (!this.isUnlocked()) {
      throw new Error("keyring store is not unlocked");
    }
    const resp = fn();
    this.updateLastUsed();
    return resp;
  }

  // Utility for asserting the wallet is currently locked.
  private withLock<T>(fn: () => T): T {
    if (this.isUnlocked()) {
      throw new Error("keyring store is not locked");
    }
    const resp = fn();
    this.updateLastUsed();
    return resp;
  }

  private withPasswordAndPersist<T>(currentPassword: string, fn: () => T) {
    return this.withPassword(currentPassword, () => {
      const resp = fn();
      this.persist();
      return resp;
    });
  }

  // Utility for asserting the wallet is unlocked and the correct password was
  // given.
  private withPassword<T>(currentPassword: string, fn: () => T) {
    return this.withUnlock(() => {
      if (currentPassword !== this.password) {
        throw new Error("incorrect password");
      }
      return fn();
    });
  }

  private async persist(forceBecauseCalledFromInit = false) {
    if (!forceBecauseCalledFromInit && !this.isUnlocked()) {
      throw new Error("attempted persist of locked keyring");
    }
    const plaintext = JSON.stringify(this.toJson());
    const ciphertext = await crypto.encrypt(plaintext, this.password!);
    await store.setEncryptedKeyring(ciphertext);
  }

  private updateLastUsed() {
    this.lastUsedTs = Date.now() / 1000;
  }

  ///////////////////////////////////////////////////////////////////////////////
  // Serialization.
  ///////////////////////////////////////////////////////////////////////////////

  private toJson(): any {
    // toJson on all the usernames
    const usernames = Object.fromEntries(
      [...this.usernames].map(([k, v]) => [k, v.toJson()])
    );
    return {
      activeUserUuid: this.activeUserUuid,
      usernames,
      lastUsedTs: this.lastUsedTs,
    };
  }

  private async fromJson(json: any) {
    const { activeUserUuid, usernames } = (() => {
      if (json.usernames) {
        return json;
      }

      //
      // Migrate user from single username -> multi username account management.
      //
      // TODO.
    })();
    this.activeUserUuid = activeUserUuid;
    this.usernames = new Map(
      Object.entries(usernames).map(([username, obj]) => {
        return [username, UsernameKeyring.fromJson(obj)];
      })
    );
  }
}

// Holds all keys for a given username.
class UsernameKeyring {
  blockchains: Map<string, BlockchainKeyring>;
  username: string;
  uuid: string;
  private mnemonic?: string;

  ///////////////////////////////////////////////////////////////////////////////
  // Initialization.
  ///////////////////////////////////////////////////////////////////////////////

  constructor() {
    this.blockchains = new Map();
  }

  public static async init(
    username: string,
    keyringInit: KeyringInit,
    uuid: string
  ): Promise<UsernameKeyring> {
    const kr = new UsernameKeyring();
    kr.uuid = uuid;
    kr.username = username;
    kr.mnemonic = keyringInit.mnemonic;

    for (const blockchainKeyring of keyringInit.blockchainKeyrings) {
      await kr.blockchainKeyringAdd(
        blockchainKeyring.blockchain,
        blockchainKeyring.derivationPath,
        blockchainKeyring.accountIndex,
        blockchainKeyring.publicKey,
        // Don't persist, as we persist manually later
        false
      );
    }
    return kr;
  }

  ///////////////////////////////////////////////////////////////////////////////
  // State selectors.
  ///////////////////////////////////////////////////////////////////////////////

  public hasMnemonic(): boolean {
    return !!this.mnemonic;
  }

  /**
   * Return all the blockchains that have an initialised keyring even if they
   * are not enabled.
   */
  public blockchainKeyrings(): Array<Blockchain> {
    return [...this.blockchains.keys()].map((b) => b as Blockchain);
  }

  /**
   * Return all the enabled blockchains.
   */
  public async enabledBlockchains(): Promise<Array<Blockchain>> {
    const data = await store.getWalletDataForUser(this.uuid);
    if (!data.enabledBlockchains) {
      // Keyring created prior to this feature being added, so data does not
      // exist, write it using all blockchains in keyring
      const enabledBlockchains = [...this.blockchains.keys()].map(
        (b) => b as Blockchain
      );
      await store.setWalletDataForUser(this.uuid, {
        ...data,
        enabledBlockchains,
      });
      return enabledBlockchains;
    }
    return data.enabledBlockchains;
  }

  public async publicKeys(): Promise<{
    [key: string]: {
      hdPublicKeys: Array<string>;
      importedPublicKeys: Array<string>;
      ledgerPublicKeys: Array<string>;
    };
  }> {
    const entries = (await this.enabledBlockchains()).map((blockchain) => {
      const keyring = this.keyringForBlockchain(blockchain);
      return [blockchain, keyring.publicKeys()];
    });
    return Object.fromEntries(entries);
  }

  /**
   * Returns the keyring for a given blockchain.
   */
  public keyringForBlockchain(blockchain: Blockchain): BlockchainKeyring {
    const keyring = this.blockchains.get(blockchain);
    if (keyring) {
      return keyring;
    }
    throw new Error(`no keyring for ${blockchain}`);
  }

  /**
   * Returns the keyring for a given public key.
   */
  public keyringForPublicKey(publicKey: string): BlockchainKeyring {
    for (const keyring of this.blockchains.values()) {
      if (keyring.hasPublicKey(publicKey)) {
        return keyring;
      }
    }
    throw new Error(`no keyring for ${publicKey}`);
  }

  /**
   * Returns the blockchain for a given public key.
   */
  public blockchainForPublicKey(publicKey: string): Blockchain {
    for (const [blockchain, keyring] of this.blockchains) {
      if (keyring.hasPublicKey(publicKey)) {
        return blockchain as Blockchain;
      }
    }
    throw new Error(`no blockchain for ${publicKey}`);
  }

  public async activeWallets(): Promise<string[]> {
    return (await this.enabledBlockchains())
      .map((blockchain) =>
        this.keyringForBlockchain(blockchain).getActiveWallet()
      )
      .filter((w) => w !== undefined) as string[];
  }

  ///////////////////////////////////////////////////////////////////////////////
  // Actions.
  ///////////////////////////////////////////////////////////////////////////////

  public async blockchainKeyringAdd(
    blockchain: Blockchain,
    derivationPath: DerivationPath,
    accountIndex: number,
    publicKey?: string,
    persist = true
  ): Promise<void> {
    const keyring = keyringForBlockchain(blockchain);
    if (this.mnemonic) {
      // Initialising using a mnemonic
      await keyring.initFromMnemonic(this.mnemonic, derivationPath, [
        accountIndex,
      ]);
    } else {
      if (!publicKey)
        throw new Error(
          "initialising keyring with hardware wallet requires publickey"
        );
      // Initialising using a hardware wallet
      await keyring.initFromLedger([
        {
          path: derivationPath,
          account: accountIndex,
          publicKey,
        },
      ]);
    }
    this.blockchains.set(blockchain, keyring);
  }

  public async importSecretKey(
    blockchain: Blockchain,
    secretKey: string,
    name: string
  ): Promise<[string, string]> {
    const keyring = this.keyringForBlockchain(blockchain);
    const [publicKey, _name] = await keyring.importSecretKey(secretKey, name);
    return [publicKey, _name];
  }

  /**
   * Update the active public key for the given blockchain.
   */
  public async activeWalletUpdate(
    newActivePublicKey: string,
    blockchain: Blockchain
  ) {
    const keyring = this.keyringForBlockchain(blockchain);
    await keyring.activeWalletUpdate(newActivePublicKey);
  }

  // Derive the next key for the given blockchain.
  public async deriveNextKey(
    blockchain: Blockchain
  ): Promise<[string, string]> {
    let blockchainKeyring = this.blockchains.get(blockchain);
    if (!blockchainKeyring) {
      throw new Error("blockchain keyring not initialised");
    } else {
      // Derive the next key.
      const [pubkey, name] = blockchainKeyring.deriveNextKey();
      return [pubkey, name];
    }
  }

  public exportSecretKey(password: string, publicKey: string): string {
    const keyring = this.keyringForPublicKey(publicKey);
    return keyring.exportSecretKey(publicKey);
  }

  public exportMnemonic(password: string): string {
    if (!this.mnemonic) throw new Error("keyring uses a hardware wallet");
    return this.mnemonic;
  }

  public async ledgerImport(
    blockchain: Blockchain,
    dPath: string,
    account: number,
    pubkey: string
  ) {
    const blockchainKeyring = this.blockchains.get(blockchain);
    const ledgerKeyring = blockchainKeyring!.ledgerKeyring!;
    const name = DefaultKeyname.defaultLedger(ledgerKeyring.keyCount());
    await ledgerKeyring.ledgerImport(dPath, account, pubkey);
    await store.setKeyname(pubkey, name);
  }

  public async keyDelete(blockchain: Blockchain, pubkey: string) {
    const blockchainKeyring = this.blockchains.get(blockchain);
    await blockchainKeyring!.keyDelete(pubkey);
  }

  ///////////////////////////////////////////////////////////////////////////////
  // Serialization.
  ///////////////////////////////////////////////////////////////////////////////

  public toJson(): {
    uuid: string;
    username: string;
    mnemonic?: string;
    blockchains: any;
  } {
    // toJson on all the keyrings
    const blockchains = Object.fromEntries(
      [...this.blockchains].map(([k, v]) => [k, v.toJson()])
    );
    return {
      uuid: this.uuid,
      username: this.username,
      mnemonic: this.mnemonic,
      blockchains,
    };
  }

  public static fromJson(json: any): UsernameKeyring {
    const { uuid, username, mnemonic, blockchains } = json;

    const u = new UsernameKeyring();
    u.uuid = uuid;
    u.username = username;
    u.mnemonic = mnemonic;
    u.blockchains = new Map(
      Object.entries(blockchains).map(([blockchain, obj]) => {
        const blockchainKeyring = keyringForBlockchain(
          blockchain as Blockchain
        );
        blockchainKeyring.fromJson(obj);
        return [blockchain, blockchainKeyring];
      })
    );

    return u;
  }
}

export function defaultPreferences(enabledBlockchains: any): any {
  return {
    autoLockSecs: store.DEFAULT_LOCK_INTERVAL_SECS,
    approvedOrigins: [],
    enabledBlockchains,
    darkMode: DEFAULT_DARK_MODE,
    developerMode: DEFAULT_DEVELOPER_MODE,
    solana: {
      explorer: SolanaExplorer.DEFAULT,
      cluster: SolanaCluster.DEFAULT,
      commitment: "confirmed",
    },
    ethereum: {
      explorer: EthereumExplorer.DEFAULT,
      connectionUrl: EthereumConnectionUrl.DEFAULT,
    },
  };
}
