import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main(): Promise<void> {
  const outdir = await mkdtemp(join(tmpdir(), "githits-proxy-smoke-"));
  try {
    await writeFile(join(outdir, "package.json"), '{"type":"module"}\n');
    const build = await Bun.build({
      entrypoints: ["src/services/proxy-fetch.ts"],
      outdir,
      target: "node",
      format: "esm",
    });

    if (!build.success) {
      for (const log of build.logs) {
        console.error(log);
      }
      process.exit(1);
    }

    const modulePath = join(outdir, "proxy-fetch.js");
    const caPath = join(outdir, "proxy-smoke-ca.pem");
    await writeFile(caPath, TEST_CERT);
    const result = spawnSync("node", ["scripts/proxy-node-smoke.mjs"], {
      stdio: "inherit",
      env: {
        ...childSmokeEnv(process.env),
        GITHITS_PROXY_FETCH_MODULE: modulePath,
        NODE_EXTRA_CA_CERTS: caPath,
      },
    });

    process.exit(result.status ?? 1);
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}

function childSmokeEnv(
  env: NodeJS.ProcessEnv,
): Record<string, string | undefined> {
  const {
    HTTP_PROXY,
    HTTPS_PROXY,
    NO_PROXY,
    http_proxy,
    https_proxy,
    no_proxy,
    NODE_OPTIONS,
    NODE_USE_ENV_PROXY,
    ...rest
  } = env;
  return rest;
}

const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDKDCCAhCgAwIBAgIUIgvE5JR9tgOP8zt+2Mc6zXIWRxYwDQYJKoZIhvcNAQEL
BQAwFzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MB4XDTI2MDcwODA4MzAwNloXDTM2
MDcwNTA4MzAwNlowFzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEA09+TlZXKi6fVpTrHSN2roUb3GYUTXhDF2VuH
Qm/vpemongyD6ThC/PLEOlMzNq0PZJ64SacCgynpYvNEt4d+M6bfInzpuC6jo3eU
GkIIy8peZY+3sM+pozedEEosTdPxjmNdd6OJJ+vPwX8rt6p4zDbQaAiBUl11/l7D
1WsaGk8R7XPzyBI3sIrDXrbM70lr1QB5b/CN01W3uNpZY76Q4GrwTdvzV9riYvkl
CqwtzY7ucOCXaRq6iP9F3hx28Un34lRlG9Jm5bMeAV0mQWWRmZZRdR2R+Tpn/H46
OIR8hY5dwNo1XbG5ngEuLGcgH8jT/En8EIyJzMpW+ynCEzlsTwIDAQABo2wwajAd
BgNVHQ4EFgQUoKQ1P5wZFvKZ5p7kfdMODOgZ0BUwHwYDVR0jBBgwFoAUoKQ1P5wZ
FvKZ5p7kfdMODOgZ0BUwDwYDVR0TAQH/BAUwAwEB/zAXBgNVHREEEDAOggxleGFt
cGxlLnRlc3QwDQYJKoZIhvcNAQELBQADggEBADSU7zh+LwQS8Zr3/x7J8mk+lZ9S
s/X0kXjMGHhwyiHDg/mq2EkBvTmdRd6mu74RPrdAnkIQVxtOY8e4Te8aXniLXaAj
Kh3jViROU2H2PUsLIZPQdH6KE/M8EGRzkryPhdUS/KJ06s5Q3/5ebuQTkjAcyRGz
RQI6Bt1T1SdAULNCeSoqacU4CkODojkoMBEr2jAHrMS5JqVHlGsHrrrdxt10MLJX
wGtq+XtLvvZApLZ9OJNRX0dTCkNlFTCYrW+mqlm1SZ0HbzzYgcIYxLkKhNt0PN7I
sjHd8Ixk4fi6F8q+VezypajRKe+ZiXze7k+z9P8nBoHNI6YCXYRN3sbca0A=
-----END CERTIFICATE-----`;

await main();
