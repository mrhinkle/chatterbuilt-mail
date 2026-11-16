import { X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface LoopbackTls {
  cert: string;
  key: string;
}

let cached: LoopbackTls | null = null;

/**
 * A process-local certificate for the dev listener. The private key is read
 * into memory and the temp files are removed. Callers must not log `key`.
 */
export function loopbackCertificate(): LoopbackTls {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), "cbm-mail-tls-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  const configPath = join(dir, "san.cnf");
  writeFileSync(configPath, [
    "[req]",
    "distinguished_name = dn",
    "x509_extensions = v3",
    "prompt = no",
    "[dn]",
    "CN = localhost",
    "[v3]",
    "subjectAltName = DNS:localhost,IP:127.0.0.1,IP:::1",
    "basicConstraints = CA:FALSE",
    "keyUsage = digitalSignature, keyEncipherment",
    "extendedKeyUsage = serverAuth",
    "",
  ].join("\n"));
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048",
      "-keyout", keyPath,
      "-out", certPath,
      "-days", "1",
      "-nodes",
      "-config", configPath,
    ], { stdio: "ignore" });
    const cert = readFileSync(certPath, "utf8");
    const key = readFileSync(keyPath, "utf8");
    const parsed = new X509Certificate(cert);
    if (!parsed.checkHost("localhost") || !parsed.checkIP("127.0.0.1")) {
      throw new Error("certificate is not valid for localhost");
    }
    if (!key.includes("PRIVATE KEY")) {
      throw new Error("openssl did not write a private key");
    }
    cached = { cert, key };
    return cached;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "openssl failed";
    throw new Error(`loopback TLS certificate could not be created: ${reason}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
