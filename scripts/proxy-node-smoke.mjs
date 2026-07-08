import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

const modulePath = process.env.GITHITS_PROXY_FETCH_MODULE;
if (!modulePath) {
  throw new Error("GITHITS_PROXY_FETCH_MODULE is required");
}

const { createCliFetch, redactProxyUrl } = await import(
  pathToFileURL(modulePath).href
);

async function main() {
  const servers = [];
  try {
    const proxyRequests = [];
    const connectRequests = [];
    const secure = await listen(
      createHttpsServer({ key: TEST_KEY, cert: TEST_CERT }, (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("secure");
      }),
    );
    servers.push(secure.server);

    const proxy = await listen(
      createServer((req, res) => {
        proxyRequests.push(req.url ?? "");
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("proxied");
      }),
    );
    proxy.server.on("connect", (req, clientSocket, head) => {
      connectRequests.push(req.url ?? "");
      const upstream = connect(secure.port, "127.0.0.1", () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) {
          upstream.write(head);
        }
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => upstream.destroy());
    });
    servers.push(proxy.server);

    const direct = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("direct");
      }),
    );
    servers.push(direct.server);

    const fetchFn = createCliFetch({
      env: {
        HTTP_PROXY: `http://user:pass@127.0.0.1:${proxy.port}`,
        HTTPS_PROXY: `http://user:pass@127.0.0.1:${proxy.port}`,
        NO_PROXY: `127.0.0.1:${direct.port}`,
        NODE_USE_ENV_PROXY: "1",
      },
      execArgv: [],
      nodeOptions: "",
      nodeVersion: "20.18.1",
    });

    const proxiedResponse = await fetchFn("http://example.test/proxy-check");
    assertEqual(await proxiedResponse.text(), "proxied", "proxy response body");
    assertEqual(
      proxyRequests[0],
      "http://example.test/proxy-check",
      "proxy receives absolute-form HTTP request",
    );

    const secureResponse = await fetchFn("https://example.test/secure-check");
    assertEqual(
      await secureResponse.text(),
      "secure",
      "HTTPS proxy response body",
    );
    assertEqual(
      connectRequests[0],
      "example.test:443",
      "HTTPS proxy receives CONNECT request",
    );

    const directResponse = await fetchFn(
      `http://127.0.0.1:${direct.port}/direct`,
    );
    assertEqual(await directResponse.text(), "direct", "NO_PROXY response body");
    assertEqual(proxyRequests.length, 1, "NO_PROXY bypasses proxy");

    const redacted = redactProxyUrl(
      "http://user:pass@proxy.example:8080/p?q=1#x",
    );
    assertEqual(redacted, "http://proxy.example:8080/", "proxy URL redaction");

    process.stdout.write("proxy-node-smoke passed\n");
  } finally {
    await Promise.all(servers.map((server) => closeServer(server)));
  }
}

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDT35OVlcqLp9Wl
OsdI3auhRvcZhRNeEMXZW4dCb++l6aieDIPpOEL88sQ6UzM2rQ9knrhJpwKDKeli
80S3h34zpt8ifOm4LqOjd5QaQgjLyl5lj7ewz6mjN50QSixN0/GOY113o4kn68/B
fyu3qnjMNtBoCIFSXXX+XsPVaxoaTxHtc/PIEjewisNetszvSWvVAHlv8I3TVbe4
2lljvpDgavBN2/NX2uJi+SUKrC3Nju5w4JdpGrqI/0XeHHbxSffiVGUb0mblsx4B
XSZBZZGZllF1HZH5Omf8fjo4hHyFjl3A2jVdsbmeAS4sZyAfyNP8SfwQjInMylb7
KcITOWxPAgMBAAECggEAPhc5Yw8Ayqim3cM5/8qmr57ib2ImaNy1fptqKjgvnQm6
1oaIaeKJDyP+CbG0QoO5DR3OmBcPj2zK7qqoKrjUbUKsBalhvQ49+nvitUdA2Kg3
vb++b1yMND7qEooKLcy876ODErqkSUS8H9Kq9ypIOGCf9rz3WTH2kFMpRPQcNDUL
UVRFfhAhzU5JSy5xeeTEMB0NI0gl+an95oD0bXyVzhB+8sU09bjU/yXoIuxH9enm
YXlW2jygDRK5DkPnoxZksCHLDFeGxU9MATg7NWC2StnzGPNWL/LcEzLldqJXAbzG
WWNFU7hcXPvBe+R7cUsSV+Yvl5CwZWge+5YiVMLZoQKBgQDw0+HzBVelQ95uGUw9
sv6nyjXr0C85wFKzBb16Q4GYsnlo+HtwcEa0SiN7jz6nkEW4lSvyCcOr8Pm/HFqu
+mbMv9S6nuxZkWHnSU8/wk7hWZXd/bzfAe2170+eSjwYha63L4rWbMXsI//R4c9n
h7MkhKGULfaekza/xiVkKd/K6QKBgQDhOLZ162oXnfaYYJWoQ2FDq6hjIE+qy9xz
FdEz65MPBFo6pbJNft4e5usNMy2c0QBt4DAff/oRoww+GYexo13MwdsWnL9oyHCn
LwAqZoK9NjcFdkdpbNlRYzjj8POD6JPA0uvYhD0+JLlFKBjjuvJr2VOxQI1xJ7Vj
Yx7/5v0KdwKBgDkkLRJ6jAc8iURaYEqrc9zgD9c5+FqdlYHAtOqTpeZTQpdzjeZp
3XzdsnmYzWb4xnI7gsfVJUZg0QFVevbVlxqx0YnON4oxAqfcLx+TvR+fH/4iPHQ1
gu+OLrgCKSwwW/o/H5QtDvEuwX5NM+b+vbTGe4grN778cxshqrGPdfgxAoGBAN7e
9UgphtoKGh1d7psM2nJRqxc0wUF97RABtf0QEH2azAMfNxuTARFJZ66vR2LYO/l/
EYAKb5cGZzYIo4v44vidmUV+Jbf2Kex3CU3sFVJSFQ6VpkNAUKlGa+S86u1MuPHm
hzbCXaxiQOibrk2lEQIClNxhydYA+nF4hBOuLBcvAoGAHc7ADCJuaJ8R730iD4TJ
daXCXcZmMPZiq/Zu55/IvcTJCghiERse8dXOjgJRDEzc47V96icW8emtV85xQt+z
gN46s3p7T7ny/nfdQACk0GpYTZy0i8ZyPV8LQeJyADVty5EFBWEA/r/PFuN5mreZ
0v2DFEPG2UGRBMe3Cnh5o2g=
-----END PRIVATE KEY-----`;

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

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

async function closeServer(server) {
  if (!server.listening) {
    return;
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
