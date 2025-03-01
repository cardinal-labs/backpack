import { ethers } from "ethers";
import type { Request, Response } from "express";
import express from "express";

import { extractUserId, optionallyExtractUserId } from "../../auth/middleware";
import { setCookie } from "../../auth/util";
import {
  createUser,
  getUser,
  getUserByUsername,
  getUsersByPrefix,
} from "../../db/users";
import {
  CreateUserWithKeyrings,
  validateEthereumSignature,
  validateSolanaSignature,
} from "../../validation/user";

const { base58 } = ethers.utils;

const router = express.Router();

router.get("/", extractUserId, async (req, res) => {
  // @ts-ignore
  const usernamePrefix: string = req.query.usernamePrefix;
  // @ts-ignore
  const uuid = req.id;

  await getUsersByPrefix({ usernamePrefix, uuid })
    .then((users) => {
      res.json({
        users: users.map((user) => ({
          ...user,
          image: `https://avatars.xnfts.dev/v1/${user.username}`,
        })),
      });
    })
    .catch(() => {
      res.status(511).json({ msg: "Error while fetching users" });
    });
});

/**
 * Create a new user.
 */
router.post("/", async (req, res) => {
  const { username, inviteCode, waitlistId, blockchainPublicKeys } =
    CreateUserWithKeyrings.parse(req.body);

  // Validate all the signatures
  for (const blockchainPublicKey of blockchainPublicKeys) {
    if (blockchainPublicKey.blockchain === "solana") {
      if (
        !validateSolanaSignature(
          Buffer.from(inviteCode, "utf8"),
          base58.decode(blockchainPublicKey.signature),
          base58.decode(blockchainPublicKey.publicKey)
        )
      ) {
        throw new Error("Invalid Solana signature");
      }
    } else {
      if (
        !validateEthereumSignature(
          Buffer.from(inviteCode, "utf8"),
          blockchainPublicKey.signature,
          blockchainPublicKey.publicKey
        )
      ) {
        throw new Error("Invalid Ethereum signature");
      }
    }
  }

  const user = await createUser(
    username,
    blockchainPublicKeys,
    inviteCode,
    waitlistId
  );

  if (user) {
    setCookie(req, res, user.id as string);
  } else {
    throw new Error("Error creating user account");
  }

  if (process.env.SLACK_WEBHOOK_URL) {
    try {
      const publicKeyStr = blockchainPublicKeys
        .map((b) => `${b.blockchain.substring(0, 3)}: ${b.publicKey}`)
        .join(", ");
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: [username, publicKeyStr].join("\n"),
          icon_url: `https://avatars.xnfts.dev/v1/${username}`,
        }),
      });
    } catch (err) {
      console.error({ slackWebhook: err });
    }
  }

  return res.json({ id: user.id, msg: "ok" });
});

/**
 * Get an existing user. Checks authenticated status if a JWT cookie is passed
 * with the request.
 */
router.get(
  "/:username",
  optionallyExtractUserId(false),
  async (req: Request, res: Response) => {
    const username = req.params.username;

    let user;

    if (req.id) {
      try {
        const userFromId = await getUser(req.id);
        if (userFromId && userFromId.username === username) {
          // User is authenticated as username
          user = userFromId;
        }
      } catch {
        // User not found or username did not match
      }
    }

    // Valid JWT, user is authenticated
    const isAuthenticated = !!user;

    if (!user) {
      user = await getUserByUsername(username);
    }

    return user
      ? res.json({
          ...user,
          isAuthenticated,
        })
      : res.status(404).json({ msg: "User not found" });
  }
);

/**
 * Returns the user that is associated with the JWT in the cookie or query string.
 */
router.get(
  "/me",
  optionallyExtractUserId(true),
  async (req: Request, res: Response) => {
    if (req.id) {
      try {
        return res.json(await getUser(req.id));
      } catch {
        // User not found
      }
    }
    return res.status(404).json({ msg: "user not found" });
  }
);

export default router;
