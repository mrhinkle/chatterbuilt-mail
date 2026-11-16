import type { Config } from "../config.js";
import { openSeal } from "../crypto/seal.js";
import type { Logger } from "../log.js";
import type { AuthStore } from "./store.js";

/** A Web client id from Google Cloud. The suffix is the part the console shows. */
const GOOGLE_CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.apps\.googleusercontent\.com$/;

/** An Entra application (client) id is a UUID. */
const MICROSOFT_CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A client secret. No spaces, and short enough to seal. */
const OAUTH_SECRET = /^[^\s]{8,256}$/;

export function googleClientIdOk(value: string): boolean {
  return GOOGLE_CLIENT_ID.test(value);
}

export function microsoftClientIdOk(value: string): boolean {
  return MICROSOFT_CLIENT_ID.test(value);
}

export function oauthSecretOk(value: string): boolean {
  return OAUTH_SECRET.test(value);
}

/** Fills Google and Microsoft clients from the store when the environment did not set them. */
export async function applyStoredClients(config: Config, store: AuthStore, logger: Logger): Promise<void> {
  if (!config.googleClientFromEnv) {
    const row = await store.providerClient("google");
    if (row?.secretSealed) {
      try {
        const secret = openSeal(config.encryptionKey, row.secretSealed);
        config.googleClientId = row.clientId;
        config.googleClientSecret = secret;
        logger.redact(secret);
      } catch {
        logger.info("stored google client could not be opened");
      }
    }
  }
  if (!config.microsoftClientFromEnv) {
    const row = await store.providerClient("microsoft");
    if (row) {
      let secret: string | undefined;
      if (row.secretSealed) {
        try {
          secret = openSeal(config.encryptionKey, row.secretSealed);
          logger.redact(secret);
        } catch {
          logger.info("stored microsoft client could not be opened");
          secret = undefined;
        }
      }
      config.microsoftClientId = row.clientId;
      config.microsoftClientSecret = secret;
      config.microsoftMode = secret ? "confidential" : "device";
    }
  }
}
